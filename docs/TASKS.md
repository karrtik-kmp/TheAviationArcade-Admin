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

## Next

- [ ] A3: move the desks off D1 onto backend API 0.27.1, per `docs/A3_PLAN.md`. A3.0 (per-desk loading) is done;
      next Military (A3.1), Identifier on `content/identifier`, Plane of the Day, audit, then removing D1.
- [ ] Walk Media, Store and Users with `ROLES_SOURCE=backend` against a local Backend now that A3.0 lets them load.
- [ ] Open question for A3.1 (Backend/user): Military `rights_checked` needs a permission note and attribution, and
      `content_prepared` an https `referenceUrl`. Josh's sheet has no reference URL and the dev waiver doesn't cover it.
- [ ] Set `DEV_DEMO_WAIVER=dev-demo` and `SITE_URL=https://dev.admin.playairplanegames.com` in the dev Admin's env
      file at deploy (user / `server/`), never on the prod Admin.
- [ ] An unverified email signing in is sent to `/account?verify_email=1` (`afterSignIn` in
      `lib/account.ts`), which 404s on the admin host. Send it to the public site or show a notice here.
- [ ] Real SIGTERM on Linux and the hosted start (`dev.admin.`) once `server/` has the Admin repo.

- [ ] Run the Admin locally against the auth emulator and walk sign-in, each desk and sign-out.
- [ ] `server/` (design-docs session): an Admin repo/branch setting, a third deploy key `id_admin`, and the
      Admin's env keys from `web.env.example` (the hosting brief assumed one repo).
- [ ] Create the GitHub repo and add the remote (user).
- [ ] Remove the copied modules the Admin doesn't use once the website side is trimmed: community
      branches in `AuthForm`, `audiences.photographer/player`, `lib/submissions/export.ts`.
- [ ] Give the Admin's dev server its own port so both can run side by side.
- [ ] Decide how the copied common modules are kept in step (README lists them).
