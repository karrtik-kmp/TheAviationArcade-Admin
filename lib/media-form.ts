/**
 * Browser-safe helpers for backend media (MEDIA_PLAN.md, slice M0): limits, the pre-upload check,
 * upload keys, licence validation and diff, publish blockers, outcome mapping and the rights
 * statement. Imports only types from the server module, so no zod reaches the browser. Relative
 * imports only, so this loads under plain `node --test`.
 */
import type { MediaItem, MediaLicence, MediaLicenceUpdate } from "./request/media.ts";

export const MEDIA_MAX_BYTES = 5242880;
export const MEDIA_MAX_SIDE = 4096;

/**
 * Wording approved by the user on 2026-11-04. Kept as one constant so the words change in one place.
 * The option id is the statement the backend records (Backend API 0.19.0): it travels as the
 * `X-Rights-Statement` header of an upload, or in `PUT media/:id/rights`.
 */
export type RightsChoice = "v1_own" | "v1_authorised";
export const RIGHTS_STATEMENT = {
  version: 1,
  question: "Who holds the rights to this photo?",
  options: [
    { id: "v1_own", label: "I took this photo and hold the rights to it." },
    { id: "v1_authorised", label: "I'm authorised by the person or organisation that holds the rights." },
  ],
  consent:
    "I confirm this is true, and I agree that Airplane Games may publish this photo, after review, under the licence and credit I give for it.",
} as const;

/** A version's stored rights statement (staff see `statedBy`). `d1_private_review` marks an imported photo. */
export type RightsState = {
  statement: "v1_own" | "v1_authorised" | "v2_agreement_2026-12-01" | "d1_private_review";
  statedAt: string;
  statedBy?: string;
} | null;
/** The fields 0.19.0 added to a version; read structurally so this works with the shared types. */
export function rightsOf(version: object): RightsState {
  return (version as { rights?: RightsState }).rights ?? null;
}
export function descriptionOf(version: object): string | null {
  return (version as { description?: string | null }).description ?? null;
}
/**
 * Whether the owner can still state rights for this draft (the backend's `PUT .../rights` rule): it has no v1
 * statement (none, or the import's) AND it was never published (not the live version, no `publishedAt`). That
 * includes newer drafts on published or withdrawn items.
 */
export function needsRightsStatement(item: {
  draftVersion: number;
  publishedVersion: number | null;
  draft: { publishedAt: string | null };
}) {
  return !hasPublishableStatement(rightsOf(item.draft)) && item.draft.publishedAt == null && item.draftVersion !== item.publishedVersion;
}
/** The photographer accepted the v2 agreement (2026-12-01) for this version: its licence is the agreement. */
export function isV2(rights: RightsState | undefined) {
  return rights?.statement === "v2_agreement_2026-12-01";
}
/** A statement a version can be published under: v1 (own, authorised) or the v2 agreement. */
export function hasPublishableStatement(rights: RightsState | undefined) {
  return hasV1Statement(rights) || isV2(rights);
}
/** The agreement version a v2 statement names, for display ("2026-12-01"); null for anything else. */
export function agreementVersion(rights: RightsState | undefined): string | null {
  return isV2(rights) ? "2026-12-01" : null;
}
/** True when the statement is a v1 one the owner gave through the API (publishing needs it). */
export function hasV1Statement(rights: RightsState | undefined) {
  return rights?.statement === "v1_own" || rights?.statement === "v1_authorised";
}

/** Image type from the first bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`). The file's own `type` is never trusted. */
export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}

export type PrecheckReason = "empty" | "tooLarge" | "unsupportedType" | "tooWide";
export type PrecheckResult =
  | { ok: true; contentType: "image/jpeg" | "image/png"; width?: number; height?: number }
  | { ok: false; reason: PrecheckReason; message: string };

const precheckMessages: Record<PrecheckReason, string> = {
  empty: "This file is empty. Choose a JPEG or PNG photo.",
  tooLarge: "This photo is larger than 5 MB. Choose a smaller JPEG or PNG.",
  unsupportedType: "This file isn't a JPEG or PNG photo. Choose a JPEG or PNG.",
  tooWide: "This photo is more than 4096 pixels wide or tall. Choose a smaller one.",
};
const refuse = (reason: PrecheckReason): PrecheckResult => ({ ok: false, reason, message: precheckMessages[reason] });

/** Checks size, then the real type from the magic bytes, then (where the browser can) the sides. No minimum size. */
export async function precheckImage(file: Blob): Promise<PrecheckResult> {
  if (file.size === 0) return refuse("empty");
  if (file.size > MEDIA_MAX_BYTES) return refuse("tooLarge");
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const contentType = sniffImageType(head);
  if (!contentType) return refuse("unsupportedType");
  const decode = (globalThis as { createImageBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }> })
    .createImageBitmap;
  if (typeof decode !== "function") return { ok: true, contentType };
  try {
    const bitmap = await decode(file);
    const { width, height } = bitmap;
    bitmap.close?.();
    if (width > MEDIA_MAX_SIDE || height > MEDIA_MAX_SIDE) return refuse("tooWide");
    return { ok: true, contentType, width, height };
  } catch {
    // A browser that cannot decode it here: the backend still checks the file, so do not block on a guess.
    return { ok: true, contentType };
  }
}

/** A fresh `Idempotency-Key` (matches `^[A-Za-z0-9_-]{1,128}$`). */
export function mintKey() {
  return globalThis.crypto.randomUUID();
}

export type UploadTarget = "create" | `version:${string}`;

/**
 * Upload key lifecycle. One key per (file object, target): the same key is handed out again for a
 * retry after a network failure, 503, 429 or 409; a new one after the file or target changes, after
 * success, or after `IDEMPOTENCY_KEY_REUSED`. Call `settle(outcome)` with the `mediaOutcome` result.
 */
export function createUploadKeys(mint: () => string = mintKey) {
  let current: { file: Blob; target: UploadTarget; statement: string; key: string } | null = null;
  return {
    /** One key per (file, target, rights statement): a retry reuses all three, changing any mints a new key. */
    keyFor(file: Blob, target: UploadTarget, statement = "") {
      if (!current || current.file !== file || current.target !== target || current.statement !== statement)
        current = { file, target, statement, key: mint() };
      return current.key;
    },
    settle(outcome: MediaOutcome) {
      if (outcome === "ok" || outcome === "keyReused") current = null;
    },
    reset() {
      current = null;
    },
  };
}
export type UploadKeys = ReturnType<typeof createUploadKeys>;

export const licenceFields = ["credit", "licenceName", "licenceUrl", "sourceUrl", "attributionText"] as const;
export type LicenceField = (typeof licenceFields)[number];
/** Form values: text fields as typed (empty means none); `creditRequired` is staff only. */
export type LicenceValues = Record<LicenceField, string> & { creditRequired?: boolean; description?: string };
export type LicenceErrors = Partial<Record<LicenceField, string>>;

const limits: Record<LicenceField, { max: number; label: string; url?: boolean }> = {
  credit: { max: 200, label: "Credit" },
  licenceName: { max: 200, label: "Licence name" },
  licenceUrl: { max: 2048, label: "Licence link", url: true },
  sourceUrl: { max: 2048, label: "Source link", url: true },
  attributionText: { max: 1000, label: "Attribution text" },
};
// eslint-disable-next-line no-control-regex
const controlChars = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export const DESCRIPTION_MAX = 2000;
/** CRLF to LF, then trimmed: what is compared and sent. */
export function normaliseDescription(raw: string) {
  return raw.replace(/\r\n/g, "\n").trim();
}
/** Description rule (Backend 0.19.0): 1-2000 after trim, newlines allowed, no other control characters (a tab included), counted in code points. Empty clears. */
export function descriptionErrors(raw: string): string | undefined {
  const text = raw.replace(/\r\n/g, "\n");
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const control = code < 0x20 ? code !== 0x0a : (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    if (control) return "Description can't contain control characters. Line breaks are fine.";
  }
  if ([...normaliseDescription(text)].length > DESCRIPTION_MAX) return `Description must be ${DESCRIPTION_MAX} characters or fewer.`;
  return undefined;
}

/** openapi `MediaReviewRequest.reason` (0.30.0): 1..500 code points once CRLF is LF and it is trimmed. */
export const REVIEW_REASON_MAX = 500;
/** The reason's length as it will be stored (normalised, in code points), for the counter. */
export function reasonLength(raw: string) {
  return [...normaliseDescription(raw)].length;
}
/** The backend's reason rule, checked before sending: newlines only, no other control character, no lone surrogate. */
export function reasonErrors(raw: string): string | undefined {
  const text = raw.replace(/\r\n/g, "\n");
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const control = code < 0x20 ? code !== 0x0a : (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    if (control) return "The reason can't contain control characters. Line breaks are fine.";
    if (code >= 0xd800 && code <= 0xdfff) return "The reason contains a broken character. Retype it.";
  }
  const length = reasonLength(text);
  if (length < 1) return "Write a reason for the photographer.";
  if (length > REVIEW_REASON_MAX) return `Keep the reason to ${REVIEW_REASON_MAX} characters or fewer.`;
  return undefined;
}

export type ReviewDecision = "changes_requested" | "declined";
export const reviewDecisionText: Record<ReviewDecision, string> = {
  changes_requested: "Changes requested",
  declined: "Declined",
};
export type ReviewAction = { decision: ReviewDecision | null; label: string };

/**
 * The review decisions an admin can send for this item now (openapi `reviewMedia`, 0.30.0). Reviewable: unverified, or
 * published with a pending draft. `declined` only on an unverified item. A decision of the same kind replaces the
 * reason ("Change the reason"); `changes_requested` on a declined item reopens it. Withdrawing the decision works on
 * any item that has one, withdrawn included.
 */
export function reviewActions(item: Pick<MediaItem, "state" | "draftVersion" | "publishedVersion" | "review">): ReviewAction[] {
  const current = item.review?.decision ?? null;
  const pending = item.state === "published" && item.publishedVersion !== null && item.draftVersion > item.publishedVersion;
  const reviewable = item.state === "unverified" || pending;
  const actions: ReviewAction[] = [];
  if (reviewable)
    actions.push({
      decision: "changes_requested",
      label: current === "changes_requested" ? "Change the reason" : current === "declined" ? "Reopen: request changes" : "Request changes",
    });
  if (item.state === "unverified") actions.push({ decision: "declined", label: current === "declined" ? "Change the reason" : "Decline" });
  if (current) actions.push({ decision: null, label: "Withdraw the decision" });
  return actions;
}

/** Per-field messages mirroring the contract. Empty is allowed (it clears the field). Fields are trimmed; single-line only. */
export function licenceErrors(values: Partial<Record<LicenceField, string>>): LicenceErrors {
  const errors: LicenceErrors = {};
  for (const field of licenceFields) {
    const raw = values[field] ?? "";
    const { max, label, url } = limits[field];
    if (controlChars.test(raw)) {
      errors[field] = `${label} must be on one line, with no line breaks or control characters.`;
      continue;
    }
    const text = raw.trim();
    if (!text) continue;
    if (text.length > max) {
      errors[field] = `${label} must be ${max} characters or fewer.`;
    } else if (url) {
      let valid = /^https?:\/\//.test(text);
      if (valid) {
        try {
          const parsed = new URL(text);
          valid = parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          valid = false;
        }
      }
      if (!valid) errors[field] = `${label} must be a web address starting with http:// or https://.`;
    }
  }
  return errors;
}

/**
 * What to send: only fields that changed against the saved licence, a cleared field as `null`.
 * `creditRequired` is included only when `staff` is true and it changed. `{ none: true }` when nothing changed.
 * `description` (when the values carry it) is one more field in the same diff. Call `licenceErrors` and
 * `descriptionErrors` first; this does not validate.
 */
export type EditChanges = MediaLicenceUpdate & { description?: string | null };
export function licenceDiff(
  base: MediaLicence & { description?: string | null },
  values: Partial<LicenceValues>,
  staff = false,
): { changes: EditChanges } | { none: true } {
  const changes: EditChanges = {};
  if (values.description !== undefined) {
    const next = normaliseDescription(values.description) || null;
    if (next !== (base.description ?? null)) changes.description = next;
  }
  for (const field of licenceFields) {
    if (values[field] === undefined) continue;
    const next = values[field].trim() || null;
    if (next !== base[field]) changes[field] = next;
  }
  if (staff && typeof values.creditRequired === "boolean" && values.creditRequired !== base.creditRequired)
    changes.creditRequired = values.creditRequired;
  return Object.keys(changes).length ? { changes } : { none: true };
}

/** Splits a diff into the PATCH body parts: `licence` (if any key) and `description` (if present). */
export function splitEdit(changes: EditChanges): { licence?: MediaLicenceUpdate; description?: string | null } {
  const { description, ...licence } = changes;
  return {
    ...(Object.keys(licence).length ? { licence } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

/** A saved licence (and description) as form values (`creditRequired` included). */
export function licenceToValues(licence: MediaLicence & { description?: string | null }): LicenceValues {
  return {
    description: licence.description ?? "",
    credit: licence.credit ?? "",
    licenceName: licence.licenceName ?? "",
    licenceUrl: licence.licenceUrl ?? "",
    sourceUrl: licence.sourceUrl ?? "",
    attributionText: licence.attributionText ?? "",
    creditRequired: licence.creditRequired,
  };
}

/**
 * After the saved licence changed under an open form: a field the user did not touch (it still equals
 * the OLD saved value) takes the NEW saved value; a touched field keeps the typed text. Without this the
 * next diff would resend untouched fields and revert another editor's change.
 */
export function rebaseLicence(
  oldBase: MediaLicence & { description?: string | null },
  newBase: MediaLicence & { description?: string | null },
  values: Partial<LicenceValues>,
): LicenceValues {
  const before = licenceToValues(oldBase);
  const after = licenceToValues(newBase);
  const next: LicenceValues = { ...after };
  for (const field of licenceFields) {
    const typed = values[field];
    // Compared trimmed, as licenceDiff does: whitespace alone is not an edit.
    if (typed !== undefined && typed.trim() !== before[field].trim()) next[field] = typed;
  }
  if (typeof values.description === "string" && normaliseDescription(values.description) !== normaliseDescription(before.description ?? ""))
    next.description = values.description;
  if (typeof values.creditRequired === "boolean" && values.creditRequired !== oldBase.creditRequired)
    next.creditRequired = values.creditRequired;
  return next;
}

/** Only the owner may state rights (`PUT .../rights` is owner-only), so a reviewer can't fix this one. */
export const rightsOwnerOnly = "Only the photographer can state the rights; this photo can't be published until they do.";

/**
 * What a reviewer confirms before publishing a photo from the Submissions desk (A3 fix wave, D3). Only what the
 * editor shows; nothing is stored, and the list starts empty again whenever the photo's revision changes.
 */
export const reviewChecks = [
  { id: "quality", label: "The photo's quality is fit for the game." },
  { id: "credit", label: "The credit matches the photographer." },
  { id: "licence", label: "The licence is correct." },
  { id: "rights", label: "A rights statement is present." },
  { id: "safe", label: "Nothing private or unsafe is in the image." },
] as const;
export type ReviewCheckId = (typeof reviewChecks)[number]["id"];

/** What the reviewer ticked, and for which photo revision. */
export type ReviewTicks = { key: string; ids: readonly string[] };

/** The ticks belong to one revision of one photo: any change to the photo (a new revision) starts them again. */
export function reviewKey(item: { id: string; revision: number }): string {
  return `${item.id}:${item.revision}`;
}

/** The ticks that still count for this revision; none when they were made against another. */
export function ticksFor(ticks: ReviewTicks, key: string): readonly string[] {
  return ticks.key === key ? ticks.ids : [];
}

/** True when every review check is ticked for this revision. Publishing from the Submissions desk needs it. */
export function reviewReady(ticks: ReviewTicks, key: string): boolean {
  const current = ticksFor(ticks, key);
  return reviewChecks.every((check) => current.includes(check.id));
}

/** A v2 photo needs the photographer's name to be published; an admin who removed it can't put it back. */
export const nameRemovedBlocker = "The photographer's name was removed; they must add it before this can be published.";

export type PublishBlocker = { field: "licenceName" | "credit" | "rights" | "fullName"; message: string };
/**
 * What stops a SAVED draft from being published (the backend's 422 `content_invalid` rule): a licence
 * name, a credit when required, and a v1 rights statement. Pass the draft's `rights` (null when none);
 * leave it out to check the licence only. With `devDemoWaiver` (dev Admin only) a missing licence name is allowed.
 */
export function publishBlockers(
  saved: MediaLicence,
  rights?: RightsState,
  options: { devDemoWaiver?: boolean; fullName?: string | null } = {},
): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  // The dev demo waiver (lib/dev-waiver.ts) drops only the licence-name check; the backend still decides.
  if (!options.devDemoWaiver && !saved.licenceName?.trim()) blockers.push({ field: "licenceName", message: "Add a licence name." });
  if (saved.creditRequired && !saved.credit?.trim()) blockers.push({ field: "credit", message: "Add a credit, which this photo requires." });
  if (rights !== undefined && !hasPublishableStatement(rights))
    blockers.push({ field: "rights", message: rightsOwnerOnly });
  // 0.29.0: a v2 draft whose item has no full name (erased) is refused.
  if (isV2(rights) && "fullName" in options && !options.fullName) blockers.push({ field: "fullName", message: nameRemovedBlocker });
  return blockers;
}

export type MediaOutcome = "ok" | "retryable" | "fileRejected" | "keyReused" | "conflict" | "roleLost" | "fenced" | "error";

/**
 * How a media call ended. `status` 0 (or any non-HTTP failure) is a network failure. `code` is the
 * website error code (`mediaErrorCodes`, plus `ACCOUNT_CHANGED` and `DEMO_ACCOUNT` from the router).
 */
export function mediaOutcome(status: number, code?: string | null): MediaOutcome {
  if (status === 200 || status === 201) return "ok";
  if (code === "SIGNED_OUT" || code === "ACCOUNT_CHANGED" || status === 401) return "fenced";
  if (code === "PHOTOGRAPHER_REQUIRED" || code === "FORBIDDEN") return "roleLost";
  if (code === "IDEMPOTENCY_KEY_REUSED") return "keyReused";
  if (code === "VERSION_CONFLICT" || code === "NOTHING_TO_PUBLISH" || code === "RIGHTS_ALREADY_STATED" || code === "MEDIA_DECLINED") return "conflict";
  if (code === "TOO_LARGE" || code === "UNSUPPORTED_TYPE" || code === "MEDIA_INVALID") return "fileRejected";
  if (code === "BACKEND_CONTRACT" || code === "SUBMISSION_LIMIT") return "error";
  if (
    !Number.isInteger(status) ||
    status < 100 ||
    status === 429 ||
    code === "RATE_LIMITED" ||
    code === "STORAGE_UNAVAILABLE" ||
    code === "BACKEND_UNAVAILABLE"
  )
    return "retryable";
  if (status === 409) return "conflict";
  if (status === 413 || status === 415) return "fileRejected";
  if (status === 503 || status === 504) return "retryable";
  return "error";
}
