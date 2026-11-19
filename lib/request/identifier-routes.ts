/**
 * The Aircraft Identifier desk on the game backend (A3.2, docs/A3_PLAN.md). Admins list the `identifier` content items
 * (the client's 2026-09-28 sheet), edit a question's rank and answers, retire or restore it and link its photo, through
 * the game backend with their own Firebase ID token. Each write is optimistic on the item version; a conflict is never
 * retried or resent with another version. Only with `ROLES_SOURCE=backend`: on a mock deployment every route is 404
 * IDENTIFIER_UNAVAILABLE and no backend call is made. Zod issues, inputs and URLs are never logged or echoed.
 * Relative imports only.
 */
import { HttpError, respond } from "../errors.ts";
import { BackendError, BackendNotConnected } from "./backend.ts";
import {
  identifierChangeSchema,
  identifierEditRequestSchema,
  identifierErrorCodes as codes,
  identifierIdPattern,
  identifierItemListSchema,
  identifierMediaRequestSchema,
  identifierModule,
  identifierVersionRequestSchema,
} from "./identifier.ts";
import { jsonBody } from "./military-routes.ts";
import { route, type RouteContext } from "./router.ts";
import type { ZodType } from "zod";

type Ctx = RouteContext<"member">;
type Step = "read" | "edit" | "retire" | "restore" | "media";

const base = `/v1/admin/content/${identifierModule}`;
const notConnected = () =>
  new HttpError(503, "The Aircraft Identifier desk needs the game backend, which is not connected to this website.", codes.BACKEND_NOT_CONNECTED);
const contract = () => new HttpError(502, "The game backend answered off its contract.", codes.BACKEND_CONTRACT);
const invalid = (message: string) => new HttpError(400, message, codes.INVALID_REQUEST);
const notFound = () => new HttpError(404, "That question was not found.", codes.NOT_FOUND);
const seconds = (value?: number) => (value === undefined ? undefined : Math.max(1, Math.ceil(value)));

/** In order: mock deployment, no backend, roles unreadable, then the admin role itself. */
function gate(ctx: Ctx) {
  const { roles } = ctx.principal;
  if (roles.status === "ok" && roles.source === "mock")
    throw new HttpError(
      404,
      "The Aircraft Identifier desk runs on the game backend, so it is not available while this website uses mock roles.",
      codes.IDENTIFIER_UNAVAILABLE,
    );
  if (roles.status === "not-connected") throw notConnected();
  if (roles.status === "unavailable")
    throw new HttpError(503, "Your access could not be checked because the game backend is unavailable. Please try again.", codes.ROLES_UNAVAILABLE);
  if (!ctx.principal.staff) throw new HttpError(403, "This is available to admins only.", codes.FORBIDDEN);
}

/** Maps a backend failure to what the desk says. */
export function identifierFailure(error: unknown, step: Step): never {
  if (error instanceof BackendNotConnected) throw notConnected();
  if (error instanceof BackendError) {
    const { status, code } = error;
    if (status === 400) throw new HttpError(400, "The game backend rejected this request.", codes.INVALID_REQUEST);
    if (status === 401) throw new HttpError(401, "Your sign-in has expired. Sign in again.", codes.SIGNED_OUT);
    if (status === 403)
      throw new HttpError(403, "The game backend refused this. It needs an active admin role and a verified email.", codes.FORBIDDEN);
    if (status === 404)
      throw step === "read"
        ? new HttpError(404, "The game backend does not offer the Aircraft Identifier content. It needs API 0.27.0 or later.", codes.NOT_FOUND)
        : notFound();
    if (status === 409) {
      if (code === "import_in_progress") {
        const wait = seconds(error.retryAfter);
        // Nothing changed, so the form stays and a retry is safe; not a version conflict.
        throw new HttpError(
          503,
          `An import or another edit of this game is running. Try again${wait ? ` in ${wait} seconds` : " shortly"}.`,
          codes.BUSY,
          undefined,
          wait,
        );
      }
      throw new HttpError(409, "Someone changed this question first.", codes.VERSION_CONFLICT);
    }
    if (status === 413) throw new HttpError(413, "That request is too large.", codes.TOO_LARGE);
    if (status === 422) {
      // An edit's reasons are in the backend's message (contract: "with the reasons in `message`").
      if (step === "edit" && code === "import_invalid")
        throw new HttpError(
          422,
          "The game backend refused this question.",
          codes.CONTENT_INVALID,
          error.detail ? [error.detail] : undefined,
        );
      if (step === "media" && code === "media_invalid")
        throw new HttpError(422, "That photo does not exist in the game backend. Reload the photos and choose again.", codes.MEDIA_INVALID);
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
    identifierFailure(error, step);
  }
  const parsed = schema.safeParse(answer);
  if (!parsed.success) throw contract();
  return parsed.data;
}

async function parsedBody<T>(ctx: Ctx, schema: ZodType<T>, message: string): Promise<T> {
  const parsed = schema.safeParse(await jsonBody(ctx));
  if (!parsed.success) throw invalid(message);
  return parsed.data;
}

function itemPath(ctx: Ctx, suffix = "") {
  const { id } = ctx.params;
  if (!identifierIdPattern.test(id)) throw notFound();
  return `${base}/items/${id}${suffix}`;
}

async function list(ctx: Ctx) {
  gate(ctx);
  return respond(await viaBackend(identifierItemListSchema, "read", () => ctx.backend(ctx.principal.bearer).getJson(`${base}/items`)));
}

async function edit(ctx: Ctx) {
  gate(ctx);
  const path = itemPath(ctx);
  const body = await parsedBody(ctx, identifierEditRequestSchema, "The question is not complete or has a value the game backend does not accept.");
  return respond(await viaBackend(identifierChangeSchema, "edit", () => ctx.backend(ctx.principal.bearer).send("PATCH", path, body)));
}

async function status(ctx: Ctx, step: "retire" | "restore") {
  gate(ctx);
  const path = itemPath(ctx, `/${step}`);
  const body = await parsedBody(ctx, identifierVersionRequestSchema, "Reload the question before changing it.");
  return respond(await viaBackend(identifierChangeSchema, step, () => ctx.backend(ctx.principal.bearer).send("POST", path, body)));
}

async function media(ctx: Ctx) {
  gate(ctx);
  const path = itemPath(ctx, "/media");
  const body = await parsedBody(ctx, identifierMediaRequestSchema, "Choose a photo from the list, or none.");
  return respond(await viaBackend(identifierChangeSchema, "media", () => ctx.backend(ctx.principal.bearer).send("PUT", path, body)));
}

export const identifierRoutes = [
  route({ method: "GET", path: "admin/identifier", audience: "staff", run: list }),
  route({ method: "PATCH", path: "admin/identifier/:id", audience: "staff", mutation: true, run: edit }),
  route({ method: "POST", path: "admin/identifier/:id/retire", audience: "staff", mutation: true, run: (ctx) => status(ctx, "retire") }),
  route({ method: "POST", path: "admin/identifier/:id/restore", audience: "staff", mutation: true, run: (ctx) => status(ctx, "restore") }),
  route({ method: "PUT", path: "admin/identifier/:id/media", audience: "staff", mutation: true, run: media }),
];
