/**
 * The Activity desk's browser rules (A3.4): the backend's audit events as they come. The waiver flags are read from the
 * event's own detail and shown with the value the record gives; nothing is inferred from other fields. The actor is the
 * principal string as stored, never mapped to an email or a name. No zod.
 */
import type { AuditAction, AuditEvent } from "./request/audit.ts";

export type { AuditAction, AuditEvent };

/**
 * The dev-demo waiver flags the backend writes into an audit detail (Backend docs/plans/dev-licence-waiver.md):
 * `media_publish.licenceWaived`, `editorial_save.factualSourceWaived` and `media_import.creditWaived`, each the waiver's
 * name (`"dev-demo"`). They are looked for on every event, so a flag is never hidden by a guess about its action.
 */
export const waiverFlags = [
  { key: "licenceWaived", label: "Licence waived" },
  { key: "factualSourceWaived", label: "Source waived" },
  { key: "creditWaived", label: "Credit waived" },
] as const;

export type Waiver = { key: (typeof waiverFlags)[number]["key"]; label: string; value: string };

/** A detail value as text, exactly: a string as it is, anything else as JSON. */
export function detailText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value) ?? String(value);
}

/** The waiver flags this event's detail carries, with the value it gives, in a fixed order. */
export function eventWaivers(event: Pick<AuditEvent, "detail">): Waiver[] {
  return waiverFlags.flatMap(({ key, label }) =>
    Object.prototype.hasOwnProperty.call(event.detail, key) ? [{ key, label, value: detailText(event.detail[key]) }] : [],
  );
}

/** What kind of actor the stored string names, from its documented prefix; the string itself is always shown too. */
export function actorKind(actor: string): "account" | "operator" | "system" | "other" {
  if (/^firebase:[^:]+:.+$/.test(actor)) return "account";
  if (actor.startsWith("operator:")) return "operator";
  if (actor.startsWith("system:")) return "system";
  return "other";
}

/** The action as words: `media_publish` → "media publish". */
export function actionText(action: string): string {
  return action.replaceAll("_", " ");
}
