/**
 * The Aircraft Identifier desk on the game backend (A3.2; content module `identifier`, Backend slice I3, API 0.27.0):
 * the client's 2026-09-28 sheet as content items. Staff edit a question's rank and answers, retire or restore it, and
 * link its photo. There is no preparation and no release for this module (the backend answers 404). Server side only:
 * the browser imports types from here, never these schemas. Strict, as the Military parser. Relative imports only.
 */
import { z } from "zod";
import { mediaIdPattern } from "./media.ts";
import { contentItemSchema, rankIds } from "./military.ts";

export const identifierModule = "identifier";

/** The backend's id rule for this module: `ai-a<N>`, optionally `-<k>` for the k-th question on the same photo. */
export const identifierIdPattern = /^ai-a([1-9]\d{0,5})(?:-(?:[2-9]|[1-9]\d{1,2}))?$/;

export const identifierErrorCodes = {
  IDENTIFIER_UNAVAILABLE: "IDENTIFIER_UNAVAILABLE",
  BACKEND_NOT_CONNECTED: "BACKEND_NOT_CONNECTED",
  ROLES_UNAVAILABLE: "ROLES_UNAVAILABLE",
  BACKEND_UNAVAILABLE: "BACKEND_UNAVAILABLE",
  BACKEND_CONTRACT: "BACKEND_CONTRACT",
  FORBIDDEN: "FORBIDDEN",
  SIGNED_OUT: "SIGNED_OUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  BUSY: "BUSY",
  CONTENT_INVALID: "CONTENT_INVALID",
  MEDIA_INVALID: "MEDIA_INVALID",
  TOO_LARGE: "TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

const answer = z.string().max(500);
/** The Identifier payload: `{ answer, wrong[3], sourceFile }`, all strings (no photographer: the credit is the photo's). */
export const identifierDataSchema = z
  .object({ answer, wrong: z.array(answer).length(3), sourceFile: z.string().max(500) })
  .strict();
export type IdentifierData = z.infer<typeof identifierDataSchema>;

/** openapi `ContentItem` for this module. */
export const identifierItemSchema = contentItemSchema(identifierDataSchema);
export type IdentifierItem = z.infer<typeof identifierItemSchema>;

export const identifierItemListSchema = z.object({ items: z.array(identifierItemSchema).max(2000) }).strict();

/** openapi `FieldDiff`. */
const fieldDiffSchema = z.object({ field: z.string().max(200), from: z.unknown(), to: z.unknown() }).strict();

/** openapi `ContentItemChange` for this module. */
export const identifierChangeSchema = z
  .object({ changed: z.boolean(), item: identifierItemSchema, diff: z.array(fieldDiffSchema).max(100) })
  .strict();

const version = z.number().int().min(1).max(2147483647);

/** openapi `ContentItemEditRequest`. The desk sends the rank and the whole payload; the backend applies its own rules. */
export const identifierEditRequestSchema = z
  .object({ version, rank: z.enum(rankIds).optional(), data: identifierDataSchema.optional() })
  .strict();

/** openapi `ContentItemVersionRequest` (retire, restore). */
export const identifierVersionRequestSchema = z.object({ version }).strict();

/** openapi `ContentItemMediaRequest`: null unlinks. */
export const identifierMediaRequestSchema = z
  .object({ mediaId: z.string().regex(mediaIdPattern).nullable(), expectedVersion: version })
  .strict();
