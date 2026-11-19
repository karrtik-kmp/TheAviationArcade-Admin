/**
 * The Activity desk on the game backend (A3.4, docs/A3_PLAN.md). Admins read the newest 50 audit events through the
 * game backend with their own Firebase ID token; no query is sent (the backend refuses any key). The answer is parsed
 * strictly and passed on unchanged: the actor stays the principal string and is never mapped to an email or a name.
 * Only with `ROLES_SOURCE=backend`: on a mock deployment the route is 404 AUDIT_UNAVAILABLE and no backend call is made.
 * Zod issues and URLs are never logged or echoed. Relative imports only.
 */
import { HttpError, respond } from "../errors.ts";
import { auditErrorCodes as codes, auditEventListSchema } from "./audit.ts";
import { BackendError, BackendNotConnected } from "./backend.ts";
import { route, type RouteContext } from "./router.ts";

type Ctx = RouteContext<"member">;

const path = "/v1/admin/audit";
const notConnected = () =>
  new HttpError(503, "The Activity desk needs the game backend, which is not connected to this website.", codes.BACKEND_NOT_CONNECTED);
const contract = () => new HttpError(502, "The game backend answered off its contract.", codes.BACKEND_CONTRACT);
const seconds = (value?: number) => (value === undefined ? undefined : Math.max(1, Math.ceil(value)));

/** In order: mock deployment, no backend, roles unreadable, then the admin role itself. */
function gate(ctx: Ctx) {
  const { roles } = ctx.principal;
  if (roles.status === "ok" && roles.source === "mock")
    throw new HttpError(
      404,
      "The Activity desk reads the game backend's audit log, so it is not available while this website uses mock roles.",
      codes.AUDIT_UNAVAILABLE,
    );
  if (roles.status === "not-connected") throw notConnected();
  if (roles.status === "unavailable")
    throw new HttpError(503, "Your access could not be checked because the game backend is unavailable. Please try again.", codes.ROLES_UNAVAILABLE);
  if (!ctx.principal.staff) throw new HttpError(403, "This is available to admins only.", codes.FORBIDDEN);
}

/** Maps a backend failure to what the desk says. The read sends no query, so a 400 is off the contract. */
export function auditFailure(error: unknown): never {
  if (error instanceof BackendNotConnected) throw notConnected();
  if (error instanceof BackendError) {
    const { status } = error;
    if (status === 401) throw new HttpError(401, "Your sign-in has expired. Sign in again.", codes.SIGNED_OUT);
    if (status === 403)
      throw new HttpError(403, "The game backend refused this. It needs an active admin role and a verified email.", codes.FORBIDDEN);
    if (status === 404)
      throw new HttpError(404, "The game backend does not offer the audit log. It needs API 0.26.0 or later.", codes.NOT_FOUND);
    if (status === 429)
      throw new HttpError(429, "Too many requests. Wait a moment and try again.", codes.RATE_LIMITED, undefined, seconds(error.retryAfter));
    if (status >= 400 && status < 500) throw contract();
    throw new HttpError(503, "The game backend is unavailable. Please try again.", codes.BACKEND_UNAVAILABLE);
  }
  throw error;
}

async function list(ctx: Ctx) {
  gate(ctx);
  let answer: unknown;
  try {
    answer = await ctx.backend(ctx.principal.bearer).getJson(path);
  } catch (error) {
    auditFailure(error);
  }
  const parsed = auditEventListSchema.safeParse(answer);
  if (!parsed.success) throw contract();
  return respond(parsed.data);
}

export const auditRoutes = [route({ method: "GET", path: "admin/audit", audience: "staff", run: list })];
