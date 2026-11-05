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
- Requests and roles: `lib/request/{router,principal,roles,backend,worker,firebase-token-verifier}.ts`,
  `lib/errors.ts`, `lib/server.ts`, `lib/runtime/*`
- Content and data: `lib/catalog.ts`, `lib/rules.ts`, `lib/types.ts`, `lib/military.ts`,
  `lib/editorial/*`, `lib/submissions/*`, `lib/d1/*`, `lib/bunny-storage.ts`, `lib/photo-storage.ts`,
  `lib/media-form.ts`, `lib/request/media*.ts`, `db/`, `drizzle/`, `contracts/`
- Platform: `lib/paths.ts`, `components/SiteLink.tsx`, `components/Providers.tsx`, `lib/connector*`,
  `lib/demo-*`, `worker/`, build/test `scripts/`, styles and fonts

Admin-only changes made to the copies: `accountSignInPath` always goes to `/admin/sign-in`, the
account menu and access gates drop the public `/account`, `/contribute` and `/play` links, sign-out
lands on `/admin/sign-in`, and "Back to the website" points at the matching public host
(`lib/website-url.ts`) or is hidden locally.

### Shared state

Both apps read and write the **same** data: the D1 database (content, submissions, audit), the
Bunny photo zone and the game backend. Schema changes go to both repos.

## Commands

Use Node.js 24 (minimum 22.13).

- Install: `npm run install:ci`
- Local settings: copy `.dev.vars.example` to `.dev.vars` (never commit it)
- Auth emulator (terminal 1, port 9099): `npm run auth:emulator`; then `npm run demo:seed`
- Dev server (terminal 2): `npm run dev`, then open `/admin/sign-in`. It uses the same port as the
  website's dev server, so run one at a time.
- Checks: `npm run typecheck`, `npm test`, `npm run build`

There is no `deploy` script. The Admin is meant to run on our Hostinger server
(`docs/briefs/website-admin-hosting.md` and `server/` in the design-docs folder). It still builds
for Cloudflare Workers until the Node build exists. `config/cloudflare-prototype.json` names its
Worker `aviation-arcade-admin`, so a manual Worker deploy can never replace the website's Worker.
`npm run build` ends with the Cloudflare packaging step, which needs the Firebase settings in
`.dev.vars`.

## Rules

See `AGENTS.md`. The website repo's rules apply here unchanged.
