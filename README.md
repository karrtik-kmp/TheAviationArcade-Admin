# Airplane Games — Admin

The editorial workspace for The Aviation Arcade: the photo-proposal review desk, the Aircraft
Identifier, Plane of the Day and Military desks, the Media desk, the Store desk and Users (roles).
It's the Admin that will run as `admin.playairplanegames.com` (`dev.admin.` for the dev copy).

This repo was split from the website repo (`H:\Work\TheAviationArcade\website`, commit `cb16530`)
on 2026-11-05. It holds the admin pages, the admin API routes and a **copy** of the shared modules
they need. The public website, its pages and its public API routes stay in the website repo.

Product login is **Firebase email/password and Google only**. Hosting gates and headers never
authorize actions.

## What came across and what didn't

| Here | Left in the website repo |
|---|---|
| `/admin`, `/admin/sign-in`, `/sign-out`; `/` redirects to `/admin` | Home, games, Plane of the Day, play, account, contribute, public sign-in |
| API: `admin/*`, `media/*`, `submissions/:id/photo`, `auth/*`, `account` | API: `featured`, `photos/:id`, member `submissions`, `me/roles*` |
| Admin desks: `AdminApp`, `MediaDesk`, `MilitaryWorkspace`, `StoreDesk`, `StorePlayer`, `StorePurchases`, `UsersDesk` | `AccountPage`, `Featured`, `Games`, `MediaContribute`, `PhotographerAccess`, `SubmissionForm` |
| `AdminShell` (brand, theme, account menu) | `PublicShell` (site navigation and footer) |

### Copied common modules

These exist in **both** repos. A fix to one (especially auth, session, roles or the request
router) must be made in the other as well until they're shared properly:

- Auth and session: `lib/firebase-client.ts`, `lib/firebase-config.ts`, `lib/firebase-verifier.ts`,
  `lib/product-auth.ts`, `lib/account.ts`, `lib/account-server.ts`, `lib/access.ts`,
  `app/api/auth/*`, `app/api/account`, `components/AccountSession.tsx`, `AccountControl.tsx`,
  `AccessGate.tsx`, `AuthForm.tsx`, `SignInRoute.tsx`, `SignOutPage.tsx`
- Requests and roles: `lib/request/{router,principal,roles,backend,worker,firebase-token-verifier}.ts`
  (the Admin's `router.ts` has no D1 deps and no `submissions/` member rule since A3.5; don't carry those back),
  `lib/errors.ts`, `lib/runtime/*`
- Content and data: `lib/catalog.ts`, `lib/rules.ts`, `lib/types.ts`, `lib/military.ts`,
  `lib/editorial/*`, `lib/submissions/*`, `lib/d1/*`, `lib/bunny-storage.ts`, `lib/photo-storage.ts`,
  `lib/media-form.ts`, `lib/request/media*.ts`, `drizzle/`, `contracts/`
- Platform: `lib/paths.ts`, `lib/settings.ts`, `components/SiteLink.tsx`, `components/Providers.tsx`,
  `lib/demo-*`, `proxy.ts`, `scripts/node-server.mjs`, build/test `scripts/`, styles and fonts

Admin-only changes made to the copies: `accountSignInPath` always goes to `/admin/sign-in`, the
access gates drop the public `/account`, `/contribute` and `/play` links, sign-out lands on
`/admin/sign-in`. The account menu's "My account" and "Contribute" and the sign-in page's "Back to the
website" link to the public website (`PUBLIC_SITE_URL`, else derived from the admin host, else hidden;
`lib/website-url.ts`). Unlike the website, the Admin has no `SITE_SURFACE` switch (`lib/surface.ts`): its
pages and API routes are admin-only already; `proxy.ts` only sets the security headers.

### Shared state

Both apps read and write the **same** data: the Bunny photo zone and the game backend. The Node build
has no D1, and the Admin no longer has any D1 route: every desk reads the game backend (the old `/api/submissions/*` is
a plain 404). The D1 code left under `lib/` is the fixture set for the D1 backup export (`npm run media:export`).

## Commands

Use Node.js 24 (minimum 22.13).

- Install: `npm run install:ci`
- Local settings: copy `.dev.vars.example` to `.dev.vars` (never commit it)
- Auth emulator (terminal 1, port 9099): `npm run auth:emulator`; then `npm run demo:seed`
- Dev server (terminal 2): `npm run dev`, then open `/admin/sign-in`. It uses the same port as the
  website's dev server, so run one at a time.
- Checks: `npm run typecheck`, `npm test`, `npm run build`, `npm run build:node`

## Hosting

The Admin runs as a Node process on our Hostinger server (`docs/briefs/website-admin-hosting.md` and
`server/` in the design-docs folder): `admin.playairplanegames.com` on port 3200, `dev.admin.` on 3201.
There is no `deploy` script and no Cloudflare Worker any more.

- Build: `npm ci`, then `npm run build:node` (writes `dist/` and `dist-node/server.mjs`).
- Start, from the checkout: `node --env-file=envVar/.env dist-node/server.mjs`. Settings come from the
  process environment only (`lib/settings.ts`); `web.env.example` lists every key.
- The server refuses to start on a bad `PORT`, a `SITE_SURFACE` other than `admin` (optional), a
  `FIREBASE_AUTH_EMULATOR_HOST`, or a `PUBLIC_SITE_URL` that is not an http(s) origin. It listens on
  `HOST`/`PORT`, answers `GET /api/health` with 200 and no auth, trusts `X-Forwarded-Proto` from the one
  nginx hop (`VINEXT_TRUST_PROXY=1`; `X-Forwarded-Host` stays untrusted) and exits within 15 s on SIGTERM.
- `npm start` runs the built server locally with `.dev.vars`; a production build refuses the demo
  project and the emulator, so walk sign-in on `npm run dev` instead.

## Rules

See `AGENTS.md`. The website repo's rules apply here unchanged.
