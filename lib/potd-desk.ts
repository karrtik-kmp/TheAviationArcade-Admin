/**
 * The Plane of the Day desk's browser rules (A3.3): the backend's editorial items of kind `plane-of-the-day`. The
 * pre-checks mirror the save route's rules (openapi `saveEditorialItem`) in plain words; the backend checks again and is
 * the authority, including the photo rule (published, not demo-owned, with a licence credit). No zod.
 */
import { ranks } from "./catalog.ts";
import type { PotdData, PotdItem, PotdStatus } from "./request/potd.ts";

export type { PotdData, PotdItem, PotdStatus };

export const potdStatusLabel: Record<PotdStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

/** What the editor holds: the whole editable state, as the save replaces it. */
export type PotdForm = { status: PotdStatus; dateKey: string; data: PotdData };

/** The backend stores exactly 3 distractors once saved; a new draft's blank shape may carry another count. */
export function formOf(item: PotdItem): PotdForm {
  const distractors = [...item.data.distractors.slice(0, 3)];
  while (distractors.length < 3) distractors.push("");
  return { status: item.status, dateKey: item.dateKey ?? "", data: { ...item.data, distractors } };
}

/** The request body for `PUT …/items/{id}` without the version, which the draft session adds. */
export function saveBody(form: PotdForm) {
  return { status: form.status, data: form.data, dateKey: form.dateKey === "" ? null : form.dateKey };
}

/** True when the form differs from the item as stored (the backend compares trimmed text, so this may over-report). */
export function isDirty(item: PotdItem, form: PotdForm): boolean {
  return JSON.stringify(saveBody(formOf(item))) !== JSON.stringify(saveBody(form));
}

const length = (value: string) => [...value.trim()].length;
const instagramPattern = /^@?[A-Za-z0-9._]{1,30}$/;

function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Every problem the backend would refuse the save for, as far as the browser can tell. `devDemoWaiver` (dev Admin only,
 * lib/dev-waiver.ts) allows an EMPTY factual source when scheduling or publishing; a source that is given must still
 * be https.
 */
export function potdErrors(form: PotdForm, waiver: { devDemoWaiver?: boolean } = {}): string[] {
  const { data, status, dateKey } = form;
  const errors: string[] = [];
  const instagram = data.instagram.trim();
  if (instagram && !instagramPattern.test(instagram) && !/^https:\/\//.test(instagram))
    errors.push("Instagram must be empty, a handle such as @name, or an https link.");
  if (data.difficulty && !ranks.some((rank) => rank.id === data.difficulty)) errors.push("Choose a rank for the difficulty, or none.");
  if (dateKey && !realDate(dateKey)) errors.push("Use a real calendar date.");
  if (data.distractors.length !== 3) errors.push("Give exactly three distractors.");
  if (status === "scheduled" || status === "published") {
    if (length(data.title) < 3) errors.push("Add a title of at least 3 characters.");
    if (length(data.description) < 15) errors.push("Add a description of at least 15 characters.");
    const source = data.factualSource.trim();
    const waived = waiver.devDemoWaiver === true && source === "";
    if (!waived && !/^https:\/\//.test(source)) errors.push("Add a factual source that starts with https://.");
    if (!dateKey) errors.push("Choose the date it runs.");
  }
  return errors;
}

/** Scheduled and published items by date (soonest first), then drafts and archived items, most recently updated first. */
export function comparePotd(a: PotdItem, b: PotdItem): number {
  const live = (item: PotdItem) => item.status === "scheduled" || item.status === "published";
  if (live(a) !== live(b)) return live(a) ? -1 : 1;
  if (live(a) && a.dateKey !== b.dateKey) return (a.dateKey ?? "").localeCompare(b.dateKey ?? "");
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** The photos that already have an item: a second item on one photo is allowed, but the picker says so. */
export function photosInUse(items: PotdItem[]): Set<string> {
  return new Set(items.filter((item) => item.status !== "archived").map((item) => item.mediaId));
}
