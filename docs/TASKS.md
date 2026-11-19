# Admin tasks

## Done

- 2026-11-05: Split from the website repo (commit `cb16530`). Admin pages, admin API routes and a
  copy of the common modules; public pages, public routes and their tests removed. `/` redirects to
  `/admin`; `AdminShell` replaces `PublicShell`. Verified locally: `npm run typecheck` passed,
  `npm test` 344/344 passed, `vinext build` completed. The Cloudflare packaging step after the build
  stopped for missing local Firebase settings (no `.dev.vars` in this new checkout). Not run in a
  browser yet.
- 2026-11-13: Server hosting A1 + A2 ported from the website (`cb16530`, `71592a7`; integration step 2,
  decision I-1: the Admin stays its own repo). A1 was already here from the split; A2 replaced it.
  - Node build: `npm run build:node` writes `dist/` and `dist-node/server.mjs` (from
    `scripts/node-server.mjs`); hosted start `node --env-file=envVar/.env dist-node/server.mjs`. Vinext
    builds without the Cloudflare plugin. Settings from the process environment via `lib/settings.ts`;
    `web.env.example` lists every key (adds `PUBLIC_SITE_URL`; drops the website's unused `PROGRESS_SOURCE`).
  - Server contract: listens on `HOST`/`PORT`; refuses to start on a bad `PORT`, a `SITE_SURFACE` other than
    `admin` (optional, so `public` is refused), `FIREBASE_AUTH_EMULATOR_HOST`, or a malformed
    `PUBLIC_SITE_URL`; `GET /api/health` 200 with no auth; SIGTERM closes within 15 s (contract: 20 s);
    `VINEXT_TRUST_PROXY=1` trusts `X-Forwarded-Proto` only (one nginx hop, `X-Forwarded-Host` untrusted).
  - No `SITE_SURFACE` switch or `lib/surface.ts`: the Admin's pages and API routes are admin-only already.
    `proxy.ts` sets `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`.
  - No D1, no R2: `database()` answers 503 until A3; photos are Bunny only. D1 store code, workers-types,
    Wrangler and `media:export` stay until A3.
  - Removed: `@cloudflare/vite-plugin`, `worker/index.ts`, `lib/runtime/*`, `cloudflare-env.d.ts`, `db/index.ts`,
    the Sites connector files, `scripts/deploy-cloudflare.mjs`, `scripts/prepare-cloudflare-deploy.mjs`,
    `npm run cloudflare:prepare`, `tests/cloudflare-deploy.test.mjs`, `tests/runtime.test.mjs`.
  - Account menu: "My account" and "Contribute" link to the public website (`PUBLIC_SITE_URL`, else
    derived from `admin.`/`dev.admin.` hosts, else hidden), not to `/account`/`/contribute` on the admin
    host. "Back to the website" on sign-in uses the same setting. Root layout passes it via `PublicSite`.
  - Verification (local, 2026-11-13, Windows, Node 24.22.0): `npm run typecheck` clean; `npm test`
    340/340 (new `tests/node-hosting.test.mjs`, `tests/public-site.test.mjs`); `npm run build` and
    `npm run build:node` complete. Production server (`dist-node/server.mjs`, env file outside the checkout,
    cloud project id with placeholder web key, mock roles, port 3201): `/api/health` 200; `/admin/sign-in`
    200 and renders with "Back to the website" → `https://dev.playairplanegames.com/`; `/admin` 307 to
    sign-in; `/` 307 to `/admin`; `/sign-out` 200; signed-out `/api/admin/audit` 401; `/account`,
    `/contribute` 404; security headers present; `POST /api/auth/session` from a foreign Origin 403, from
    `https://dev.admin…` with `X-Forwarded-Proto: https` past the origin check (400, no token). With
    `FIREBASE_AUTH_EMULATOR_HOST` set the server prints "Refusing to start" and exits 1. SIGTERM: Windows
    cannot deliver a real SIGTERM, so a preload emitted `SIGTERM` inside the running built server; it logged
    "SIGTERM: closing." and exited 0 within 3 ms. A real signal on Linux is not yet tested.
    Auth emulator (`npm run dev` on 5173, `.dev.vars` from the example, seeded users): the production build
    refuses the demo project and the emulator by design, so the emulator walk ran on the dev server.
    `/admin/sign-in` renders; `seedy@sites.test` signs in (API and in the browser) → `/admin`, `isStaff`
    true; the workspace shows "Could not load the workspace" (D1 503, expected until A3); account menu
    links: My account → `http://127.0.0.1:5174/account`, Contribute → `…/contribute`, Sign out →
    `/sign-out` which lands on `/admin/sign-in`. Browser QA suites were not run. Nothing deployed.

- 2026-11-16: Firebase project, contract 0.27.1, dev demo waiver (website brief
  `docs/briefs/admin-firebase-project-and-demo.md`, rulings in website `docs/intent/hosting-dev-demo.md`).
  - Firebase: `airplane-games-9fe1e` replaces the retired `airplane-games-auth-20261022` in `AGENTS.md`, `.firebaserc`,
    `web.env.example`, `docs/FIREBASE_SETUP.md` (including the provisioner commands) and `docs/BACKEND_SYNC_PLAN.md`.
    `firebase.json` `authorizedDomains` are `localhost`, `127.0.0.1`, `dev.playairplanegames.com`,
    `dev.admin.playairplanegames.com`, identical to the website's (compared). The D1 export keeps the old project
    (`scripts/media-export/bundle.mjs` `REMOTE_PROJECT`, its test, `MEDIA_PLAN.md` line 219); Cloudflare-era docs are history.
  - Contract: `contracts/openapi.yaml` is Backend API 0.27.1 (`6e3512a`), same blob hash. No parser changes were needed.
    `.gitattributes` now pins it to LF: a CRLF checkout (Windows, `core.autocrlf=true`) failed 6 contract tests.
  - Dev demo waiver (`lib/dev-waiver.ts`): `DEV_DEMO_WAIVER=dev-demo` on the dev Admin relaxes only the browser checks
    for a missing licence name (`publishBlockers`) and an empty Plane of the Day source (`editorialErrors`). The server
    refuses to start with any other value or unless `SITE_URL` is a `dev.admin.` origin. The layout ignores it on any
    host other than `dev.admin.<domain>` or loopback. Labels are inferred from records: "Published without a licence
    (dev demo)" for a published version with `licenceName: null` (Media desk versions and list) and "No source (dev
    demo)" for a live Plane of the Day item with no source. The publish confirmation no longer quotes an empty licence name.
  - A3 planned in `docs/A3_PLAN.md`.
  - Verification (local, Windows, Node 24.22.0): `npm run typecheck` clean; `npm test` 347/347 (new
    `tests/dev-waiver.test.mjs`, 7 tests); `npm run build` and `npm run build:node` complete; eslint on the changed
    files reports the same findings as before the change, none new. Not run in a browser; nothing deployed.

- 2026-11-18: A3.0, per-desk loading (`docs/A3_PLAN.md`). The workspace loads submissions, content, audit and Military
  each on its own (`lib/workspace-load.ts`); a desk that needs a failed source shows "Could not load <desk>" with each
  source's message and Retry, and the rest keep working. The Overview renders with what loaded, lists what didn't and
  shows "—" for those counts. Media, Store and Users read none of these sources, so a D1 503 no longer hides them. A
  401/403 or `ACCOUNT_CHANGED` from any one source still blocks the whole workspace before any data is applied; the
  generation guard is unchanged. Demo (read-only) loading is unchanged.
  - Verification (local, Windows, Node 24.22.0): `npm run typecheck` clean; `npm test` 355/355 (new
    `tests/workspace-load.test.mjs`, 8 tests); `npm run build` and `npm run build:node` complete; eslint on
    `AdminApp.tsx` reports the same 13 findings before and after, none new. Browser, auth emulator,
    mock roles, Vite dev server on 5180 (another session held 5173): `seedy@sites.test` signs in → Overview shows "Some
    desks could not load" listing Submissions, Aircraft Identifier and Plane of the Day, Activity with the D1 503
    message, counts "—"; Military readiness shows "Could not load Military readiness" for Military and Submissions.
    Console errors: only the four D1 503s. Not checked: Media, Store and Users with `ROLES_SOURCE=backend` (no local
    Backend was running; in mock mode those desks are hidden by design). Nothing deployed.

- 2026-11-19: A3.1, the Military desk on the game backend (`docs/A3_PLAN.md`; contract 0.24.0 preparation, 0.25.0
  releases, API 0.27.1). `admin/military` routes (`lib/request/military-routes.ts`) replace the D1 ones: `GET` reads the
  `aircraft-identifier-military` items and the release state together; `PUT admin/military/:id/preparation`, `POST
  admin/military/releases`, `POST …/releases/:number/activate` and `POST …/releases/restore` forward to the backend with
  the admin's own token. Strict parsers in `lib/request/military.ts`. With mock roles every route is 404
  `MILITARY_UNAVAILABLE` and no backend call is made. A busy release or module lock is 503 `BUSY` with `Retry-After`
  (nothing changed, so the form stays); a version conflict is 409 and reloads the desk in place (the open question keeps
  its typed form, the base version is not moved); `content_invalid` passes the backend's `errors[]` through as given.
  `BackendError` now carries `errors[]` (additive; `lib/request/backend.ts` is a copied module, see below).
  - Desk (`components/MilitaryWorkspace.tsx`, `lib/military-prep.ts`): questions come from the backend items, not the
    local roster; a photo is linked by `med-` id from the published photos (Media routes) with a preview of the linked
    one; stage pre-checks mirror the backend's rules in its words; stale preparations say "prepare again". Releases:
    choose every question (batch) or only the approved, current, photographed ones (R-3), preview sample Trips, upload,
    then make live; restore steps back. Nothing is delivered. The Military section no longer waits on D1 submissions.
  - The D1 Military routes are gone; their store code (`lib/military.ts` roster and package rules, the editorial
    store's `military` kind) stays until A3.5 removes D1.
  - Independent review (code-reviewer agent) found, and this change fixes: a late save could fill another open
    question's form (the result now applies only to the question still open; the roster is locked while saving); an
    approved question with a withdrawn photo could not be stepped back (every earlier stage is offered now); the crop
    preview was the photo's draft, not the published version a release freezes (the desk now says so when they differ);
    an older upload could be offered as "make live"; reloads could land out of order (sequenced, and an item never goes
    back to an older version); a failed reload after a release step was hidden; a desk-read 404 said "question not
    found". A photo known to be unpublished now blocks the forward stage with a link to the Media desk.
  - Verification (local, Windows, Node 24.22.0): `npm run typecheck` clean; `npm test` 377/377 (new
    `tests/military-routes.test.mjs` with contract checks of every parser, `tests/military-prep.test.mjs`; router tests
    moved off the D1 Military routes); `npm run build` and `npm run build:node` complete; eslint: no new findings.
    Browser walk on the Vite dev server (5179) with the auth emulator and `ROLES_SOURCE=backend` against a LOCAL FAKE
    backend (a scratch script answering the contract's Military and Media routes from the client's sheet rows; not the
    real Backend): 31 questions by rank; link a photo and mark Rights checked (version 2); a change made behind the desk
    gives the conflict notice, reloads the list and keeps the typed text; upload a one-question release and make it live;
    after the fixes, step an approved question straight back to Missing photo.
    Media, Store and Users appear with backend roles. Not checked: the real Backend (none running here), the photo
    preview with a real signed link, and Google sign-in. Nothing deployed.

- 2026-11-19: A3.2, the Aircraft Identifier desk on the game backend (`docs/A3_PLAN.md`; content module `identifier`,
  API 0.27.1). `admin/identifier` routes (`lib/request/identifier-routes.ts`, parsers in `lib/request/identifier.ts` on a
  `contentItemSchema` factory shared with Military): `GET` lists the items; `PATCH :id` edits rank and the whole payload
  (`{ answer, wrong[3], sourceFile }`, the file name sent back unchanged); `POST :id/retire`, `POST :id/restore`; `PUT
  :id/media` links or unlinks a photo (`expectedVersion`). Mock roles: 404 `IDENTIFIER_UNAVAILABLE`, no backend call. An
  edit's 422 `import_invalid` shows the backend's own reasons, which it puts in `error.message`: `BackendError` gained
  `detail` for that (additive; copied module, see below). A lock is 503 `BUSY`; a conflict is 409 and reloads in place.
  - Desk (`components/IdentifierDesk.tsx`, `lib/identifier-desk.ts`): questions by rank; rank and answers editable with
    the backend's payload rules as pre-checks; the client file name is read-only; photo link from the published photos
    with a preview; retire and restore. Questions on one client photo (`ai-a11`/`ai-a11-2`, `ai-a18`/`ai-a18-2`) are
    marked, and one backend photo linked to two different client photos is flagged "Check photo". The photo picker and
    preview moved to `components/PhotoLink.tsx` (shared with Military; the preview's warning is worded per desk).
  - The workspace has an `identifier` source; the Overview's Aircraft Identifier shortcut counts the backend questions.
    The view-only demo account still sees the sample drafts (D1 sample records), as before.
  - Not built (open question in A3_PLAN): the backend's separate editorial kind `identifier` (W1). Ask before adding a
    second Identifier view.
  - Independent review (code-reviewer agent): ship; its four minor findings are fixed (two more malformed-edit cases,
    unreadable roles and a non-admin on these routes, the section erroring on its own source, the preview wording).
  - Verification (local, Windows, Node 24.22.0): `npm run typecheck` clean; `npm test` 388/388 (new
    `tests/identifier-routes.test.mjs`); `npm run build` and `npm run build:node` complete; eslint: no new findings. Browser
    walk on the Vite dev server with the auth emulator and `ROLES_SOURCE=backend` against the LOCAL FAKE backend (scratch
    script; Identifier rows from the Backend's frozen `identifier-v1` fixture): 31 questions, the ai-a11 pair marked; link
    a photo, then save a rank change on the returned version (2 → 3), retire; a change made behind the desk gives the
    conflict notice and reloads. Not checked: the real Backend, a real photo preview, Google sign-in. Nothing deployed.

- 2026-11-19: Unverified editors no longer land on a 404 (client report: "This destination is unavailable." after
  sign-in). `afterSignIn` sent every unverified account to `/account?verify_email=1`, a public-website page the Admin
  doesn't have. For the `admin` audience it now returns the workspace destination (`lib/account.ts`, a copied module:
  the website's other audiences are unchanged), and the workspace's existing access gate decides. Ruling (user,
  2026-11-19): no verify-email step on the Admin; editor access is requested from Admin Support. A verify step was
  built and walked, then removed on that ruling.
  - Verification (local, Windows, Node 24.22.0): `npm run typecheck` clean; `npm test` 388/388 (two new `afterSignIn`
    cases); `npm run build` and `npm run build:node` complete. The earlier emulator walk confirmed an unverified
    sign-in now reaches `/admin` instead of the 404; with the step removed it shows the existing "Access unavailable"
    gate (not re-walked). Nothing deployed.
  - Found while checking: the dev backend is live at `https://dev.api.playairplanegames.com` (routes under `/api/`,
    Swagger at `/api/docs/`), API 0.27.3. 0.27.2 and 0.27.3 change only `servers`, so A3.0–A3.2 match it. Local walks
    still use the demo project, which the real backend does not accept.

- 2026-11-19: A3.4, the Activity desk on the game backend (`docs/A3_PLAN.md`; `GET /v1/admin/audit`, API 0.26.0,
  unchanged through the vendored 0.28.0). `admin/audit` (`lib/request/audit-routes.ts`, parser in `lib/request/audit.ts`)
  replaces the D1 `SELECT … FROM audit_events` route in `lib/request/routes.ts` (same path, so the workspace's `audit`
  source is unchanged). It sends no query (the backend refuses any key) and passes the newest 50 events on as parsed:
  `{ id, entity, action, actor, detail, createdAt }`, strict, the 31 actions pinned to the contract, `detail` an open
  object. Mock roles: 404 `AUDIT_UNAVAILABLE`, no backend call; a 400 or 409 from the backend is off the contract (502).
  - Desk (`components/ActivityDesk.tsx`, `lib/audit-desk.ts`; the old `Activity` in `AdminApp.tsx` is removed): action,
    entity, the actor as the stored principal string with only its prefix kind (account, operator, system), never an
    email or a name; the waiver flags `licenceWaived`, `factualSourceWaived` and `creditWaived` with the value the record
    gives (looked for on every event's own detail keys, not inferred); the stored detail as JSON behind a disclosure;
    the event id and time. No paging. A failed load shows the desk's own error (A3.0); the Overview's "Recent activity"
    count reads "—" then.
  - `creditWaived` is not named in the contract: it is a `media_import` detail key the Backend demo seed writes
    (`"dev-demo"`). `detail` is open in the contract, so the desk shows it like the other two.
  - Independent review (code-reviewer agent): ship after fixes, no blockers. Fixed: the workspace test no longer
    hard-codes the other sources (merge-safe with A3.3); `actor` accepts any string (the contract gives no minimum; the
    500-character caps stay as this website's bound, commented); list roles kept under `list-style: none`; each
    "Detail" disclosure names its event for screen readers. Not changed: the date formatter duplicates `prettyDate`.
  - Verification (local, Windows, Node 24.22.0): `npm run typecheck` clean; `npm test` 398/398 (new
    `tests/audit-routes.test.mjs`, 10 tests: contract keys, actions, limits and no-query; mock, unreadable and
    photographer gates with no backend call; events passed on unchanged with no email or name; off-contract answers;
    each refusal; waiver and actor rules; the desk's own error); `npm run build` and `npm run build:node` complete
    (all four re-run after the review fixes). Not walked in a browser, not against a
    real or fake backend, no Google sign-in. Nothing deployed.
  - Disk: the H: drive (TOSHIBA DT01ACA100) logged I/O errors and a S.M.A.R.T. failure prediction during this slice;
    the user ruled to finish here. `node_modules` in this worktree is a junction to the main checkout's (same lockfile)
    instead of a second install.

## Next

- [ ] A3: move the desks off D1 onto backend API 0.27.1, per `docs/A3_PLAN.md`. A3.0, A3.1 (Military), A3.2
      (Aircraft Identifier) and A3.4 (Activity) are done; Plane of the Day (A3.3) is in progress, then removing D1 (A3.5).
- [ ] Walk the Activity desk with `ROLES_SOURCE=backend` against a local or the dev backend: waiver flags on a waived
      photo publish and a Plane of the Day save, and the actor shown as a principal.
- [ ] `scripts/military-qa.mjs` is stale since A3.1 (D1-shaped Military writes) and its audit check reads the old D1
      fields (`entity_id`, `military_approved`); rewrite it against the backend desks or remove it in A3.5.
- [ ] Ask (user): keep the backend's editorial `identifier` kind (W1) as a second Identifier view, or drop it?
- [ ] Walk the Military and Aircraft Identifier desks on `dev.admin.` against the live dev backend after deploy (the
      dev Admin's `GAME_API_BASE_URL` is the loopback backend, or `https://dev.api.playairplanegames.com/api`).
- [ ] Website session: `afterSignIn` in `lib/account.ts` now keeps the `admin` audience on the Admin (no
      `/account?verify_email=1`); copy it when convenient (the website's own audiences are unaffected).
- [ ] Editor access still needs a verified email (backend ADR-0002 and the mock lists). If Admin Support creates
      email/password accounts, their emails start unverified: they need Google sign-in or a verified email to get in.
- [ ] Website session: `lib/request/backend.ts` gained `BackendError.errors` and `BackendError.detail` (both additive)
      here; copy them there when the website needs the backend's reasons.
- [ ] Walk Media, Store and Users with `ROLES_SOURCE=backend` against a local Backend now that A3.0 lets them load.
- [ ] Open question (Backend/user), still open after A3.1: Military `rights_checked` needs a permission note and
      attribution, and `content_prepared` an https `referenceUrl`. Josh's sheet has no reference URL and the dev waiver
      doesn't cover it. The desk only offers the fields; it never fills them.
- [ ] Set `DEV_DEMO_WAIVER=dev-demo` and `SITE_URL=https://dev.admin.playairplanegames.com` in the dev Admin's env
      file at deploy (user / `server/`), never on the prod Admin.
- [ ] Real SIGTERM on Linux and the hosted start (`dev.admin.`) once `server/` has the Admin repo.

- [ ] Run the Admin locally against the auth emulator and walk sign-in, each desk and sign-out.
- [ ] `server/` (design-docs session): an Admin repo/branch setting, a third deploy key `id_admin`, and the
      Admin's env keys from `web.env.example` (the hosting brief assumed one repo).
- [ ] Create the GitHub repo and add the remote (user).
- [ ] Remove the copied modules the Admin doesn't use once the website side is trimmed: community
      branches in `AuthForm`, `audiences.photographer/player`, `lib/submissions/export.ts`.
- [ ] Give the Admin's dev server its own port so both can run side by side.
- [ ] Decide how the copied common modules are kept in step (README lists them).
