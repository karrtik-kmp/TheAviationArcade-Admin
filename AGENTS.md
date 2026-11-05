# Airplane Games Admin guide

Admin source: `H:/Work/TheAviationArcade/Admin`, split from the website repo on 2026-11-05. Start
with README.md (what was split and which modules are copies) and docs/TASKS.md, then check Git status.

## Commands

- Install: `npm run install:ci`
- Local auth: `npm run auth:emulator` (demo project, port 9099), then `npm run demo:seed`
- Admin: `npm run dev`, open `/admin/sign-in`
- Checks: `npm run typecheck`, `npm test`, `npm run build`

## Durable boundaries

- Product authentication is Firebase email/password and Google only. Hosting gates and headers
  never authorize product actions.
- Cloud project is `airplane-games-auth-20261022`; local tests use `demo-airplane-games` only.
  Never commit `.dev.vars*`, tokens, service-account keys or Bunny passwords.
- Server principal = Firebase project + UID. Never reassign content ownership by matching contact
  email, photo credit or display name.
- Roles come from the game backend (Backend ADR-0002) with `ROLES_SOURCE=backend`; `ROLES_SOURCE=mock`
  (default) reads `MOCK_ADMIN_EMAILS`/`MOCK_PHOTOGRAPHER_EMAILS`. Unreadable roles fail closed. No
  client-selected role grants privileges.
- Keep session-generation guards, the account-change fence and draft base versions. Never retry a
  failed write under a different account or overwrite another editor's version.
- Publishing needs approval and usage offers; demo content is nonpublishable. Demo admin is view-only.
- App paths are unprefixed (`/admin`); use `SiteLink`, `sitePath`, `navigateTo`.
- The website repo has copies of the common modules (README.md lists them). A fix to auth, session,
  roles or the router goes to both repos. D1 schema changes go to both.
- Use only client-supplied content; don't invent questions, answers, awards or thresholds.

Make focused commits, record actual verification, update docs/TASKS.md. Never rewrite published history.
