/**
 * The Plane of the Day desk on the game backend (A3.3, docs/A3_PLAN.md). Admins list the `plane-of-the-day` editorial
 * items, create a draft from a published photo, and save an item's status, text and date (scheduling is `scheduled`
 * with a `dateKey`), through the game backend with their own Firebase ID token. A save is optimistic on the item
 * version; a conflict is never retried or resent with another version. The backend's reasons (`errors[]`) are passed on
 * as given. Only with `ROLES_SOURCE=backend`: on a mock deployment every route is 404 POTD_UNAVAILABLE and no backend
 * call is made. Zod issues, inputs and URLs are never logged or echoed. Relative imports only.
 */
import { HttpError, respond } from "../errors.ts";
import { BackendError, BackendNotConnected } from "./backend.ts";
import { jsonBody } from "./military-routes.ts";
import {
  potdBackendKind,
  potdChangeSchema,
  potdCreatedSchema,
  potdCreateRequestSchema,
  potdErrorCodes as codes,
  potdIdPattern,
  potdItemListSchema,
  potdSaveRequestSchema,
} from "./potd.ts";
import { route, type RouteContext } from "./router.ts";
import type { ZodType, ZodTypeDef } from "zod";

type Ctx = RouteContext<"member">;
type Step = "read" | "create" | "save";

const base = `/v1/admin/editorial/${potdBackendKind}`;
const notConnected = () =>
  new HttpError(503, "The Plane of the Day desk needs the game backend, which is not connected to this website.", codes.BACKEND_NOT_CONNECTED);
const contract = () => new HttpError(502, "The game backend answered off its contract.", codes.BACKEND_CONTRACT);
const invalid = (message: string) => new HttpError(400, message, codes.INVALID_REQUEST);
const notFound = () => new HttpError(404, "That Plane of the Day item was not found.", codes.NOT_FOUND);
const seconds = (value?: number) => (value === undefined ? undefined : Math.max(1, Math.ceil(value)));

/** In order: mock deployment, no backend, roles unreadable, then the admin role itself. */
function gate(ctx: Ctx) {
  const { roles } = ctx.principal;
  if (roles.status === "ok" && roles.source === "mock")
    throw new HttpError(
      404,
      "The Plane of the Day desk runs on the game backend, so it is not available while this website uses mock roles.",
      codes.POTD_UNAVAILABLE,
    );
  if (roles.status === "not-connected") throw notConnected();
  if (roles.status === "unavailable")
    throw new HttpError(503, "Your access could not be checked because the game backend is unavailable. Please try again.", codes.ROLES_UNAVAILABLE);
  if (!ctx.principal.staff) throw new HttpError(403, "This is available to admins only.", codes.FORBIDDEN);
}

/** Maps a backend failure to what the desk says. A refusal's reasons are kept as `errors`, as the backend gave them. */
export function potdFailure(error: unknown, step: Step): never {
  if (error instanceof BackendNotConnected) throw notConnected();
  if (error instanceof BackendError) {
    const { status, code, errors, detail } = error;
    // The list takes no input, so the contract gives it no 400 or 413 (openapi `listEditorialItems`): off the contract.
    if (status === 400 && step !== "read") throw new HttpError(400, "The game backend rejected this request.", codes.INVALID_REQUEST);
    if (status === 401) throw new HttpError(401, "Your sign-in has expired. Sign in again.", codes.SIGNED_OUT);
    if (status === 403)
      throw new HttpError(403, "The game backend refused this. It needs an active admin role and a verified email.", codes.FORBIDDEN);
    if (status === 404)
      throw step === "read" || step === "create"
        ? new HttpError(404, "The game backend does not offer the Plane of the Day desk. It needs API 0.23.0 or later.", codes.NOT_FOUND)
        : notFound();
    // Only a save is versioned (contract: 409 `version_conflict`); anything else is off the contract.
    if (status === 409 && step === "save") throw new HttpError(409, "Someone changed this Plane of the Day item first.", codes.VERSION_CONFLICT);
    if (status === 413 && step !== "read") throw new HttpError(413, "That request is too large.", codes.TOO_LARGE);
    if (status === 422 && code === "content_invalid" && step !== "read") {
      // `EditorialInvalid`: every reason in `errors`, and `error.message` repeats them.
      const reasons = errors.length ? errors : detail ? [detail] : undefined;
      throw new HttpError(
        422,
        step === "create" ? "This photo cannot be used for Plane of the Day yet." : "The game backend refused this save.",
        codes.CONTENT_INVALID,
        reasons,
      );
    }
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
    potdFailure(error, step);
  }
  const parsed = schema.safeParse(answer);
  if (!parsed.success) throw contract();
  return parsed.data;
}

async function parsedBody<T>(ctx: Ctx, schema: ZodType<T, ZodTypeDef, unknown>, message: string): Promise<T> {
  const parsed = schema.safeParse(await jsonBody(ctx));
  if (!parsed.success) throw invalid(message);
  return parsed.data;
}

async function list(ctx: Ctx) {
  gate(ctx);
  return respond(await viaBackend(potdItemListSchema, "read", () => ctx.backend(ctx.principal.bearer).getJson(`${base}/items`)));
}

async function create(ctx: Ctx) {
  gate(ctx);
  const body = await parsedBody(ctx, potdCreateRequestSchema, "Choose a published photo from the list.");
  return respond(
    await viaBackend(potdCreatedSchema, "create", () => ctx.backend(ctx.principal.bearer).send("POST", `${base}/items`, body)),
    201,
  );
}

async function save(ctx: Ctx) {
  gate(ctx);
  const { id } = ctx.params;
  if (!potdIdPattern.test(id)) throw notFound();
  const body = await parsedBody(ctx, potdSaveRequestSchema, "The item is not complete or has a value the game backend does not accept.");
  return respond(await viaBackend(potdChangeSchema, "save", () => ctx.backend(ctx.principal.bearer).send("PUT", `${base}/items/${id}`, body)));
}

export const potdRoutes = [
  route({ method: "GET", path: "admin/plane-of-the-day", audience: "staff", run: list }),
  route({ method: "POST", path: "admin/plane-of-the-day", audience: "staff", mutation: true, run: create }),
  route({ method: "PUT", path: "admin/plane-of-the-day/:id", audience: "staff", mutation: true, run: save }),
];
