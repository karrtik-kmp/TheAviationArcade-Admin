/**
 * The Aircraft Identifier desk's browser rules (A3.2): the client's 2026-09-28 sheet as backend content items. Pre-checks
 * mirror the backend's payload rules in its words; the backend checks again and is the authority. No zod.
 */
import type { IdentifierData, IdentifierItem } from "./request/identifier.ts";

export type { IdentifierData, IdentifierItem };

/** The photo a question is about: `ai-a11` and `ai-a11-2` are two questions on photo 11. */
export function photoNumber(id: string): string {
  return /^ai-a(\d+)/.exec(id)?.[1] ?? id;
}

/** The other questions on the same client photo (the pairs ai-a11/ai-a11-2 and ai-a18/ai-a18-2 in the delivery). */
export function photoPartners(items: IdentifierItem[], id: string): IdentifierItem[] {
  const number = photoNumber(id);
  return items.filter((item) => item.id !== id && photoNumber(item.id) === number);
}

/** Questions on DIFFERENT client photos that link the same backend photo: almost certainly a wrong link. */
export function misusedPhotos(items: IdentifierItem[]): Map<string, string[]> {
  const byMedia = new Map<string, IdentifierItem[]>();
  for (const item of items)
    if (item.mediaId && item.status !== "retired") byMedia.set(item.mediaId, [...(byMedia.get(item.mediaId) ?? []), item]);
  const out = new Map<string, string[]>();
  for (const [mediaId, users] of byMedia)
    if (new Set(users.map((item) => photoNumber(item.id))).size > 1) out.set(mediaId, users.map((item) => item.id));
  return out;
}

const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The backend's payload rules for this module, in its words: four answers present and all different. */
export function payloadErrors(data: Pick<IdentifierData, "answer" | "wrong">): string[] {
  const answer = data.answer.trim();
  const wrong = data.wrong.map((value) => value.trim());
  const errors: string[] = [];
  if (answer === "") errors.push("Correct Answer is missing.");
  wrong.forEach((value, i) => {
    if (value === "") errors.push(`Wrong Answer ${i + 1} is missing.`);
  });
  if (answer !== "" && wrong.every((value) => value !== "")) {
    const options = [answer, ...wrong].map(normalise);
    if (new Set(options).size !== options.length) errors.push("The correct and wrong answers must all be different.");
  }
  return errors;
}

/** Natural id order, as the backend lists them (`ai-a2` before `ai-a10`, `ai-a11` before `ai-a11-2`). */
export function compareIdentifierIds(a: string, b: string) {
  return a.localeCompare(b, "en", { numeric: true });
}
