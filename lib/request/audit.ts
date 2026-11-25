/**
 * The Activity desk on the game backend (A3.4, docs/A3_PLAN.md): `GET /v1/admin/audit` (API 0.26.0), the newest 50
 * `admin_audit` rows, newest first, with no paging and no filter. `actor` is the stored principal string
 * (`firebase:<project>:<uid>`, `operator:<os user>` or `system:signup`) and is never an email or a name; the desk shows
 * it as given and never maps it to one. `detail` is an open object shaped by `action`, passed through as the backend
 * gives it. Server side only: the browser imports types from here, never these schemas. Relative imports only.
 */
import { z } from "zod";

export const auditErrorCodes = {
  AUDIT_UNAVAILABLE: "AUDIT_UNAVAILABLE",
  BACKEND_NOT_CONNECTED: "BACKEND_NOT_CONNECTED",
  ROLES_UNAVAILABLE: "ROLES_UNAVAILABLE",
  BACKEND_UNAVAILABLE: "BACKEND_UNAVAILABLE",
  BACKEND_CONTRACT: "BACKEND_CONTRACT",
  FORBIDDEN: "FORBIDDEN",
  SIGNED_OUT: "SIGNED_OUT",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

/** openapi `AuditEvent.action`, which the backend pins to its `ADMIN_AUDIT_ACTIONS`. */
export const auditActions = [
  "content_import",
  "content_publish",
  "content_edit",
  "content_retire",
  "content_restore",
  "role_request",
  "role_approve",
  "role_reject",
  "role_grant",
  "role_revoke",
  "role_block",
  "role_unblock",
  "role_email_edit",
  "media_upload",
  "media_version",
  "media_edit",
  "media_publish",
  "media_withdraw",
  "content_media_link",
  "media_rights",
  "media_import",
  "store_product_create",
  "store_product_edit",
  "store_product_retire",
  "store_product_restore",
  "editorial_create",
  "editorial_save",
  "content_prepare",
  "release_create",
  "release_activate",
  "release_restore",
  "media_review",
] as const;
export type AuditAction = (typeof auditActions)[number];

/** openapi `AuditEvent.id`: `aud-<n>`, opaque; a newer event has a larger number. */
export const auditEventIdPattern = /^aud-[1-9][0-9]*$/;

/** A well-formed action name, known or not: lower case, digits and underscores, starting with a letter. */
export const auditActionPattern = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * openapi `AuditEvent`. `detail` must be an object (an array or a scalar is off the contract); its keys are open. The
 * contract gives `entity` and `actor` no length; the 500-character caps are this website's defensive bound (as in the
 * other desks' parsers), well above any principal, media id, module, product id or editorial kind.
 */
export const auditEventSchema = z
  .object({
    id: z.string().regex(auditEventIdPattern),
    entity: z.string().max(500),
    // Deliberately looser than the contract's closed enum (`auditActions`): the backend adds actions with new waves, and
    // one unknown row must not turn the other 49 into a 502. It is only ever shown as escaped text (`actionText`).
    action: z.string().regex(auditActionPattern),
    actor: z.string().max(500),
    detail: z.record(z.string(), z.unknown()),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type AuditEvent = z.infer<typeof auditEventSchema>;

/** openapi `AuditEventList`: at most 50 events, newest first. */
export const auditEventListSchema = z.object({ events: z.array(auditEventSchema).max(50) }).strict();
export type AuditEventList = z.infer<typeof auditEventListSchema>;
