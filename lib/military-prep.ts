/**
 * The Military desk's browser rules over the game backend's items (A3.1). The questions are the client's Military
 * sheet as the backend imported it (`mil-a1` … `mil-a31`); staff prepare each one's photograph and rights and record
 * releases. Everything here is a pre-check or a preview: the backend applies every rule again and is the authority
 * (its reasons are shown as given). Releases are recorded, not delivered. No zod, so the browser can load it.
 */
import { ranks, type RankId, type RankName } from "./catalog.ts";
import type { MilitaryDesk, MilitaryItem, PrepEvidence } from "./request/military.ts";

export type { MilitaryDesk, MilitaryItem, PrepEvidence };
export type PrepStage = "missing_photo" | "rights_checked" | "content_prepared" | "previewed" | "approved";
export type MilitaryRelease = MilitaryDesk["releases"][number];
export type MilitaryPointer = MilitaryDesk["pointer"];

export const prepStages: readonly PrepStage[] = [
  "missing_photo",
  "rights_checked",
  "content_prepared",
  "previewed",
  "approved",
];
export const stageNames: Record<PrepStage, string> = {
  missing_photo: "Missing photo",
  rights_checked: "Rights checked",
  content_prepared: "Content prepared",
  previewed: "Previewed",
  approved: "Approved",
};
export const checklistNames: { key: keyof PrepEvidence["checklist"]; label: string }[] = [
  { key: "identity", label: "Aircraft identity matches the reference" },
  { key: "answers", label: "The client's answer and wrong answers fit this photograph" },
  { key: "crop", label: "Mobile crop shows the aircraft fairly" },
  { key: "clipperCard", label: "Military Clipper Card mapping is correct" },
];

/** Flights in a Trip. As in the game, a Trip never repeats a question. */
export const TRIP_SIZE = 10;
/** The sample deals at most this many Flights from the pilot's own rank, the rest from ranks below. */
export const OWN_RANK_LIMIT = 6;

export const rankName = (id: RankId): RankName => ranks.find((rank) => rank.id === id)?.name ?? (id as RankName);
const rankOrder = (id: RankId) => ranks.findIndex((rank) => rank.id === id);

/** The stage an item stands at; never prepared is Missing photo. */
export const stageOf = (item: MilitaryItem): PrepStage => item.preparation?.stage ?? "missing_photo";
/** Approved and still current: the only state a release accepts. */
export const releasable = (item: MilitaryItem) =>
  item.status !== "retired" && item.preparation?.stage === "approved" && !item.preparation.stale && item.mediaId !== null;

/** A fresh preparation. The attribution starts as the photographer the client's sheet names; nothing else is filled. */
export function emptyEvidence(item: MilitaryItem): PrepEvidence {
  return {
    photoSource: "",
    licenseUrl: "",
    permission: "",
    attribution: item.data.photographer,
    referenceUrl: "",
    checklist: { identity: false, answers: false, crop: false, clipperCard: false },
    notes: "",
  };
}

/** The saved evidence as a form, or a fresh one. */
export function evidenceOf(item: MilitaryItem): PrepEvidence {
  const saved = item.preparation?.evidence;
  return saved ? { ...saved, checklist: { ...saved.checklist } } : emptyEvidence(item);
}

const https = (s: string) => /^https:\/\/[^\s/]+\.[^\s]+$/i.test(s.trim());

/**
 * What is still missing before an item can stand at `stage`, in the backend's words. Cumulative: each stage includes
 * the earlier ones. A pre-check only; the backend also checks that the linked photo is published.
 */
export function stageErrors(stage: PrepStage, evidence: PrepEvidence, mediaId: string | null): string[] {
  const at = prepStages.indexOf(stage);
  const errors: string[] = [];
  if (at >= 1) {
    if (evidence.photoSource === "media" && mediaId === null) errors.push("Link the backend photo that supplies the photograph.");
    else if (evidence.photoSource === "licensed" && !https(evidence.licenseUrl))
      errors.push("Add the https link to the photograph's license or source.");
    else if (evidence.photoSource === "") errors.push("Choose where the photograph comes from.");
    if (evidence.permission.trim().length < 10) errors.push("Record the permission or license terms in at least 10 characters.");
    if (evidence.attribution.trim().length < 2) errors.push("Add the attribution to display.");
  }
  if (at >= 2 && !https(evidence.referenceUrl)) errors.push("Add an https reference that confirms the aircraft identity.");
  if (at >= 3 && !evidence.checklist.crop) errors.push("Preview the mobile crop before marking the package previewed.");
  if (at >= 4 && !checklistNames.every(({ key }) => evidence.checklist[key]))
    errors.push("Complete every preview checklist item before approval.");
  return errors;
}

export type RankReadiness = {
  rank: RankId;
  /** Non-retired questions at this rank. */
  slots: number;
  stages: Record<PrepStage, number>;
  /** Approved and still current. */
  approved: number;
  /** Approved questions whose item changed since: prepare again. */
  stale: number;
  /** Approved, current questions a pilot at this rank can be dealt: this rank plus every earlier one. */
  eligibleApproved: number;
  eligibleTotal: number;
  tripReady: boolean;
};

/** Per rank, by stage. A preview of coverage only: the backend dealer decides whether a release can fill a Trip. */
export function readiness(items: MilitaryItem[]) {
  const live = items.filter((item) => item.status !== "retired");
  let eligibleApproved = 0;
  let eligibleTotal = 0;
  const byRank: RankReadiness[] = ranks.map(({ id }) => {
    const own = live.filter((item) => item.rank === id);
    const stages = Object.fromEntries(prepStages.map((stage) => [stage, 0])) as Record<PrepStage, number>;
    for (const item of own) stages[stageOf(item)] += 1;
    const approved = own.filter(releasable).length;
    const stale = own.filter((item) => item.preparation?.stage === "approved" && item.preparation.stale).length;
    eligibleApproved += approved;
    eligibleTotal += own.length;
    return { rank: id, slots: own.length, stages, approved, stale, eligibleApproved, eligibleTotal, tripReady: eligibleApproved >= TRIP_SIZE };
  });
  const approved = byRank.reduce((sum, rank) => sum + rank.approved, 0);
  return { ranks: byRank, approved, total: live.length };
}

/** Identifies the exact item versions a preview or release is built from, as the backend computes it. */
export function releaseBasis(items: Pick<MilitaryItem, "id" | "version">[]) {
  return items
    .map((item) => `${item.id}:${item.version}`)
    .sort()
    .join(",");
}

/**
 * The questions a release would hold. "all" sends every non-retired question (batch behaviour: the backend lists every
 * one that is not ready); "ready" leaves out the ones not yet approved, current and photographed (ruling R-3: a choice,
 * not a retire).
 */
export function releaseSelection(items: MilitaryItem[], scope: "all" | "ready") {
  return items.filter((item) => item.status !== "retired" && (scope === "all" || releasable(item)));
}

export type TripQuestion = { id: string; answer: string; rank: RankId; mediaId: string | null; options: string[] };
export type SampleTrip = { rank: RankId; questions: TripQuestion[] };

function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
function shuffle<T>(values: T[], random: () => number) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One sample Trip per rank for staff review before a release: up to OWN_RANK_LIMIT questions at the rank, the rest from
 * earlier ranks, topped up from the rank itself, never a question twice. Options are the client's answer and wrong
 * answers, shuffled. A rank without TRIP_SIZE questions at or below it has no sample. This is a preview; the backend's
 * dealer (`nearest-ranks`) is what the release check uses.
 */
export function sampleTrips(chosen: MilitaryItem[], seed: string): SampleTrip[] {
  const random = seeded(seed);
  const trips: SampleTrip[] = [];
  for (const { id: rank } of ranks) {
    const order = rankOrder(rank);
    const own = shuffle(chosen.filter((item) => item.rank === rank), random);
    const below = shuffle(chosen.filter((item) => rankOrder(item.rank) < order), random);
    const picked = [...new Set([...own.slice(0, OWN_RANK_LIMIT), ...below, ...own])].slice(0, TRIP_SIZE);
    if (picked.length < TRIP_SIZE) continue;
    trips.push({
      rank,
      questions: shuffle(picked, random).map((item) => ({
        id: item.id,
        answer: item.data.answer,
        rank: item.rank,
        mediaId: item.mediaId,
        options: shuffle([item.data.answer, ...item.data.wrong], random),
      })),
    });
  }
  return trips;
}

/** Natural order of item ids, as the backend lists them (`mil-a2` before `mil-a10`). */
export function compareIds(a: string, b: string) {
  return a.localeCompare(b, "en", { numeric: true });
}
