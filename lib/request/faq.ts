/**
 * The FAQ on the game backend (API 0.33.0, `contracts/openapi.yaml`): the site document `faq` (format `faq.v1`), edited
 * through the staff document routes with a PATCH of operations, published like the game documents, and copied from dev to
 * live with export and import. Server side only: the browser imports types from here, never these schemas. The text rule
 * is `faqTextError` in the zod-free `lib/faq-desk.ts`, one copy for the screen and the server. Relative imports only.
 */
import { z } from "zod";
import { faqIdPattern, faqLimits, faqTextError } from "../faq-desk.ts";

export const faqErrorCodes = {
  FAQ_UNAVAILABLE: "FAQ_UNAVAILABLE",
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
  CONTENT_INVALID: "CONTENT_INVALID",
  TOO_LARGE: "TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

/** openapi `FaqImportRequest`: this route alone takes up to 3 MB of JSON. */
export const FAQ_IMPORT_MAX_BYTES = 3 * 1024 * 1024;

const codePoints = (text: string) => [...text].length;
const faqId = z.string().regex(faqIdPattern);
const stored = (max: number) => z.string().refine((text) => codePoints(text) >= 1 && codePoints(text) <= max);
const revision = z.number().int().min(0).max(2000000000);
const isoDate = z.string().datetime({ offset: true });

/** openapi `FaqEntry` / `FaqCategory` / `FaqDocument`, as the backend returns them (already normalised). */
export const faqEntrySchema = z
  .object({ id: faqId, question: stored(faqLimits.question), answer: stored(faqLimits.answer) })
  .strict();
export const faqCategorySchema = z
  .object({ id: faqId, title: stored(faqLimits.title), entries: z.array(faqEntrySchema).max(faqLimits.entries) })
  .strict();
const faqCategories = z.array(faqCategorySchema).max(faqLimits.categories);
export const faqDocumentSchema = z
  .object({ format: z.literal("faq.v1"), version: z.number().int().min(0), categories: faqCategories })
  .strict();

const draftFields = {
  name: z.literal("faq"),
  publishedVersion: z.number().int().min(1).nullable(),
  draftVersion: revision,
  changed: z.boolean(),
  // The working overlay and the change list are passed over: the desk builds its view from `body` (contract note).
  edits: z.record(z.unknown()),
  changeCount: z.number().int().min(0),
  changes: z.array(z.unknown()).max(200),
};
/** openapi `ContentDraftDetail` for `faq`: `body` is the document a publish would write. */
export const faqDraftDetailSchema = z.object({ ...draftFields, body: faqDocumentSchema }).strict();
/** openapi `ContentDraft` for `faq` (the PATCH, discard and import answer). */
export const faqDraftSchema = z.object(draftFields).strict();
/** openapi `ContentPublishResult` for `faq`. */
export const faqPublishResultSchema = z
  .object({
    name: z.literal("faq"),
    version: z.number().int().min(1),
    previousVersion: z.number().int().min(1).nullable(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    byteSize: z.number().int().min(1),
    draftVersion: z.number().int().min(1),
    changeCount: z.number().int().min(0),
    manifestVersion: z.string(),
  })
  .strict();
/** openapi `FaqExport`: the published FAQ as one file, for the live Admin's import. */
export const faqExportSchema = z
  .object({
    kind: z.literal("faq-export"),
    format: z.literal("faq.v1"),
    sourceHost: z.string(),
    sourceVersion: z.number().int().min(1),
    publishedAt: isoDate,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    categories: faqCategories,
  })
  .strict();
export type FaqExportFile = z.infer<typeof faqExportSchema>;

/** Text as typed: the shared rule (lib/faq-desk.ts), which the backend applies again. */
const typed = (field: "title" | "question" | "answer") =>
  z
    .string()
    .max(faqLimits[field] * 4 + 64)
    .refine((text) => faqTextError(text, field) === undefined);
const categoryPosition = z.number().int().min(0).max(faqLimits.categories - 1);
const entryPosition = z.number().int().min(0).max(faqLimits.entries - 1);

/** openapi `FaqOperation`: one edit step, strict. */
export const faqOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("upsertCategory"), id: faqId, title: typed("title") }).strict(),
  z.object({ op: z.literal("removeCategory"), id: faqId }).strict(),
  z.object({ op: z.literal("moveCategory"), id: faqId, position: categoryPosition }).strict(),
  z
    .object({ op: z.literal("upsertEntry"), categoryId: faqId, id: faqId, question: typed("question"), answer: typed("answer") })
    .strict(),
  z.object({ op: z.literal("removeEntry"), id: faqId }).strict(),
  z.object({ op: z.literal("moveEntry"), id: faqId, categoryId: faqId, position: entryPosition }).strict(),
]);
/** openapi `FaqEditRequest`. The desk sends one operation per action; the contract allows up to 25. */
export const faqEditRequestSchema = z
  .object({ draftVersion: revision, operations: z.array(faqOperationSchema).min(1).max(25) })
  .strict();
/** openapi `ContentDraftVersion` (discard). */
export const faqDiscardRequestSchema = z.object({ draftVersion: revision }).strict();
/** openapi `ContentPublishRequest`, without the Card acknowledgement (not a `faq` field). */
export const faqPublishRequestSchema = z
  .object({ draftVersion: revision, note: z.string().min(1).max(300).optional() })
  .strict();
/** openapi `FaqImportRequest`. The file is passed on as read; the backend checks every field and its digest. */
export const faqImportRequestSchema = z
  .object({ draftVersion: revision, file: z.record(z.unknown()) })
  .strict();

/** What the Admin's FAQ routes answer: the draft a publish would write and what is live now. */
export type FaqDeskState = {
  draft: { categories: z.infer<typeof faqCategorySchema>[] };
  draftVersion: number;
  publishedVersion: number | null;
  changed: boolean;
  live: { categories: z.infer<typeof faqCategorySchema>[] } | null;
  liveVersion: number | null;
  livePublishedAt: string | null;
};
