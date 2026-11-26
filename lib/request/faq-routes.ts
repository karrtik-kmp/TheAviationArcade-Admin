/**
 * The FAQ desk on the game backend (API 0.33.0; website docs/briefs/faq-cms-plan.md). Admins edit the `faq` site document
 * one operation per action, publish it, and copy it from dev to live (export on dev, import into the live draft). Every
 * write sends the draft version the admin read; a conflict is never retried or resent. After a write the desk is given a
 * fresh read, as the contract asks ("use `body` from a fresh GET"). Only with `ROLES_SOURCE=backend`: on a mock deployment
 * every route is 404 FAQ_UNAVAILABLE and no backend call is made. Inputs, answers and URLs are never logged or echoed.
 * Relative imports only.
 */
import { HttpError, respond } from "../errors.ts";
import { BackendError, BackendNotConnected } from "./backend.ts";
import {
  FAQ_IMPORT_MAX_BYTES,
  faqDiscardRequestSchema,
  faqDraftDetailSchema,
  faqDraftSchema,
  faqEditRequestSchema,
  faqErrorCodes as codes,
  faqExportSchema,
  faqImportRequestSchema,
  faqPublishRequestSchema,
  faqPublishResultSchema,
  type FaqDeskState,
} from "./faq.ts";
import { route, type RouteContext } from "./router.ts";
import type { ZodType, ZodTypeDef } from "zod";

type Ctx = RouteContext<"member">;
type Step = "read" | "export" | "edit" | "discard" | "publish" | "import";

const base = "/v1/admin/content/documents/faq";
const MAX_JSON_BYTES = 16384;
const notConnected = () =>
  new HttpError(503, "The FAQ desk needs the game backend, which is not connected to this website.", codes.BACKEND_NOT_CONNECTED);
const contract = () => new HttpError(502, "The game backend answered off its contract.", codes.BACKEND_CONTRACT);
const invalid = (message: string) => new HttpError(400, message, codes.INVALID_REQUEST);
const tooLarge = () => new HttpError(413, "That request is too large.", codes.TOO_LARGE);
const seconds = (value?: number) => (value === undefined ? undefined : Math.max(1, Math.ceil(value)));

/** In order: mock deployment, no backend, roles unreadable, then the admin role itself. */
function gate(ctx: Ctx) {
  const { roles } = ctx.principal;
  if (roles.status === "ok" && roles.source === "mock")
    throw new HttpError(404, "The FAQ desk runs on the game backend, so it is not available while this website uses mock roles.", codes.FAQ_UNAVAILABLE);
  if (roles.status === "not-connected") throw notConnected();
  if (roles.status === "unavailable")
    throw new HttpError(503, "Your access could not be checked because the game backend is unavailable. Please try again.", codes.ROLES_UNAVAILABLE);
  if (!ctx.principal.staff) throw new HttpError(403, "This is available to admins only.", codes.FORBIDDEN);
}

/** Maps a backend failure to what the desk says. A refusal's message names the failing operation, so it is passed on. */
export function faqFailure(error: unknown, step: Step): never {
  if (error instanceof BackendNotConnected) throw notConnected();
  if (error instanceof BackendError) {
    const { status, code, errors, detail } = error;
    const reasons = errors.length ? errors : detail ? [detail] : undefined;
    const writes = step !== "read" && step !== "export";
    if (status === 400 && writes) throw new HttpError(400, "The game backend rejected this change.", codes.INVALID_REQUEST, reasons);
    if (status === 401) throw new HttpError(401, "Your sign-in has expired. Sign in again.", codes.SIGNED_OUT);
    if (status === 403)
      throw new HttpError(403, "The game backend refused this. It needs an active admin role and a verified email.", codes.FORBIDDEN);
    if (status === 404) {
      if (step === "export") throw new HttpError(404, "Nothing is published yet, so there is no FAQ to download.", codes.NOT_FOUND);
      throw new HttpError(404, "The game backend does not offer the FAQ. It needs API 0.33.0 or later.", codes.NOT_FOUND);
    }
    if (status === 409 && writes) {
      // Not another editor: answered as a refusal (422), so the desk shows this text instead of its conflict notice.
      if (step === "publish" && code === "nothing_to_publish")
        throw new HttpError(422, "There is nothing to publish: the draft has no questions or matches what is live.", codes.NOTHING_TO_PUBLISH);
      throw new HttpError(409, "Someone changed the FAQ first.", codes.VERSION_CONFLICT);
    }
    if (status === 413 && (step === "edit" || step === "import")) throw tooLarge();
    if (status === 422 && writes)
      throw new HttpError(
        422,
        step === "import" ? "The game backend refused that FAQ file." : "The game backend refused this change.",
        codes.CONTENT_INVALID,
        reasons,
      );
    if (status === 429)
      throw new HttpError(429, "Too many requests. Wait a moment and try again.", codes.RATE_LIMITED, undefined, seconds(error.retryAfter));
    if (status >= 400 && status < 500) throw contract();
    throw new HttpError(503, "The game backend is unavailable. Please try again.", codes.BACKEND_UNAVAILABLE);
  }
  throw error;
}

async function viaBackend<T>(schema: ZodType<T, ZodTypeDef, unknown>, step: Step, run: () => Promise<unknown>): Promise<T> {
  let answer: unknown;
  try {
    answer = await run();
  } catch (error) {
    faqFailure(error, step);
  }
  const parsed = schema.safeParse(answer);
  if (!parsed.success) throw contract();
  return parsed.data;
}

/** Reads a JSON body, cancelling as soon as it passes `limit`; a lying Content-Length can't get past this. */
async function jsonBody(ctx: Ctx, limit: number): Promise<unknown> {
  const declared = ctx.request.headers.get("content-length");
  if (declared !== null && /^[0-9]{1,15}$/.test(declared.trim()) && Number(declared) > limit) throw tooLarge();
  const reader = ctx.request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  } catch {
    throw invalid("A JSON body is required.");
  }
}

function noQuery(ctx: Ctx) {
  if (new URL(ctx.request.url).search) throw invalid("That request has a parameter this website does not accept.");
}

/** The draft a publish would write, and what is live (the published FAQ, read through export; none before a publish). */
async function state(ctx: Ctx): Promise<FaqDeskState> {
  const backend = ctx.backend(ctx.principal.bearer);
  const detail = await viaBackend(faqDraftDetailSchema, "read", () => backend.getJson(`${base}/draft`));
  let live: FaqDeskState["live"] = null;
  let liveVersion: number | null = null;
  let livePublishedAt: string | null = null;
  if (detail.publishedVersion !== null) {
    const file = await viaBackend(faqExportSchema, "export", () => backend.getJson(`${base}/export`));
    live = { categories: file.categories };
    liveVersion = file.sourceVersion;
    livePublishedAt = file.publishedAt;
  }
  return {
    draft: { categories: detail.body.categories },
    draftVersion: detail.draftVersion,
    publishedVersion: detail.publishedVersion,
    changed: detail.changed,
    live,
    liveVersion,
    livePublishedAt,
  };
}

/**
 * The answer after a write that the backend accepted. If the read after it fails, the write still happened: answer
 * `{ saved: true }` rather than the read's error, so the desk never reports a done publish as failed (and never resends).
 */
async function afterWrite(ctx: Ctx) {
  try {
    return respond(await state(ctx));
  } catch {
    return respond({ saved: true });
  }
}

async function read(ctx: Ctx) {
  gate(ctx);
  noQuery(ctx);
  return respond(await state(ctx));
}

async function edit(ctx: Ctx) {
  gate(ctx);
  noQuery(ctx);
  const parsed = faqEditRequestSchema.safeParse(await jsonBody(ctx, MAX_JSON_BYTES));
  if (!parsed.success) throw invalid("Check the text: it must fit the limits, and only an answer can have line breaks.");
  await viaBackend(faqDraftSchema, "edit", () => ctx.backend(ctx.principal.bearer).send("PATCH", `${base}/draft`, parsed.data));
  return afterWrite(ctx);
}

async function discard(ctx: Ctx) {
  gate(ctx);
  noQuery(ctx);
  const parsed = faqDiscardRequestSchema.safeParse(await jsonBody(ctx, MAX_JSON_BYTES));
  if (!parsed.success) throw invalid("Only the draft version can be sent.");
  await viaBackend(faqDraftSchema, "discard", () => ctx.backend(ctx.principal.bearer).send("POST", `${base}/draft/discard`, parsed.data));
  return afterWrite(ctx);
}

async function publish(ctx: Ctx) {
  gate(ctx);
  noQuery(ctx);
  const parsed = faqPublishRequestSchema.safeParse(await jsonBody(ctx, MAX_JSON_BYTES));
  if (!parsed.success) throw invalid("Only the draft version and a note can be sent.");
  await viaBackend(faqPublishResultSchema, "publish", () => ctx.backend(ctx.principal.bearer).send("POST", `${base}/publish`, parsed.data));
  return afterWrite(ctx);
}

/** The published FAQ as the file the live Admin imports. Checked against the contract, then passed on. */
async function exportFile(ctx: Ctx) {
  gate(ctx);
  noQuery(ctx);
  return respond(await viaBackend(faqExportSchema, "export", () => ctx.backend(ctx.principal.bearer).getJson(`${base}/export`)));
}

/** Replaces the draft with a file exported on dev; never publishes. Up to 3 MB on this route only. */
async function importFile(ctx: Ctx) {
  gate(ctx);
  noQuery(ctx);
  const parsed = faqImportRequestSchema.safeParse(await jsonBody(ctx, FAQ_IMPORT_MAX_BYTES));
  if (!parsed.success) throw invalid("Choose an FAQ file downloaded from the dev Admin.");
  await viaBackend(faqDraftSchema, "import", () => ctx.backend(ctx.principal.bearer).send("POST", `${base}/import`, parsed.data));
  return afterWrite(ctx);
}

export const faqRoutes = [
  route({ method: "GET", path: "admin/faq", audience: "staff", run: read }),
  route({ method: "PATCH", path: "admin/faq", audience: "staff", mutation: true, run: edit }),
  route({ method: "POST", path: "admin/faq/discard", audience: "staff", mutation: true, run: discard }),
  route({ method: "POST", path: "admin/faq/publish", audience: "staff", mutation: true, run: publish }),
  route({ method: "GET", path: "admin/faq/export", audience: "staff", run: exportFile }),
  route({ method: "POST", path: "admin/faq/import", audience: "staff", mutation: true, run: importFile }),
];
