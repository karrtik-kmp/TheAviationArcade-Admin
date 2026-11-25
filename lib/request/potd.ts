/**
 * The Plane of the Day desk on the game backend (A3.3, docs/A3_PLAN.md; editorial desks W1, openapi 0.23.0, API 0.28.0):
 * the backend's editorial items of kind `plane-of-the-day`. A draft links one PUBLISHED photo (`mediaId`, fixed at
 * create) and holds only what staff typed; scheduling is `status: "scheduled"` with a `dateKey`. The Admin's kind is
 * `potd`; it becomes the backend's `plane-of-the-day` here, at the edge, and nowhere else. Server side only: the browser
 * imports types from here, never these schemas. Strict, as the Military parser. Relative imports only.
 */
import { z } from "zod";
import { mediaIdPattern } from "./media.ts";

/** The Admin's kind and the backend's (`EditorialKind`). */
export const potdKind = "potd";
export const potdBackendKind = "plane-of-the-day";

/** openapi parameter `EditorialItemId`: `ed-<n>`. */
export const potdIdPattern = /^ed-[1-9][0-9]{0,14}$/;
/** openapi `EditorialItem.dateKey`: a calendar date, no zone. The backend checks that it is a real date. */
export const dateKeyPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export const potdErrorCodes = {
  POTD_UNAVAILABLE: "POTD_UNAVAILABLE",
  BACKEND_NOT_CONNECTED: "BACKEND_NOT_CONNECTED",
  ROLES_UNAVAILABLE: "ROLES_UNAVAILABLE",
  BACKEND_UNAVAILABLE: "BACKEND_UNAVAILABLE",
  BACKEND_CONTRACT: "BACKEND_CONTRACT",
  FORBIDDEN: "FORBIDDEN",
  SIGNED_OUT: "SIGNED_OUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  CONTENT_INVALID: "CONTENT_INVALID",
  TOO_LARGE: "TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export const potdStatuses = ["draft", "scheduled", "published", "archived"] as const;
export type PotdStatus = (typeof potdStatuses)[number];

/**
 * What the backend stores: at most 2400 code points. It counts after turning CRLF into LF and trimming, and going over
 * is 422 with the reasons, not 400, so requests carry plain strings (the 16 KB body cap bounds them) and the backend
 * decides; only the stored values read back are bounded here.
 */
const text = z.string().refine((value) => [...value].length <= 2400);
const typed = z.string();
const isoDate = z.string().datetime({ offset: true });
const version = z.number().int().min(1).max(2147483647);
const mediaId = z.string().regex(mediaIdPattern);
const dateKey = z.string().regex(dateKeyPattern);

/** openapi `EditorialData`: every key, as staff typed it. There is no `imageUrl`: the image is the linked photo's. */
export const potdDataSchema = z
  .object({
    title: text,
    aircraft: text,
    photographer: text,
    instagram: text,
    credit: text,
    description: text,
    correctAnswer: text,
    // More than 20 is 400; any count but 3 is 422 once saved, which the backend decides.
    distractors: z.array(text).max(20),
    difficulty: text,
    factualSource: text,
  })
  .strict();
export type PotdData = z.infer<typeof potdDataSchema>;

/** `EditorialData` as a request carries it: the same keys, any length (see `text`). More than 20 distractors is 400. */
export const potdDataRequestSchema = z
  .object({
    title: typed,
    aircraft: typed,
    photographer: typed,
    instagram: typed,
    credit: typed,
    description: typed,
    correctAnswer: typed,
    distractors: z.array(typed).max(20),
    difficulty: typed,
    factualSource: typed,
  })
  .strict();

/** openapi `EditorialItem` of kind `plane-of-the-day`, read as the Admin's `potd`. Another kind is off this desk's contract. */
export const potdItemSchema = z
  .object({
    id: z.string().regex(potdIdPattern),
    kind: z.literal(potdBackendKind).transform((): typeof potdKind => potdKind),
    mediaId,
    status: z.enum(potdStatuses),
    dateKey: dateKey.nullable(),
    version: z.number().int().min(1),
    data: potdDataSchema,
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();
export type PotdItem = z.infer<typeof potdItemSchema>;

/** openapi `EditorialItemList`: most recently updated first, at most 200 (no paging yet). */
export const potdItemListSchema = z.object({ items: z.array(potdItemSchema).max(200) }).strict();

/** openapi `EditorialCreated`. */
export const potdCreatedSchema = z.object({ item: potdItemSchema }).strict();

/** openapi `EditorialChange`. */
export const potdChangeSchema = z.object({ changed: z.boolean(), item: potdItemSchema }).strict();

/** openapi `EditorialCreateRequest`: a published photo, and optionally what staff typed. An `imageUrl` is 400. */
export const potdCreateRequestSchema = z.object({ mediaId, data: potdDataRequestSchema.optional() }).strict();

/** openapi `EditorialSaveRequest`: the whole editable state. `dateKey` absent means null. */
export const potdSaveRequestSchema = z
  .object({ version, status: z.enum(potdStatuses), data: potdDataRequestSchema, dateKey: dateKey.nullable().optional() })
  .strict();
