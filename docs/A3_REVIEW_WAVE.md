# A3 review wave: Backend API 0.30.0 (photo review feedback)

**Status:** DONE, 2026-11-25 (R1 `01ae284`, R2 the next commit). The user approved starting it. **Source:** Backend `62ff2bb`, the notice
`../docs/briefs/website-media-review-contract.md` (repo root `docs/briefs/`). The deploy to dev.api is joint (backend, website and
Admin together) and needs the user's sign-off; nothing here deploys.

## R1. Vendor and widen (one commit)

- `contracts/openapi.yaml`: a byte copy of Backend `docs/openapi.yaml` at `62ff2bb` (0.30.0).
- `lib/request/media.ts`:
  - `mediaReviewSchema`, strict: `decision` is `changes_requested | declined`; `reason` is 1..500 code points; `version` is
    positive; `decidedAt` is ISO; `decidedBy` is optional.
  - `mediaItemSchema.review`: required, nullable.
  - `mediaReviewRequestSchema`, a union:
    - `{revision, decision, reason}`, where the reason is normalised as the backend does (CRLF becomes LF, newline is the only
      control character, trimmed, 1..500 code points, no lone surrogates);
    - or `{revision, decision: null}`, strict, with no reason.
  - New error code `MEDIA_DECLINED`.
- `lib/request/media-routes.ts`:
  - `GET media` accepts `review=none|changes_requested|declined`, combinable with `state` and `pending`. Unknown values are
    400 before any backend call.
  - New `POST media/:id/review`, staff only (`gate(ctx,"staff")`). The body is checked; the answer is a `MediaItem`.
  - The backend's 409 `media_declined` maps to 409 `MEDIA_DECLINED`, whose message never carries the reason.
  - `ownerFor` also drops `review.decidedBy` for a non-staff caller, as a second line behind the backend.
- `lib/request/audit.ts`: `auditActions` gains `media_review`, listed last. The drift test pins it, and parsing stays lenient.
- `lib/media-form.ts`: `mediaOutcome` treats `MEDIA_DECLINED` as a conflict.
- The fixtures in the tests gain `review: null`.

## R2. The desks (one commit)

- **Views (`MediaDesk.tsx`):**
  - `unverified` becomes `state=unverified&review=none` ("To review").
  - `changes` becomes `pending=true&review=none`.
  - New `sentBack`: `review=changes_requested` ("Changes requested").
  - New `declined`: `review=declined` ("Declined").
  - Submissions shows `unverified, changes, sentBack, declined`. Media keeps `published, withdrawn, all`.
- **Table:** each row gets a status badge "Changes requested" or "Declined" from `item.review`.
- **Detail, a "Review decision" panel.** It is admin-only, like the whole desk.
  - It shows the current decision, the reason as plain text (pre-wrap, never HTML), `decidedAt`, `decidedBy` (the account id, as
    `owner`) and "made on version N", with a note when that is behind `draftVersion`.
  - The actions come from a pure `reviewActions(item)` in `lib/media-form.ts`:
    - "Request changes": the item is unverified, or published with a pending draft, and it is not already
      `changes_requested`. When the item is declined, this action is labelled "Reopen".
    - "Decline": unverified only, and not already declined.
    - "Withdraw the decision": any item with a review, withdrawn included.
  - A decision opens an inline form with a reason textarea and a live counter (500 code points), then Send or Cancel.
  - "Withdraw the decision" asks for confirmation.
  - Every write sends the revision and is guarded by `writeGeneration` and the account fence.
  - A 409 conflict reloads with "Someone changed this photo first…". On success the detail reloads, `onWritten` refreshes the
    counts, and the notice reads "Changes requested." or similar.
  - The reason is not logged and not copied anywhere else.
- **Counts (`lib/review-counts.ts`):**
  - `toReview` reads `state=unverified&review=none`.
  - `changes` reads `pending=true&review=none`.
  - The queue keeps reading `toReview`.
- **Activity:** nothing to change; actions are shown as given.

## Plan review (senior-lead, APPROVE WITH CHANGES), folded in

1. A decision can replace one of the same kind: offer "Change the reason", filled in with the current reason. An identical reason on
   the same version is a 200 that changes nothing; the desk then says "Nothing changed.".
2. The counter counts the reason as it will be stored, after normalising. A control character or a lone surrogate shows an error at
   the field before anything is sent. The server sends the normalised reason, so the backend's `maxLength` sees the stored text.
3. A 409 on a review can be a stale revision or a decision this state can't take. The desk reloads and says so neutrally.
4. A `MEDIA_DECLINED` answer, which only a non-admin owner gets, is mapped to its own message. The desk treats it as a conflict and
   reloads.
5. `review` is in the list's allowed parameters, a repeated value is 400, and "Show more" reuses the view's own query, so a cursor
   stays with its filter.
6. Tests:
   - R1: the review schema, normalising the request, the review route, the filter (an unknown or repeated value is 400),
     `media_declined`, and `decidedBy` dropped for non-staff.
   - R2: a matrix for `reviewActions` and the new count URLs.
7. Tell the Backend session after R1. This branch must not deploy before the joint window: a strict 0.30.0 reader fails against
   the dev.api of today.

## Verification

- Typecheck, `npm test`, `npm run build`, `npm run build:node`.
- A browser walk on the local fake backend, which gets review support: request changes, decline, reopen, withdraw the decision,
  a conflict, the queues and the counts.
- Not covered: the real Backend 0.30.0, which is local only and not on dev.api.

## Not in this wave

Counts or `hasMore` from the backend, thumbnails, review history, and email. The website's "my photos" view belongs to the
website session.
