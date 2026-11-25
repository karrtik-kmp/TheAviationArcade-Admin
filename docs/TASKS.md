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

- 2026-11-23: Cross-device layout pass on the workspace (320, 768, 1024, 1440px).
  - `refactor(admin)` (`7705c21`): every workspace rule now lives in `components/admin.css` only; `globals.css` had
    restated the same selectors and admin.css, loading later, cancelled its breakpoints. Pure move plus removal of
    provably overridden declarations; `tests/admin-css.test.mjs` guards it.
  - Fixes: Overview panels stack below 1200px and stats go 2×2 below 1024px; 200px tablet sidebar (brand at 15px so
    it stays on one line); phone header drops the sidebar footer (141px → 68px); "View all →" no longer wraps into a
    column; the Store table no longer widens the page at 768px (`.admin-table-scroll` contains its `.sr-only` header
    label, also on Users) or breaks words mid-word (`overflow-wrap: break-word`); the phone section strip scrolls to
    the current section (`AdminApp.tsx`); 24px minimum for `.admin-back` / `.admin-text-button`; "0 / 31 approved"
    stays on one line.
  - Verification (local, Windows): Auth emulator + local Backend (`ROLES_SOURCE=backend`, a local test admin, the
    client's Military and Aircraft Identifier sheets, 31 each, and 6 seeded store products). Swept every section with
    a script (page overflow, off-screen elements, small targets) and by eye, including both question editors and the
    New product form. Computed styles were compared before and after the refactor. `npm test` 389/389, typecheck
    clean, `npm run build` complete. Not checked: Media with photos (needs Bunny), Submissions / Plane of the Day /
    Activity (D1 desks answer 503), real iOS/Android devices. Nothing deployed.

- 2026-11-24: A3.3, the Plane of the Day desk on the game backend (`docs/A3_PLAN.md`; editorial kind `plane-of-the-day`,
  openapi 0.23.0, vendored API 0.28.0), plus the A3.4 branch merged (`feat/a3-desks`).
  - Routes (`lib/request/potd-routes.ts`, strict parsers in `lib/request/potd.ts`): `GET admin/plane-of-the-day` lists
    the items, `POST` creates a draft from a published photo (`{ mediaId }`, nothing prefilled), `PUT :id` saves the
    whole editable state (`version`, `status`, `data`, `dateKey`). The backend kind becomes the Admin's `potd` at the
    edge only. Mock roles: 404 `POTD_UNAVAILABLE`, no backend call. A 422 `content_invalid` passes `errors[]` on as given;
    a save's 409 is a conflict and reloads the desk in place (form kept, base version not moved); a 409 on create or a
    read is off the contract (502).
  - Desk (`components/PotdDesk.tsx`, `lib/potd-desk.ts`): items by date (scheduled/published) then by last update;
    status and date; every `EditorialData` field (the staff credit note is marked never public); exactly three
    distractors; difficulty empty or a rank id. Pre-checks mirror the save route's rules: title 3+, description 15+,
    https source, a date for scheduled/published, instagram handle or https link, a real calendar date. The dev waiver
    allows only an EMPTY source; a live item without one reads "No source (dev demo)". The empty state is the plan's
    text. A new workspace source `potd`; the Overview shortcut counts backend items. The view-only demo keeps the
    sample drafts. `LinkedPhoto` takes a `subject` so its warning says "feature" here.
  - Recovery: the A3.3 worktree (`claude/a3-3-plane-of-the-day-2a2316`) had a zeroed git index and its edits to
    `routes.ts`, `rules.ts` and `workspace-load.ts` were all-NUL files (the failing H: drive); `potd.ts` and
    `potd-routes.ts` were intact and are used as found. The lost edits were rewritten; `rules.ts` is unchanged (the
    desk's rules live in `lib/potd-desk.ts`). That worktree is left as it was.
  - Verification (local, Windows, Node 24.22.0): `npm run typecheck` clean; `npm test` 410/410 (new
    `tests/potd-routes.test.mjs`, 11 tests: contract keys/enums, gates with no backend call, what is sent, malformed
    writes never leave, each refusal, the desk's rules and the waiver); `npm run build` and `npm run build:node`
    complete; eslint on the new files clean. Browser walk on the Vite dev server (5179) with the auth emulator and
    `ROLES_SOURCE=backend` against a LOCAL FAKE backend (scratch script, test data, not the real Backend): the
    pre-checks list the four missing fields; schedule ed-1 for 2026-12-01 (version 1 → 2); a change made behind the
    desk gives the conflict notice, reloads to version 3 and keeps the typed text; create a draft from med-2; Overview
    counts 2 items; no page overflow at 375px. Not checked: the real Backend, a real photo preview, the dev waiver on
    `dev.admin.`, Google sign-in. Nothing deployed.
- 2026-11-25: A3 fix wave, commit 1, which fixes the review of A3.3 and A3.4. The plan is `docs/A3_FIX_WAVE.md`, revision
  4, approved at the plan gate.
  - Plane of the Day text over 2400 characters now reaches the backend, which refuses it with a 422 that names the
    field. Before, the Admin refused it with a 400 that named nothing.
    - The request schemas take plain strings, and the response schema keeps the bound.
    - The desk's pre-check measures length the way the backend does (CRLF becomes LF, then trim, then count code
      points). It names the field with the label the form shows.
  - The Activity desk accepts any well-formed audit action (`^[a-z][a-z0-9_]{0,63}$`). This is deliberately looser
    than the contract's closed list, so a new backend action no longer turns the whole log into a 502. The drift test
    still pins the known list.
  - A 400 or 413 when loading the Plane of the Day list is now BACKEND_CONTRACT, since that read takes no input.
  - Verification:
    - typecheck clean; `npm test` 413/413; `npm run build` and `npm run build:node` complete; eslint clean on the
      changed files.
    - Code review: SHIP.
    - No browser walk. The changes are server-side mapping and a pre-check, and unit tests cover them.
- 2026-11-25: A3 fix wave, commit 2 (B1a). Submissions is now the Media desk in review mode, on the game backend's
  media. It replaces the D1 desk, whose code is removed in commit 4.
  - The desk lists "Unverified" and "Changes waiting". The Media desk keeps Published, Withdrawn and All (decision D2).
  - Review checks (D3): five boxes gate Publish. They belong to one revision of the photo, so any change to it starts
    them again (`reviewKey`, `reviewReady` in `lib/media-form.ts`). Publish re-checks them at confirm.
  - Rights are the photographer's to state (`PUT .../rights` is owner-only, and an admin's 403 would sign them out).
    The reviewer sees "Only the photographer can state the rights; this photo can't be published until they do."
  - After a publish the desk offers two actions, shown only while the photo is still published:
    - "Start a Plane of the Day draft" creates the draft, records its base version (`openPotd`), then opens it on
      the Plane of the Day desk.
    - "Link to an Aircraft Identifier question" goes to that desk with a note (D4).
  - Account change:
    - Submissions, Media and Plane of the Day remount per account (`key={sessionKey}`).
    - The arrival draft is cleared with the other private data.
  - Media routes drop `owner` for non-staff callers as defence in depth; the backend already omits it.
  - The Submissions nav entry shows only with backend roles (D1).
  - Verification:
    - typecheck clean; `npm test` 422/422.
    - eslint: no new errors; the react-hooks errors in AdminApp and MediaDesk are already at HEAD.
    - Browser walk on Vite (5179) with the auth emulator, `ROLES_SOURCE=backend` and a LOCAL FAKE backend (a
      scratch script with test data, not the real Backend):
      - med-2, with no rights, shows the five checks and the owner-only blocker, and Publish stays blocked.
      - A revision bump behind the desk gives the conflict notice and resets the checks.
      - Publishing med-1 removes it from the queue.
      - "Start a Plane of the Day draft" creates ed-1 and opens it, and the next save sent `version: 1`.
      - At 375px there is no overflow, and each check row is at least 44px high.
    - Code review: SHIP AFTER FIXES. Fixed: the arrival draft outlived an account change, and the photo actions
      stayed after a withdraw. The checklist rule was moved out of the component so it can be tested.
    - Not covered by tests: the component flow itself (the repo has no React harness). The walk above covers it.
- 2026-11-25: A3 fix wave, commit 3 (B1b). The staff Overview now counts from the game backend.
  - **Stats.**
    - Staff see "Photos to review", "Changes waiting" and "Recent activity". The demo keeps its one sample stat.
    - The counts come from the first page of each list, shown as "50+" (or "100+" for photographer requests) when
      there is more. The backend gives no totals.
  - **Removed for staff.** The D1 "Content records" stat, "Load demo data", the D1 queue and the "does not publish
    into the game backend" note. The Overview no longer reads or reports the D1 sources.
  - **Queue and badge.**
    - The queue lists the first five photo ids to review.
    - The nav badge shows the photos-to-review count, with screen-reader text.
  - **Submissions panel.** A "New photographers" panel shows the count of pending photographer requests and links
    to Users.
  - **How the counts load.** This departs from the plan: they come from a small hook (`components/useReviewCounts.ts`)
    instead of workspace-load sources, because those are fetched for every section and a refresh would unmount the
    open editor.
    - They load only for an admin on backend roles whose account is confirmed.
    - They reload when the Overview or Submissions opens, and after a save, publish or withdraw.
    - A 401, 403 or ACCOUNT_CHANGED from any list blocks, and no count is applied (`reviewBlock`).
    - Counts read for one account are never rendered for another.
  - **Stats grid.**
    - The row sizes to its stats (`auto-fit`) and draws its dividers with a 1px gap.
    - At 1023px and below, an odd last stat spans the row.
    - The fixed `nth-child` border rules are gone.
  - **Verification.**
    - typecheck clean; `npm test` 425/425; eslint has no new errors.
    - Browser walk against the LOCAL FAKE backend:
      - counts 2 and 1, the badge shows 2, and the queue lists med-2 and med-1;
      - the panel reads "2 waiting for approval";
      - no empty stat cell and no horizontal overflow at 1280, 1100, 900 and 375 px;
      - opening Submissions read the counts again.
    - Code review: SHIP. Its four minors are fixed: counts tied to the account at render time, a reload on opening
      the section, the confirmed-account gate, and a tested block rule.
    - Not walked: mock roles, the demo Overview, and a count refresh after a publish.

- 2026-11-25: A3 fix wave, commit 4 (B2): D1 is removed from the Admin (A3.5). This finishes the A3 plan's desk moves.
  - **Removed.** Done by an implementer subagent and reviewed by the lead.
    - Every D1 route: submissions, `submissions/:id/photo`, admin/submissions, admin/content, admin/demo, and
      admin/references, which had no UI user.
    - The D1 route deps (`db`, `photos`, `editorial`, `content`, `references`) and the `submissions/` member rule
      in the router. An unknown `submissions/...` path is now a plain 404.
    - `lib/server.ts`, `lib/editorial/{content-d1,d1-store,memory-store,store,content}.ts`, `db/`,
      `drizzle.config.ts`, the `db:generate` script, and the drizzle copy in the sites vite plugin.
    - The `submissions` and `content` workspace sources, and the dead D1 code in AdminApp. ContentWorkspace stays
      as the view-only demo of the samples.
    - The D1 store tests.
    - `scripts/military-qa.mjs`, and `scripts/military-release-qa.mjs`, which was built on D1 fixtures and the
      pre-A3.1 API. `tests/military-routes.test.mjs` covers releases.
  - **QA scripts.**
    - The D1 steps are removed.
    - The admin probes now use surviving staff routes.
    - `/api/submissions*` is expected to answer a plain 404.
    - A real cross-origin write check (POST to Plane of the Day, 403) replaces the D1 one.
    - The stale-fence check is a real Plane of the Day PUT, which answers 409.
  - **Kept until the user confirms the D1 backup (decision D5).**
    - The export tool: `npm run media:export`, `scripts/media-export/*` and `lib/submissions/export.ts`.
    - Its test fixtures: `lib/submissions/d1.ts`, `lib/d1/kernel.ts`, `drizzle/0000_*.sql` and
      `tests/support/d1-sqlite.mjs`.
    - Bunny storage.
    - Wrangler and miniflare, workers-types, and the Cloudflare config and settings.
    - `drizzle-orm` and `drizzle-kit` stay in package.json, unused. The implementer's lockfile rewrite was too
      large to take on this drive, so they go with media-export.
  - **Guard test.** `tests/node-hosting.test.mjs` checks that no `D1Database` appears under `lib/` outside the two
    fixtures.
  - **Verification.**
    - typecheck clean; `npm test` 389/389 (the D1 store tests are gone); `npm run build` and `npm run build:node`
      complete.
    - The export tests pass 66/66 offline.
    - eslint: no new errors, and 7 old unused-variable warnings are gone.
    - The browser walk on the local fake backend shows the Overview, Submissions, Plane of the Day, Activity and Media
      unchanged.
    - Code review: SHIP. Its minors are fixed: the fence comment, the cross-origin check, these TASKS entries, the
      router-copy note in the README, and the comment wrap.
    - The QA scripts were parse-checked only, not run.

## Next

- [x] A3: move the desks off D1 onto the backend, per `docs/A3_PLAN.md`. A3.0 to A3.5 are done on `feat/a3-desks`
      (with the A3 fix wave, `docs/A3_FIX_WAVE.md`). Not pushed.
- [ ] Once the user confirms the D1 backup exists: remove media-export and its whole keep list in one commit
      (`scripts/media-export/*`, `scripts/export-d1-media.mjs`, `lib/submissions/{export,d1}.ts`, `lib/d1/`,
      `drizzle/`, `tests/support/d1-sqlite.mjs`, the media-export tests, `reviewError`/`ReviewChecks` if unused,
      wrangler and miniflare, `@cloudflare/workers-types`, `drizzle-orm`, `drizzle-kit`,
      `config/cloudflare-prototype.json`, `scripts/cloudflare-local-settings.mjs`, `.dev.vars.cloudflare.example`,
      `docs/MEDIA_PLAN.md:219`). Never touch `.wrangler/state` or the D1 database itself.
- [ ] `data/reference-airports.json` and `scripts/fetch-reference-data.py` have no reader in the Admin since
      `admin/references` went (A3.5): delete them, or keep them if the website uses its own copy.
- [ ] Backend 0.30.0 (proposed, needs the user's OK): photo review feedback (decline / request changes with a reason
      the photographer sees). The Admin adds the buttons when it lands. With it: `AuditEvent.action` as an open set, a
      `hasMore`/total on `listMedia`, a list thumbnail.
- [ ] `lib/request/military.ts:51,57`: `.max(2400)` counts UTF-16 units on the raw text; check against the Military
      contract wording.
- [ ] Walk mock roles (Submissions hidden, no review counts) and the demo Overview (one stat, full row).
- [ ] Walk the Plane of the Day desk against the real Backend's demo seed (`pod-4` … `pod-8`): publish the photos in
      Media, re-run the seed, then schedule one; and with `DEV_DEMO_WAIVER=dev-demo` on `dev.admin.`.
- [ ] Walk the Activity desk with `ROLES_SOURCE=backend` against a local or the dev backend: waiver flags on a waived
      photo publish and a Plane of the Day save, and the actor shown as a principal.
- [x] `scripts/military-qa.mjs` was stale since A3.1; removed in A3.5 with `scripts/military-release-qa.mjs`.
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
