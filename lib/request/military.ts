/**
 * The Military desk on the game backend (A3.1; openapi 0.24.0 preparation, 0.25.0 releases, API 0.27.1): content items
 * of the `aircraft-identifier-military` module, their preparation and the recorded releases. Server side only: the
 * browser imports types from here, never these schemas. Every object is strict, so an answer that drifts from the
 * contract is refused rather than passed on. Relative imports only, so this loads under plain `node --test`.
 */
import { z } from "zod";
import { mediaIdPattern } from "./media.ts";

export const militaryModule = "aircraft-identifier-military";

/** openapi parameter `ContentItemId` is 1 to 64 characters; the desk only sends ids it was given, so it accepts a safe subset. */
export const contentItemIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** openapi parameter `ReleaseNumber`: a positive integer. */
export const releaseNumberPattern = /^[1-9][0-9]{0,9}$/;

export const militaryErrorCodes = {
  MILITARY_UNAVAILABLE: "MILITARY_UNAVAILABLE",
  BACKEND_NOT_CONNECTED: "BACKEND_NOT_CONNECTED",
  ROLES_UNAVAILABLE: "ROLES_UNAVAILABLE",
  BACKEND_UNAVAILABLE: "BACKEND_UNAVAILABLE",
  BACKEND_CONTRACT: "BACKEND_CONTRACT",
  FORBIDDEN: "FORBIDDEN",
  SIGNED_OUT: "SIGNED_OUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  NOTHING_TO_PUBLISH: "NOTHING_TO_PUBLISH",
  BUSY: "BUSY",
  CONTENT_INVALID: "CONTENT_INVALID",
  UNKNOWN_ITEMS: "UNKNOWN_ITEMS",
  TOO_LARGE: "TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export const rankIds = ["trainee", "first-officer", "captain", "check-airman", "chief-pilot"] as const;
export const prepStages = ["missing_photo", "rights_checked", "content_prepared", "previewed", "approved"] as const;

const positive = z.number().int().min(1);
const version = z.number().int().min(1).max(2147483647);
const pointerVersion = z.number().int().min(0).max(2147483647);
const isoDate = z.string().datetime({ offset: true });
const rank = z.enum(rankIds);
const mediaId = z.string().regex(mediaIdPattern);

/** openapi `PrepEvidence`: no answer, distractor, alias, hint or reveal (the question comes only from the client's sheet). */
export const prepEvidenceSchema = z
  .object({
    photoSource: z.enum(["", "media", "licensed"]),
    licenseUrl: z.string().max(600),
    permission: z.string().max(2400),
    attribution: z.string().max(160),
    referenceUrl: z.string().max(600),
    checklist: z
      .object({ identity: z.boolean(), answers: z.boolean(), crop: z.boolean(), clipperCard: z.boolean() })
      .strict(),
    notes: z.string().max(2400),
  })
  .strict();
export type PrepEvidence = z.infer<typeof prepEvidenceSchema>;

/** openapi `ContentItemPreparation`. */
const preparationSchema = z.object({ stage: z.enum(prepStages), evidence: prepEvidenceSchema, stale: z.boolean() }).strict();

/** The Military payload (`ContentItem.data` for this module): `{ answer, wrong[3], sourceFile, photographer }`, all strings. */
const militaryDataSchema = z
  .object({
    answer: z.string().max(500),
    wrong: z.array(z.string().max(500)).length(3),
    sourceFile: z.string().max(500),
    photographer: z.string().max(500),
  })
  .strict();

/** openapi `ContentItem` with a module's own payload (`data` is module-specific; every other key is shared). */
export function contentItemSchema<D extends z.ZodTypeAny>(data: D) {
  return z
    .object({
      id: z.string().min(1).max(64),
      rank,
      status: z.enum(["approved", "retired"]),
      source: z.enum(["client_sheet", "admin"]),
      version: positive,
      data,
      mediaId: mediaId.nullable(),
      preparation: preparationSchema.nullable(),
      updatedAt: isoDate,
    })
    .strict();
}

/** openapi `ContentItem`, for the Military module. */
export const militaryItemSchema = contentItemSchema(militaryDataSchema);
export type MilitaryItem = z.infer<typeof militaryItemSchema>;

/** openapi `ContentItemList`. */
export const militaryItemListSchema = z.object({ items: z.array(militaryItemSchema).max(2000) }).strict();

/** openapi `ContentItemPreparationChange`. */
export const preparationChangeSchema = z.object({ changed: z.boolean(), item: militaryItemSchema }).strict();

/** openapi `ContentItemPreparationRequest`: what the desk sends, checked here before it goes on. */
export const preparationRequestSchema = z
  .object({ version, stage: z.enum(prepStages), evidence: prepEvidenceSchema, mediaId: mediaId.nullable() })
  .strict();

/** openapi `ReleasePointer`. */
const pointerSchema = z
  .object({ current: positive.nullable(), history: z.array(positive).max(10000), version: pointerVersion })
  .strict();

/** openapi `ReleaseSummary`. */
export const releaseSummarySchema = z
  .object({
    number: positive,
    basis: z.string().max(200000),
    aircraft: z.number().int().min(1).max(2000),
    createdAt: isoDate,
    note: z.string().max(500).nullable(),
    status: z.enum(["uploaded", "released"]),
  })
  .strict();

/** openapi `ReleaseState` (activate, restore). */
export const releaseStateSchema = z
  .object({ pointer: pointerSchema, releases: z.array(releaseSummarySchema).max(50) })
  .strict();

/** openapi `OwnRankCounts`. */
const ownRankCountsSchema = z
  .object(Object.fromEntries(rankIds.map((id) => [id, z.number().int().min(0)])) as Record<(typeof rankIds)[number], z.ZodNumber>)
  .strict();

/** openapi `ReleaseList`. */
export const releaseListSchema = z
  .object({ pointer: pointerSchema, releases: z.array(releaseSummarySchema).max(50), ownRankCounts: ownRankCountsSchema })
  .strict();

const note = z.string().max(500);
/** openapi `ReleaseUploadRequest`. Ids repeat-free, as the backend requires. */
export const releaseUploadRequestSchema = z
  .object({
    itemIds: z.array(z.string().regex(contentItemIdPattern)).min(1).max(2000).refine((ids) => new Set(ids).size === ids.length),
    basis: z.string().min(1).max(65536),
    previewed: z.literal(true),
    note: note.optional(),
  })
  .strict();

/** openapi `ReleasePointerRequest`. */
export const releasePointerRequestSchema = z.object({ expectedPointerVersion: pointerVersion, note: note.optional() }).strict();

/** What `GET admin/military` answers: the items with the release state in one read. */
export type MilitaryDesk = {
  items: MilitaryItem[];
  pointer: z.infer<typeof pointerSchema>;
  releases: z.infer<typeof releaseSummarySchema>[];
  ownRankCounts: z.infer<typeof ownRankCountsSchema>;
};
