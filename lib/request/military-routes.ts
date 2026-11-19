/**
 * The Military desk on the game backend (A3.1, docs/A3_PLAN.md; openapi 0.24.0 and 0.25.0). Admins list the
 * `aircraft-identifier-military` items with the release state, save each item's preparation, and upload, make live or
 * restore a release, all through the game backend with their own Firebase ID token. Releases are RECORDED, NOT
 * DELIVERED: nothing here reaches a player. Only with `ROLES_SOURCE=backend`: on a mock deployment every route is 404
 * MILITARY_UNAVAILABLE and no backend call is made. The backend authorises and checks every rule again; its reasons
 * (`errors[]`) are passed on as given. A failure is mapped to a website code, never retried and never resent with
 * another version. Zod issues, inputs and URLs are never logged or echoed. Relative imports only.
 */
import { HttpError, respond } from "../errors.ts";
import { BackendError, BackendNotConnected } from "./backend.ts";
import {
  contentItemIdPattern,
  militaryErrorCodes as codes,
  militaryItemListSchema,
  militaryModule,
  preparationChangeSchema,
  preparationRequestSchema,
  releaseListSchema,
  releaseNumberPattern,
  releasePointerRequestSchema,
  releaseStateSchema,
  releaseSummarySchema,
  releaseUploadRequestSchema,
  type MilitaryDesk,
} from "./military.ts";
import { route, type RouteContext } from "./router.ts";
import type { ZodType } from "zod";

type Ctx = RouteContext<"member">;
/** What the request was, which decides the wording of a refusal. */
type Step = "read" | "prepare" | "upload" | "activate" | "restore";

/** The backend refuses a body over 16 KB (about 600 release ids); so does this route, before any call. */
const MAX_JSON_BYTES = 16384;
const base = `/v1/admin/content/${militaryModule}`;

const notConnected = () =>
  new HttpError(503, "The Military desk needs the game backend, which is not connected to this website.", codes.BACKEND_NOT_CONNECTED);
const contract = () => new HttpError(502, "The game backend answered off its contract.", codes.BACKEND_CONTRACT);
const invalid = (message: string) => new HttpError(400, message, codes.INVALID_REQUEST);
const tooLarge = () => new HttpError(413, "That request is too large.", codes.TOO_LARGE);
const seconds = (value?: number) => (value === undefined ? undefined : Math.max(1, Math.ceil(value)));

/** In order: mock deployment, no backend, roles unreadable, then the admin role itself. */
function gate(ctx: Ctx) {
  const { roles } = ctx.principal;
  if (roles.status === "ok" && roles.source === "mock")
    throw new HttpError(
      404,
      "The Military desk runs on the game backend, so it is not available while this website uses mock roles.",
      codes.MILITARY_UNAVAILABLE,
    );
  if (roles.status === "not-connected") throw notConnected();
  if (roles.status === "unavailable")
    throw new HttpError(503, "Your access could not be checked because the game backend is unavailable. Please try again.", codes.ROLES_UNAVAILABLE);
  if (!ctx.principal.staff) throw new HttpError(403, "This is available to admins only.", codes.FORBIDDEN);
}

const conflictText: Record<Step, string> = {
  read: "The Military desk changed while it was loading. Reload it.",
  prepare: "Someone changed this question first.",
  upload: "The packages changed since this preview. Reload, preview the sample Trips again and release.",
  activate: "The release or its packages changed since it was uploaded.",
  restore: "Someone changed the current release first. Reload and decide again.",
};
const refusalText: Record<Step, string> = {
  read: "The game backend refused this request.",
  prepare: "The game backend refused this stage.",
  upload: "This batch cannot be released yet.",
  activate: "This release cannot be made live.",
  restore: "The earlier release cannot be restored.",
};

/** Maps a backend failure to what the desk says. The backend's own reasons are kept as `errors`. */
export function militaryFailure(error: unknown, step: Step): never {
  if (error instanceof BackendNotConnected) throw notConnected();
  if (error instanceof BackendError) {
    const { status, code, errors } = error;
    if (status === 400) throw new HttpError(400, "The game backend rejected this request.", codes.INVALID_REQUEST);
    if (status === 401) throw new HttpError(401, "Your sign-in has expired. Sign in again.", codes.SIGNED_OUT);
    if (status === 403)
      throw new HttpError(403, "The game backend refused this. It needs an active admin role and a verified email.", codes.FORBIDDEN);
    if (status === 404)
      throw new HttpError(
        404,
        step === "activate"
          ? "That release was not found."
          : step === "prepare"
            ? "That question was not found."
            : "The game backend does not offer the Military desk. It needs API 0.25.0 or later.",
        codes.NOT_FOUND,
      );
    if (status === 409) {
      if (code === "release_in_progress" || code === "import_in_progress") {
        const wait = seconds(error.retryAfter);
        // Not a version conflict: nothing changed, so the form stays as it is and a retry is safe.
        throw new HttpError(
          503,
          `Another release step or an import is running. Try again${wait ? ` in ${wait} seconds` : " shortly"}.`,
          codes.BUSY,
          undefined,
          wait,
        );
      }
      if (code === "nothing_to_publish")
        throw new HttpError(409, "This batch is already the current release.", codes.NOTHING_TO_PUBLISH);
      // A conflict reloads; the reasons go into the message, which the desk shows with the reload.
      throw new HttpError(409, [conflictText[step], ...errors].join(" "), codes.VERSION_CONFLICT, errors);
    }
    if (status === 413) throw tooLarge();
    if (status === 422) {
      if (code === "unknown_item_ids")
        throw new HttpError(422, "The release names a question the game backend does not store. Reload the desk.", codes.UNKNOWN_ITEMS);
      if (code === "content_invalid") throw new HttpError(422, refusalText[step], codes.CONTENT_INVALID, errors);
      throw contract();
    }
    if (status === 429)
      throw new HttpError(429, "Too many requests. Wait a moment and try again.", codes.RATE_LIMITED, undefined, seconds(error.retryAfter));
    if (status >= 400 && status < 500) throw contract();
    throw new HttpError(503, "The game backend is unavailable. Please try again.", codes.BACKEND_UNAVAILABLE);
  }
  throw error;
}

async function viaBackend<T>(schema: ZodType<T>, step: Step, run: () => Promise<unknown>): Promise<T> {
  let answer: unknown;
  try {
    answer = await run();
  } catch (error) {
    militaryFailure(error, step);
  }
  const parsed = schema.safeParse(answer);
  if (!parsed.success) throw contract();
  return parsed.data;
}

/** Reads a JSON body, cancelling as soon as it passes the limit; a lying Content-Length cannot get past this. */
export async function jsonBody(ctx: Ctx): Promise<unknown> {
  const declared = ctx.request.headers.get("content-length");
  if (declared !== null && /^[0-9]{1,15}$/.test(declared.trim()) && Number(declared) > MAX_JSON_BYTES) throw tooLarge();
  const reader = ctx.request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
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

async function parsedBody<T>(ctx: Ctx, schema: ZodType<T>, message: string): Promise<T> {
  const parsed = schema.safeParse(await jsonBody(ctx));
  if (!parsed.success) throw invalid(message);
  return parsed.data;
}

/** The items and the release state in one read; the desk shows both together. */
async function desk(ctx: Ctx) {
  gate(ctx);
  const backend = ctx.backend(ctx.principal.bearer);
  const [list, releases] = await Promise.all([
    viaBackend(militaryItemListSchema, "read", () => backend.getJson(`${base}/items`)),
    viaBackend(releaseListSchema, "read", () => backend.getJson(`${base}/releases`)),
  ]);
  const body: MilitaryDesk = { items: list.items, ...releases };
  return respond(body);
}

async function prepare(ctx: Ctx) {
  gate(ctx);
  const { id } = ctx.params;
  if (!contentItemIdPattern.test(id)) throw new HttpError(404, "That question was not found.", codes.NOT_FOUND);
  const body = await parsedBody(ctx, preparationRequestSchema, "The preparation is not complete or has a value the game backend does not accept.");
  return respond(
    await viaBackend(preparationChangeSchema, "prepare", () =>
      ctx.backend(ctx.principal.bearer).send("PUT", `${base}/items/${encodeURIComponent(id)}/preparation`, body),
    ),
  );
}

async function upload(ctx: Ctx) {
  gate(ctx);
  const body = await parsedBody(ctx, releaseUploadRequestSchema, "Choose at least one question, each once, and preview the sample Trips first.");
  return respond(
    await viaBackend(releaseSummarySchema, "upload", () => ctx.backend(ctx.principal.bearer).send("POST", `${base}/releases`, body)),
    201,
  );
}

async function pointerStep(ctx: Ctx, step: "activate" | "restore") {
  gate(ctx);
  let path = `${base}/releases/restore`;
  if (step === "activate") {
    const { number } = ctx.params;
    if (!releaseNumberPattern.test(number) || Number(number) > 2147483647)
      throw new HttpError(404, "That release was not found.", codes.NOT_FOUND);
    path = `${base}/releases/${number}/activate`;
  }
  const body = await parsedBody(ctx, releasePointerRequestSchema, "Reload the desk before changing the current release.");
  return respond(await viaBackend(releaseStateSchema, step, () => ctx.backend(ctx.principal.bearer).send("POST", path, body)));
}

export const militaryRoutes = [
  route({ method: "GET", path: "admin/military", audience: "staff", run: desk }),
  route({ method: "PUT", path: "admin/military/:id/preparation", audience: "staff", mutation: true, run: prepare }),
  route({ method: "POST", path: "admin/military/releases", audience: "staff", mutation: true, run: upload }),
  route({
    method: "POST",
    path: "admin/military/releases/:number/activate",
    audience: "staff",
    mutation: true,
    run: (ctx) => pointerStep(ctx, "activate"),
  }),
  route({ method: "POST", path: "admin/military/releases/restore", audience: "staff", mutation: true, run: (ctx) => pointerStep(ctx, "restore") }),
];
