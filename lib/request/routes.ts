/**
 * The Admin's API route table: every route with its audience, and the handlers. The router
 * (router.ts) has already resolved the principal, applied the account fence and the audience,
 * and checked the origin of mutations before a handler runs. Handlers parse the request and call
 * a store: photographer submissions under review (lib/submissions/d1.ts), the Aircraft Identifier
 * and Plane of the Day desks (ContentStore) and the Military desk (EditorialStore). Relative imports only, so
 * the table loads under `node --test`.
 */
import { HttpError, respond } from "../errors.ts";
import {
  EditorialError,
  packageOf,
  packagesOf,
  release,
  type LiveState,
} from "../editorial/store.ts";
import {
  allSubmissions,
  findSubmission,
  loadDemoData,
  reviewSubmission,
} from "../submissions/d1.ts";
import { route, type Route, type RouteContext } from "./router.ts";
import { roleRoutes } from "./role-routes.ts";
import { mediaRoutes } from "./media-routes.ts";
import { storeRoutes } from "./store-routes.ts";
import { storePurchaseRoutes } from "./store-purchase-routes.ts";

type Ctx = RouteContext<"member">;

async function bodyJson(request: Request) {
  const raw = await request.text();
  if (raw.length > 24000) throw new HttpError(413, "The form is too large.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "The request is not valid JSON.");
  }
}
/** Store refusals become HTTP errors with the same words; a release refusal keeps its reasons. */
async function editorialCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof EditorialError)
      throw new HttpError(error.status, error.message, undefined, error.errors);
    throw error;
  }
}
const privatePhoto = (body: ReadableStream | null, mime: string) =>
  new Response(body, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });

/**
 * Photographer submissions are stored in the backend and Bunny, not this website's database
 * (PROJECT_STATE 11-04, D-2 amended). The website's own proposal routes take nothing new and show
 * members nothing, in every mode; admins can still read existing proposals until they are migrated
 * to backend media. The handlers below stay only for that migration and are removed after it.
 */
function submissionsClosed(_ctx: Ctx) {
  throw new HttpError(
    404,
    "Photo proposals on this website are closed. Approved photographers upload in the photo area.",
    "SUBMISSIONS_CLOSED",
  );
}

async function submissionPhoto(ctx: Ctx, id: string) {
  // Admins keep reviewing existing proposals; members are closed out in every mode (D-2 amended 11-04).
  if (!ctx.principal.staff) submissionsClosed(ctx);
  const row = await findSubmission(ctx.db(), id);
  if (row.owner_id !== ctx.principal.userId && !ctx.principal.staff)
    throw new HttpError(404, "Photograph not found.");
  const object = await ctx.photos().get(String(row.image_key));
  if (!object) throw new HttpError(404, "Photograph unavailable.");
  return privatePhoto(object.body, String(row.image_mime));
}

async function review(ctx: Ctx, id: string) {
  const body = await bodyJson(ctx.request);
  return respond({ submission: await reviewSubmission(ctx.db(), ctx.principal.userId, id, body) });
}

async function createContent(ctx: Ctx) {
  const body = await bodyJson(ctx.request);
  const record = await editorialCall(() =>
    ctx.content().createDraft(
      body.kind,
      body.sourceId ? { submissionId: String(body.sourceId) } : body.sample === true ? { sample: true } : { submissionId: "" },
      { principal: ctx.principal.userId },
    ),
  );
  return respond({ record }, 201);
}

async function saveContent(ctx: Ctx, id: string) {
  const body = await bodyJson(ctx.request);
  const record = await editorialCall(() =>
    ctx.content().save(
      id,
      { baseVersion: body.version, status: body.status, data: body.data, dateKey: body.dateKey },
      { principal: ctx.principal.userId },
    ),
  );
  return respond({ record });
}

/** The desk's JSON shape: saved packages, the latest releases with their status, and the live pointer. */
async function militaryState(ctx: Ctx, live?: LiveState) {
  const listed = await ctx.editorial().list("military");
  const { releases, ...pointer } = live ?? listed.live;
  return { packages: packagesOf(listed.items), releases, pointer };
}

/**
 * Saves the package for one question in the client's Military sheet. Version 0 creates it.
 * The answer and wrong answers always come from the sheet. Approval never publishes.
 */
async function saveMilitary(ctx: Ctx, aircraftId: string) {
  const body = await bodyJson(ctx.request);
  const item = await editorialCall(() =>
    ctx.editorial().saveDraft(
      "military",
      aircraftId,
      { baseVersion: body.version, stage: body.stage, evidence: body.data },
      { principal: ctx.principal.userId },
    ),
  );
  return respond({ package: packageOf(item) });
}

/**
 * Records a batch release of every approved package: an uploaded candidate, then made live.
 * If another editor wins in between, the candidate stays listed as uploaded. Nothing is
 * delivered or published.
 */
async function releaseMilitary(ctx: Ctx) {
  const body = await bodyJson(ctx.request);
  const live = await editorialCall(() =>
    release(
      ctx.editorial(),
      "military",
      { basis: body.basis, previewed: body.previewed, liveVersion: body.pointerVersion },
      { principal: ctx.principal.userId },
    ),
  );
  return respond(await militaryState(ctx, live));
}

/** Makes an uploaded candidate live, if its packages and photographs are unchanged since upload. */
async function activateMilitary(ctx: Ctx) {
  const body = await bodyJson(ctx.request);
  const live = await editorialCall(() =>
    ctx.editorial().activate(
      "military",
      { release: body.release, liveVersion: body.pointerVersion },
      { principal: ctx.principal.userId },
    ),
  );
  return respond(await militaryState(ctx, live));
}

/** Makes the release before the current one current again. */
async function restoreMilitary(ctx: Ctx) {
  const body = await bodyJson(ctx.request);
  const live = await editorialCall(() =>
    ctx.editorial().restore("military", { liveVersion: body.pointerVersion }, { principal: ctx.principal.userId }),
  );
  return respond(await militaryState(ctx, live));
}

async function auditEvents(ctx: Ctx) {
  const rows = await ctx
    .db()
    .prepare("SELECT entity_id,action,detail,created_at FROM audit_events ORDER BY created_at DESC LIMIT 50")
    .all();
  return respond({ events: rows.results });
}

/** Literal paths come before parameter paths that could match them. */
export const routes: Route[] = [
  route({ method: "GET", path: "submissions/:id/photo", audience: "owner", run: (ctx) => submissionPhoto(ctx, ctx.params.id) }),
  route({
    method: "POST",
    path: "admin/demo",
    audience: "staff",
    mutation: true,
    run: async (ctx) => {
      await loadDemoData(ctx.db(), ctx.principal.userId);
      return respond({ seeded: true });
    },
  }),
  route({ method: "GET", path: "admin/references", audience: "staff", run: async (ctx) => respond(await ctx.references()) }),
  route({
    method: "GET",
    path: "admin/submissions",
    audience: "staff",
    run: async (ctx) => respond({ submissions: await allSubmissions(ctx.db()) }),
  }),
  route({ method: "PATCH", path: "admin/submissions/:id", audience: "staff", mutation: true, run: (ctx) => review(ctx, ctx.params.id) }),
  route({
    method: "GET",
    path: "admin/content",
    audience: "staff",
    run: async (ctx) => respond({ records: await ctx.content().list() }),
  }),
  route({ method: "POST", path: "admin/content", audience: "staff", mutation: true, run: createContent }),
  route({ method: "PUT", path: "admin/content/:id", audience: "staff", mutation: true, run: (ctx) => saveContent(ctx, ctx.params.id) }),
  route({ method: "GET", path: "admin/military", audience: "staff", run: async (ctx) => respond(await militaryState(ctx)) }),
  route({ method: "POST", path: "admin/military/releases", audience: "staff", mutation: true, run: releaseMilitary }),
  route({ method: "POST", path: "admin/military/releases/activate", audience: "staff", mutation: true, run: activateMilitary }),
  route({ method: "POST", path: "admin/military/releases/restore", audience: "staff", mutation: true, run: restoreMilitary }),
  route({ method: "PUT", path: "admin/military/:id", audience: "staff", mutation: true, run: (ctx) => saveMilitary(ctx, ctx.params.id) }),
  route({ method: "GET", path: "admin/audit", audience: "staff", run: auditEvents }),
  ...roleRoutes,
  ...mediaRoutes,
  ...storeRoutes,
  ...storePurchaseRoutes,
];
