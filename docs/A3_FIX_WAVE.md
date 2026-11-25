# A3 fix wave and A3.5 (revision 4) — DONE 2026-11-25

All five commits landed on `feat/a3-desks` (6577a27, b5140a8, 0761e79, 0239f6c and the 0.29.0 commit); see
`docs/TASKS.md` for each one's verification. Kept as the record the TASKS entries cite.

Branch `feat/a3-desks`, on top of `d63636f`. Nothing is pushed.

**Sources.**
- The code review of `3118390..feat/a3-desks` (SHIP AFTER FIXES).
- Plan review of revision 2, by the senior lead and frontend.
- Plan review of revision 3, by the senior lead, frontend, backend and devops: all APPROVE WITH CHANGES, with three blockers between them. All of it is folded in here.
- The user's direction, 2026-11-24: fold A3.5 in, and keep the Submissions desk so admins can review photographers' photos, bring on new photographers and grow the community.

**Rulings it rests on.**
- D-2 amended (11-04, `../docs/PROJECT_STATE.md:85`): photographer submissions are backend media. Photographers upload with `X-Rights-Statement`.
- I-4 (website `docs/intent/hosting-dev-demo.md:20`): nothing is migrated from D1, which is exported read-only. This supersedes 11-04's "migrate".
- I-5 (`:23-24`): staff uploads are unverified too, so the queue is "Photos to review", not only photographers'.
- A3_PLAN §A3.5: media-export stays until the user confirms the D1 backup. Never delete the D1 database or touch Cloudflare.

**Commits.** Four, in order, each verified and code-reviewed on its own. The last one deletes this file and moves "Out of scope" into `docs/TASKS.md` "Next".

**Decisions taken by the lead** (the user can overturn any of them):

| # | Decision |
|---|---|
| D1 | Under mock roles, Submissions is **hidden** from the nav, like Media, Store and Users. There is no backend to review against, so this matches 11-04's "closed until the backend is hosted". |
| D2 | Submissions owns the review views ("Unverified", "Changes waiting"). The Media desk keeps Published, Withdrawn and All, so each list appears in only one nav entry. |
| D3 | The review checklist is: photo quality is fit for the game; credit matches the photographer; licence is correct; rights statement present; nothing private or unsafe in the image. **Every box must be ticked before Publish is enabled.** |
| D4 | "Link to an Aircraft Identifier question" goes to the Identifier desk with the note "Photo med-N is ready to link: open a question and choose it" (option a). Nothing is preselected. |
| D5 | The D1 test fixtures used by media-export stay until the backup is confirmed: `lib/submissions/d1.ts` write helpers, `drizzle/0000_*.sql` and `tests/support/d1-sqlite.mjs`. They are not rewritten now, so `@cloudflare/workers-types` stays for now too. |

---

## Commit 1: review fixes (Part A)

**F1. Plane of the Day lengths.** The backend counts length as `[...text.replace(/\r\n/g,"\n").trim()].length`, with a limit of 2400; going over is a 422 that names the field. Basis: openapi EditorialData around line 6625, and Backend `editorial-rules.ts:113-117`.
- `lib/request/potd.ts`: split `potdDataSchema` in two.
  - The response schema keeps the 2400 bound. That is safe because the backend stores the normalised text.
  - The request schema uses `z.string()`. The 16 KB `jsonBody` cap still applies, and distractors stay `.max(20)`.
- `lib/potd-desk.ts`:
  - Export the field-label map, moved from `PotdDesk.tsx:30-38`.
  - `potdErrors` names each over-long field and distractor at any status: "‹Label› is ‹n› characters; the limit is 2400."
  - No HTML `maxLength`. Control characters other than LF are left to the backend's 422.
- Tests:
  - `"a\r\n".repeat(1200)` passes.
  - 2400 × `"\u{1D538}"` passes, and 2401 is named.
  - "Distractor 2" is named.
  - 2500 characters reach the backend's 422 `errors[]`.
  - 21 distractors give a 400.

**F2. Unknown audit actions.** One action the Admin doesn't know should not turn the whole list into a 502.
- `lib/request/audit.ts`:
  - `action` becomes `z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)`.
  - The docblock notes this is deliberately looser than the enum at openapi 4607-4610.
  - `AuditEvent["action"]` becomes `string`.
- No UI change.
- Tests:
  - The drift test stays.
  - `future_thing` and `release_v2` parse.
  - Uppercase and 65-character actions still give a 502.

**F4. Off-contract read statuses.** `lib/request/potd-routes.ts` handles 400 (`:57`) and 413 (`:66`) only when `step !== "read"`. Tests: a 400 or 413 on the list gives 502 BACKEND_CONTRACT, and save behaviour is unchanged.

---

## Commit 2 (B1a): Submissions is the Media desk in review mode

The desk reuses the Media desk; it is not a second copy. It uses only routes that are already in the contract and already wrapped, served at **`/api/media…`** with audience member and the photographer gate (`media-routes.ts:320-336`).

**`components/MediaDesk.tsx`** (owned by B1a).
- Export the detail editor `DeskDetail` as `MediaEditor`, with these new optional props:
  - `onPublished(item)`: fired after the success reload.
  - `afterPublish?: ReactNode`: shown next to the success notice, which already takes focus.
  - `reviewChecklist?`: a `<fieldset>`/`<legend>` with Fluent `Checkbox` rows and 44px targets.
    - It resets when the item id or `revision` changes.
    - It joins `publishBlocked`, and adds "Finish the review checks" to the existing `aria-describedby` blocker list. The button is never disabled without saying why.
  - `confirmNote?: string`: replaces "isn't done here" at `:680-681` and `:909-912`, which the new actions contradict.
- `MediaDesk` gains these props:
  - `views` (a subset of `ViewKey`), plus heading and empty-state text;
  - `onChanged()`, so AdminApp can refresh the counts.
- `callMedia`, `blockStatus`, `NoticeBar`, the write fence and all form state stay in this one module.

**Rights are owner-only.** The backend refuses a non-owner (`media.service.ts:557-561`). The Admin maps that 403 to roleLost, which would sign the admin out. So the reviewer **does not** set rights. The editor shows the rights line read-only. When the statement is missing or isn't `v1_*` (for example an import's `d1_private_review`), Publish is blocked with: "Only the photographer can state the rights; this photo can't be published until they do."

**The revision rule.**
- Publish sends the revision from the latest PATCH response, never the revision the queue loaded with.
- These outcomes are mapped separately, as `media-routes.ts:73-88` already allows:
  - 409 `version_conflict`: reload and keep the form, which already works (`MediaDesk.tsx:358-366`);
  - 409 `nothing_to_publish`;
  - 422 `content_invalid`.

**Queue.**
- `MediaDesk views={["unverified","changes"]}` with its existing loader, generation guard and **"Show more"** paging. There is no auto-paging. A stale cursor restarts the list.
- The two filters never share a cursor; the backend keys cursors by filter.
- Rows show what MediaDesk shows today: id, state, file summary, licence, rights, uploader UID and time. The list carries no image, so the preview stays in the editor; list thumbnails would need a backend change.
- One label everywhere for `pending=true`: **"Changes waiting"**.

**Use the photo** (`afterPublish`).
- **Start a Plane of the Day draft:**
  - It calls the existing `createPotd`, then `setSection("Plane of the Day")` with the new `PotdDesk.initialOpenId`.
  - On mount, PotdDesk calls `choose(item)`, which runs `onOpen`, which runs `drafts.open(id, version)`, so the base version is registered.
  - Its result shows in AdminApp's top notice, and focus moves to the opened editor.
- **Link to an Aircraft Identifier question:** D4's note, then the Identifier desk. Both desks fetch published photos on mount, so the photo just published is included.

**Account change.** Mount Submissions and Media with `key={user.sessionKey}`, so a new account always gets a fresh desk and no typed form or checklist carries over. The server fence still guards any write in flight. Unit test: an `onBlocked` from the editor clears the desk.

**Loading.**
- `sectionNeeds.Submissions = []`: the desk loads itself, like Media.
- Workspace refreshes never use `fetchAll` after a publish (it would unmount the open editor); see the counts in B1b.

**Server.** `lib/request/media-routes.ts` `list` and `detail` strip `owner` when the caller isn't staff. That's one line of defence in depth; the backend already omits it. Test it.

**Nav.**
- Submissions shows only when `manageRoles` (D1).
- The nav badge becomes the photos-to-review count from B1b, with a hidden "to review" label for screen readers.

**Tests.**
- Checklist gating and its reset when the revision changes.
- The missing-rights blocker.
- PATCH then publish uses the new revision.
- The three publish refusals.
- `initialOpenId` registers the base version.
- Remounting on a session change.
- `owner` is stripped for non-staff callers.

## Commit 3 (B1b): Overview counts, the photographer panel and the stats grid

**Count sources** (`lib/workspace-load.ts`).
- `photosToReview` reads `/api/media?state=unverified`, and `changesWaiting` reads `/api/media?pending=true`. Both read the first page only, and both pass the existing query whitelist (`media-routes.ts:207-225`).
- They are requested only when `manageRoles`.
- Each shows "50+" when `nextCursor` is set (the page size is 50).
- `allSources`, `sourceLabel` and `fallbackError` are updated to match.
- After a publish or withdraw (`onChanged`), they are refreshed by a targeted reload in the style of `reloadDesk`.

**Overview.**
- Stats: "Photos to review", "Changes waiting" and "Recent activity".
- "Content records", "Load demo data" and the "do not publish into the game backend" note are dropped for staff.
- `content` leaves `sectionNeeds.Overview`.
- The "Actionable queue" panel lists the first five photo ids to review, each opening Submissions, with no thumbnails.
- The demo Overview counts its samples from `sampleEditorialRecords()` locally and stops checking `missing("content")`.

**New photographers panel** (inside Submissions, only when `manageRoles`).
- Its count comes from the first page of the roles route the Users desk uses, with "50+" when there are more.
- It refreshes on mount and on Reload.
- Its button goes to Users, which opens on "pending".

**Stats grid** (`components/admin.css`).
- `grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))`.
- At ≤1023px, an odd last stat spans the row (`grid-column: 1/-1`).
- Dividers come from `gap:1px; background: var(--line)` on the grid, with each cell on the panel background.
- The `.admin-stat + .admin-stat` and `nth-child` border rules (`:110`, `:382-387`, `:1385-1390`) are removed.
- `tests/admin-css.test.mjs` asserts the new rule and that the old border rules are gone.
- The new panel button, the checklist and the "Use the photo" buttons join the ≤380px full-width rule (`:2164-2168`).

**Tests.**
- Counts: "50+" when there is a next page.
- A down media source leaves the demo Overview whole.
- Overview needs no longer include `content`.

## Commit 4 (B2): remove D1

The Admin has no Cloudflare deploy path: no deploy script and no Cloudflare plugin (`tests/node-hosting.test.mjs:30-36`). Its Node server already answers 503 on every D1 route (`lib/server.ts:7-17`), so nothing that's deployed changes. Wrangler is judged against **media-export only**.

**Remove.**
- `lib/d1/`, `lib/editorial/content-d1.ts`, `lib/editorial/d1-store.ts`, `db/`, `drizzle.config.ts`, the `db:generate` script and `drizzle-kit`.
- `drizzle-orm`, once no import remains.
- The D1 routes in `lib/request/routes.ts`: content, submissions (including `GET submissions/:id/photo`), demo and `admin/references` (unless `ctx.references` has another user; check `router.ts:29`). Also the `EditorialError` import if it goes unused.
- The D1 deps from `RouteDeps` (`router.ts:25-28`: `db`, `photos`, `editorial`, `content`) and from `app/api/[...path]/route.ts:1-16`.
- `lib/server.ts` `database()` and `audit()` (D1 writes), with `lib/editorial/memory-store.ts` if only tests use it.
- The `submissions/` member rule in `implicitAudience` (`router.ts:60-62`).
- `scripts/vite/sites-vite-plugin.ts:178-185`, which copies `drizzle/`. Keep the SQL file itself as a fixture (D5).
- In AdminApp: `loadDemoData`, `createSample`, `createFromSubmission`, the D1 `Submissions` component, `ReviewChecks` and `reviewError` (unless a kept test needs them), and `ContentWorkspace` if the demo can render its samples without it (otherwise keep it as demo-only).
- `scripts/military-qa.mjs`.
- Rewrite or remove the D1 parts of `scripts/browser-qa.mjs:157,217-243`, `firebase-auth-qa.mjs:323-327,613`, `military-release-qa.mjs:70,173-183` and `api-qa.mjs:51`.
- `/api/submissions/*` becomes a plain 404. `firebase-auth-qa`'s closed-route assertion changes to match.

**Test harnesses that lose their D1 deps** (moved to stub deps): `tests/router.test.mjs`, `media.test.mjs:179-181`, `store.test.mjs:192-194`, `store-purchases.test.mjs:207-209` and `editorial-store.test.mjs`. Tests of D1 stores (content-store, D1 editorial store, submissions) go.

**Keep until the user confirms the D1 backup** (removed together in a later, separate commit):
- `scripts/export-d1-media.mjs` and `scripts/media-export/{bundle,local,remote}.mjs`, with `npm run media:export`.
- `lib/submissions/export.ts`, `lib/bunny-storage.ts`, `lib/photo-storage.ts`, `scripts/check-bunny-storage.mjs` and `tests/bunny-storage.test.mjs`.
- `config/cloudflare-prototype.json`, `scripts/cloudflare-local-settings.mjs`, `.dev.vars.cloudflare.example`, `scripts/sites-env.mjs`, `scripts/tool-environment.mjs:12-14` and `scripts/sites-env.sh:20-22`.
- The `wrangler` package, with miniflare through it, and the `overrides.miniflare` block.
- The `.wrangler` ignores (`.gitignore:43`, `eslint.config.mjs:11`, `tsconfig.json:49`).
- `@cloudflare/workers-types` (D5).
- `tests/media-export*.test.mjs` and their fixtures (D5).
- `docs/MEDIA_PLAN.md:219`.

**Never:**
- delete or modify `.wrangler/state`, which holds the only local copy of the data the local export reads;
- touch the D1 database `aviation-arcade-website` (`config/cloudflare-prototype.json`), which belongs to the **website's** Cloudflare deployment, or its config or id;
- run `npm run media:export -- --remote`, deploy, or run any wrangler command.

**Check.**
- After removal, grep `D1Database|env\.DB|drizzle|d1Sqlite|d1ContentStore` and `/api/(admin/(content|submissions|demo)|submissions)`. Any hit outside the Keep list is a miss.
- `tests/node-hosting.test.mjs` asserts no `D1Database` remains under `lib/` outside the kept fixtures.

---

## Backend photo submission v2 (API 0.29.0): it lands after this wave

**Backend reply, 2026-11-25.** The plan was approved at the Backend's gate (API 0.29.0, migration 0028).
Implementation has started but nothing is committed. The contract brief will be at
`../docs/briefs/website-photo-submission-v2-contract.md`, and the Backend will send its commit when it lands. It will
not reach `dev.api` until the Admin and the website have vendored it and the user has signed off.

**Committed: Backend `ef16242` on main, pushed, and not on `dev.api`.**
- Vendor from `Backend/docs/openapi.yaml` at that commit. The notice is
  `../docs/briefs/website-photo-submission-v2-contract.md`.
- Changes added since the reply:
  - On a v2 draft `creditRequired` is fixed at true: an admin who changes it gets a 422, so the toggle is locked.
  - `instagramHandle` accepts null, `""` or `"@"`, each meaning no handle.
  - A PATCH with `displayConsent: true` and no handle is a 400.
- When the Admin has vendored, tell the Backend session. Deploying to `dev.api` waits until both clients have vendored,
  and the user decides it.

What the reply settles for the Admin:
- **New shapes.** Responses change shape for strict readers:
  - `MediaVersion.title` (string or null) becomes required.
  - `MediaItem.submission` becomes required: `{ fullName, instagramHandle, instagramDisplayConsent } | null`. These
    private fields sit on the **item**, not on each version, so names can still be erased.
  - The statement enum gains `v2_agreement_2026-12-01`.
  - There is no `agreementVersion`; read it from the statement code.
- **Admin edits (D8, corrected).** A non-owner admin may only **clear** the private fields: `fullName` to null, the
  handle to null, consent to false. Setting or changing any of them is a 403 for an admin. Sending back the stored
  values is a no-op (200).
- **Private edits don't count as changes waiting.** A PATCH that touches only these private fields makes no new version
  and doesn't put the item in `pending=true`, but it does move the item's `revision`.
- **Publishing.** A v2 draft whose item has no `fullName` (for example after it was erased) is a 422 `content_invalid`.
- **v1 → v2 moves.** These always make a new draft version, so they always show up in "Changes waiting".
- **Confirmed unchanged:** D4, D5, which statements can be published, owner-only rights, and D9.
- **Review feedback (decline and changes requested) is not in 0.29.0.** It is proposed as 0.30.0, with its own Backend
  plan gate and the user's OK on scope. The Backend session is raising that with the user, including whether owners see
  the reason word for word. The smaller asks are noted for that same wave: `AuditEvent.action` as an open set,
  `hasMore` or a total on `listMedia`, and a thumbnail in the list.

The Backend's v2 plan as first drafted (`Backend/docs/plans/photo-submission-v2.md`) has changed since then; the reply
above is the current state. It adds:
- the v2 statement `v2_agreement_2026-12-01`;
- the per-version fields `title`, `fullName`, `instagramHandle` and `instagramDisplayConsent`;
- `MediaRights.agreementVersion`;
- a licence auto-filled for v2;
- owner-only `fullName`;
- admins limited to turning Instagram display off.

The Admin's strict media parsers (`lib/request/media.ts`) would answer 502 on every Media and Submissions page once
0.29.0 is live. So the Admin builds B1a against the vendored 0.28.0, and adds one follow-up commit when the Backend
publishes 0.29.0:
- Vendor the new contract, then widen the parsers:
  - `mediaRightsStatements` gains the v2 code;
  - `MediaVersion` gains the required `title`;
  - `MediaItem` gains the required `submission`.
- Publishable means `v1_own`, `v1_authorised` or `v2_agreement_2026-12-01` (`lib/media-form.ts:54-56`). The agreement
  version shown is read from the code.
- In the editor:
  - Lock `licenceName`, `licenceUrl` and the `creditRequired` toggle on a v2 draft.
  - Staff can see `fullName`, `title`, the Instagram handle and consent.
  - A non-owner admin gets only the **Clear name**, **Clear handle** and **Stop display** actions, which set those
    fields to null or false. Any other change to those fields is blocked before it is sent, so a 403 never signs the
    admin out.
  - Publish is blocked when a v2 item has no `fullName`, with: "The photographer's name was removed; they must add it
    before this can be published."
  - A private-field PATCH refreshes the item's revision, so the next publish is fenced correctly.
- The D3 review checklist reads "credit and title match the submission" for v2 photos.
- A v1 → v2 move shows in "Changes waiting".

Sent 2026-11-25 to the Backend session ("Photo submission v2 backend"): these requirements, a correction (0.29.0 is
not additive for strict clients), and a request to hear before 0.29.0 reaches `dev.api`. It also carried the
review-feedback request below; its reply decides 0.29.0 or 0.30.0 for it.

## After the wave: cross-repo notes

- **Backend: review feedback for photos.** Sent on 2026-11-25. The Backend answered that it plans this as 0.30.0, and
  it needs the user's OK on scope. The proposal it was sent: Today an unsuitable upload, or one without rights, stays in "Photos to review" forever with no feedback. Confirmed in `schema.ts:381` (states), `media.service.ts:523-533` (withdraw is published-only) and PATCH `note` (admin-only audit detail). Proposal:
  - `POST /v1/admin/media/{id}/decline`, admin only, with body `{revision, kind: "changes_requested"|"declined", reason 1..500}`. It is allowed only from `unverified` and fenced by revision.
  - New states or a review sub-record; the Backend chooses which.
    - A new version or PATCH by the owner returns `changes_requested` to `unverified`.
    - `declined` is terminal unless an admin publishes.
  - A new audit action `media_decline` (needs a migration).
  - `review: {kind, reason, decidedAt} | null` on the item, visible to the owner without the reviewer's identity. `listMedia` filters by the new state(s).
  - Contract bump. Warn that the Admin's closed `mediaStates` enum (`media.ts:12,54`) has to widen first, or the two land together.
  - Optional: a list thumbnail on `MediaItem`.
- **Backend:** should `AuditEvent.action` be documented as an open set (F2)?
- **Website session:**
  - The Admin no longer reads D1. The export backup is the only readable copy (update `PROJECT_STATE.md:85`).
  - Is the photographer upload going to backend media?
  - Does the website parse `MediaState`, ahead of the decline states?

## Out of scope (into `docs/TASKS.md` "Next")

- The Admin's decline / request-changes button, once the Backend route exists.
- Removing media-export with its whole Keep list (wrangler/miniflare, workers-types, Cloudflare config and settings, the D1 fixtures), after the user confirms the backup.
- The photographer upload pages and "my photos" view, which belong to the website repo.
- `lib/request/military.ts:51,57`: `.max(2400)` counts UTF-16 units on the raw text; check it against the Military contract.
- Walk Plane of the Day and Submissions against the real Backend's demo seed.

## Verification (each commit)

- `npm run typecheck`, `npm test`, `npm run build`, `npm run build:node`, and eslint on the touched files.
- A browser walk on the scratchpad fake backend, with the auth emulator and `ROLES_SOURCE=backend`. This is local evidence only. The fake gains unverified and pending media lists, PATCH, publish (with the 409/422 cases) and a roles list.
  - **Part A:** the 2500-character pre-check, and an unknown audit action listed.
  - **B1a:**
    - the queue lists unverified photos;
    - the checklist gates Publish;
    - a photo with missing rights is blocked with the owner-only message;
    - publishing removes it from the queue;
    - a 409 keeps the form;
    - "Start a Plane of the Day draft" opens `ed-n` with its base version (the next save sends it);
    - signing in as another account gives a fresh desk;
    - at 375px with the editor open, `scrollWidth <= innerWidth`.
  - **B1b:** the counts, with "50+"; no empty stat cell at 1280, 1100, 900 and 375 px for staff and the demo; mock roles hide Submissions with no Overview banner.
  - **B2:** the B1 walk again, and the greps clean.
- `docs/TASKS.md` gets one entry per commit with the actual results.
- One code-reviewer pass per commit before it is made.
