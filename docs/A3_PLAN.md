# A3: the desks on the backend, for the dev demo (plan, not built)

**Written** 2026-11-16 by the Admin session. **Sources:** the website brief `docs/briefs/admin-firebase-project-and-demo.md`
§2–§3, the rulings in website `docs/intent/hosting-dev-demo.md` (I-4 … I-7, the dev waiver), the Backend hand-over of
2026-11-16 and the vendored contract `contracts/openapi.yaml` (API 0.27.1, Backend `6e3512a`). Nothing here is built yet.

## Goal

On `dev.admin.playairplanegames.com` the user, as admin, can show Josh his own content and publish it:

1. the Military desk listing the 31 rows (`mil-a1` … `mil-a31`) and moving them through the stages;
2. publishing photos in the Media desk (built, backend already);
3. a Military release;
4. Aircraft Identifier: the 31 questions of the 2026-09-28 delivery;
5. Plane of the Day: publishing and scheduling one of `pod-4` … `pod-8`.

All of it on the backend with the 409 → reload rule kept (a conflict reloads the item and keeps the typed text; never retried
under another account, never overwriting another editor's version). Only client content: an empty desk says why, it is never
filled with samples.

## Slices, in order

Each slice is one focused commit with its tests; the desks that are already on the backend (Media, Store, Users) keep working
throughout.

### A3.0 Degrade per desk (first, small)

Today the workspace loads submissions, content, audit and Military from D1 together, so one 503 hides every desk, including the
backend-only Media, Store and Users desks. Load each desk on its own and show its own error. This alone unblocks the Media desk on
dev, which the demo needs first (step 1 of the order below).

### A3.1 Military desk on `content/aircraft-identifier-military`

- List: `GET /v1/admin/content/aircraft-identifier-military/items` (`ContentItemList`, strict parser like `lib/request/media.ts`).
  Shows id, rank, status, the answer, the linked photo (`mediaId`) and `preparation` (`stage`, `stale`). 31 rows on dev.
- Stages: `PUT .../items/{id}/preparation` with `{ version, stage, evidence, mediaId }`. Forward one stage at a time, back to any
  earlier one. The desk mirrors the cumulative rules as pre-checks only (the backend decides) and shows the 422 `errors[]` as
  given. A stale preparation says "prepare again". 409 → reload.
- Media guard: from `rights_checked` on, the linked photo must be a published photo. So the desk links to the Media desk for an
  unpublished photo instead of offering the stage.
- Release: `GET/POST .../releases`, `POST .../releases/{version}/activate`, `POST .../releases/restore`. Show the
  `ReleaseRefusal.errors[]` reasons as they come. Release routes are Military-only (404 for `identifier`).
- **Open question (Backend/user, before A3.1 can reach `content_prepared`):** the stage rules need, at `rights_checked`, a
  permission note (10+ characters) and an attribution (2+), and at `content_prepared` an https `referenceUrl`. Josh's sheet gives
  no reference URL, and the dev waiver covers only the photo licence, the Plane of the Day source and 4 credits. Either the user
  rules what the admin records there, or the Backend extends the waiver. The Admin must not make up a URL or a permission text.

### A3.2 Aircraft Identifier desk on `content/identifier`

- The 31 questions live in the content module `identifier` (Backend slice I3, API 0.27.0), not in editorial items. List with
  `GET /v1/admin/content/identifier/items`, the same `ContentItem` shape as Military, so the parser is shared.
- Ids come from the sheet: `ai-a1` … `ai-a31` without `ai-a8` and `ai-a14`, plus `ai-a11-2` and `ai-a18-2`. Edit, retire, restore
  and the media link use the existing `content/{module}/items/...` routes. No preparation and no releases for `identifier` yet
  (404): the desk doesn't offer them.
- **Shared photos:** `ai-a11`/`ai-a11-2` and `ai-a18`/`ai-a18-2` each share one photo, so the two questions of a pair can't be in
  one release (`content_release_items_photo`). The list marks each pair. When Identifier releases exist (not built on the
  Backend), the release desk shows this as a refusal reason, from the backend's `errors[]`.
- The backend's editorial kind `identifier` (W1) is a different desk. The seed doesn't use it, so the demo doesn't show it. Ask
  whether it stays before building a second Identifier view.

### A3.3 Plane of the Day desk on `editorial/plane-of-the-day`

- `GET/POST /v1/admin/editorial/plane-of-the-day/items`, `PUT .../items/{id}`. The backend kind is `plane-of-the-day`; the
  Admin's `potd` maps to it at the edge.
- **Order of work on dev** (the empty state says it):
  1. the dev backend's `DEV_DEMO_WAIVER=dev-demo` is set and the backend restarted, then the first seed run uploads the 5 photos as
     drafts (credit "Josh M");
  2. the user publishes each photo in the Media desk (with the Admin's own `DEV_DEMO_WAIVER=dev-demo`, no licence name is needed);
  3. a second seed run creates the 5 Plane of the Day drafts, since a draft needs a published photo;
  4. the user publishes and schedules one.
  Empty-state text: "No Plane of the Day drafts yet. Publish their photos in the Media desk, then run the content seed again."
- Pre-check: `editorialErrors("potd", data, { devDemoWaiver })` (built): no source is allowed with the waiver; a source that is
  given must be https.
- A live item with an empty `factualSource` reads "No source (dev demo)" (`factualSourceText`, built).

### A3.4 Audit desk on `GET /v1/admin/audit`

Newest 50 events, no paging. Shows the waiver flags (`media_publish.licenceWaived`, `editorial_save.factualSourceWaived`,
`creditWaived`) as written. The actor is a principal, never mapped to an email.

### A3.5 Remove D1

Nothing is migrated (I-4), so no reader for old records is kept. Remove the D1 desks' code (`lib/editorial/content-d1.ts`,
`lib/editorial/d1-store.ts`, `lib/submissions/d1.ts`, `lib/d1/`, `db/`, `drizzle/`, `drizzle.config.ts`, D1 routes in
`lib/request/routes.ts`, the workers types and Wrangler) and their tests. **Keep** `npm run media:export`,
`scripts/media-export/*` (with `REMOTE_PROJECT` still the old Firebase project) and `MEDIA_PLAN.md` line 219 until the user
confirms the D1 backup exists; remove them in a separate commit after that. Never delete the D1 database or touch Cloudflare from
here: the user does that after the demo works, with their yes at that point. D1 schema changes go to both repos, so tell the
website session when this lands.

## The dev waiver (built 2026-11-16, see `lib/dev-waiver.ts`)

- `DEV_DEMO_WAIVER=dev-demo` in the dev Admin's env file. The hosted server refuses to start with any other value, or unless
  `SITE_URL` is a `https://dev.admin.<domain>` origin; pages ignore it on any host that is not `dev.admin.<domain>` or loopback.
- It relaxes only `publishBlockers` (licence name) and `editorialErrors` (Plane of the Day source, when empty). Credit and rights
  are still checked. The backend stays the authority.
- Labels come from the records: a published version with `licenceName: null` reads "Published without a licence (dev demo)"; a
  live Plane of the Day item with an empty source reads "No source (dev demo)". A licence name or source is never shown when it
  isn't there.

## Verification per slice

`npm run typecheck`, `npm test`, `npm run build`, `npm run build:node`. Contract tests check each new parser against
`contracts/openapi.yaml`. Then a local walk on the auth emulator with a local backend, and on `dev.admin.` after the deploy, by
the user (Google sign-in on each host is checked by a person, B2).
