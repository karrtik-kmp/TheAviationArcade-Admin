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

## Next

- [ ] A3: move the desks off D1 onto backend API 0.26.0. Until then the workspace loads submissions,
      content, audit and military (all D1) together, so it shows "Could not load the workspace" and the
      backend-only Media, Store and Users desks are unreachable too. Degrade per desk or finish A3 first.
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
