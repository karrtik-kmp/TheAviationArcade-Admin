// The Military desk's browser rules over backend items (A3.1): pre-checks in the backend's words, coverage and the
// release selection. The backend stays the authority; these only decide what the desk offers.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyEvidence,
  evidenceOf,
  readiness,
  releasable,
  releaseBasis,
  releaseSelection,
  sampleTrips,
  stageErrors,
  stageOf,
  TRIP_SIZE,
} from "../lib/military-prep.ts";

const ranks = ["trainee", "first-officer", "captain", "check-airman", "chief-pilot"];
const evidence = (over = {}) => ({
  photoSource: "media",
  licenseUrl: "",
  permission: "Supplied by the client for the game.",
  attribution: "Tyler Hardie",
  referenceUrl: "https://example.org/a-10",
  checklist: { identity: true, answers: true, crop: true, clipperCard: true },
  notes: "",
  ...over,
});
let n = 0;
const item = (over = {}) => {
  n += 1;
  return {
    id: `mil-a${n}`,
    rank: "trainee",
    status: "approved",
    source: "client_sheet",
    version: 2,
    data: { answer: `Aircraft ${n}`, wrong: [`W${n}a`, `W${n}b`, `W${n}c`], sourceFile: `f${n}.jpg`, photographer: "Lens" },
    mediaId: `med-${n}`,
    preparation: { stage: "approved", evidence: evidence(), stale: false },
    updatedAt: "2026-11-18T10:00:00.000Z",
    ...over,
  };
};

test("stage pre-checks are cumulative and worded as the backend words them", () => {
  const bare = emptyEvidence(item());
  assert.deepEqual(stageErrors("missing_photo", bare, null), []);
  assert.deepEqual(stageErrors("rights_checked", bare, null), [
    "Choose where the photograph comes from.",
    "Record the permission or license terms in at least 10 characters.",
  ]);
  assert.deepEqual(stageErrors("rights_checked", evidence(), null), ["Link the backend photo that supplies the photograph."]);
  assert.deepEqual(stageErrors("rights_checked", evidence({ photoSource: "licensed", licenseUrl: "http://x.org" }), "med-1"), [
    "Add the https link to the photograph's license or source.",
  ]);
  assert.deepEqual(stageErrors("content_prepared", evidence({ referenceUrl: "" }), "med-1"), [
    "Add an https reference that confirms the aircraft identity.",
  ]);
  assert.deepEqual(stageErrors("previewed", evidence({ checklist: { identity: true, answers: true, crop: false, clipperCard: true } }), "med-1"), [
    "Preview the mobile crop before marking the package previewed.",
  ]);
  assert.deepEqual(stageErrors("approved", evidence({ checklist: { identity: true, answers: false, crop: true, clipperCard: true } }), "med-1"), [
    "Complete every preview checklist item before approval.",
  ]);
  assert.deepEqual(stageErrors("approved", evidence(), "med-1"), []);
});

test("a fresh form starts with only the sheet's photographer; a saved one is copied, not shared", () => {
  const fresh = item({ preparation: null });
  assert.equal(stageOf(fresh), "missing_photo");
  assert.deepEqual(emptyEvidence(fresh), {
    photoSource: "",
    licenseUrl: "",
    permission: "",
    attribution: "Lens",
    referenceUrl: "",
    checklist: { identity: false, answers: false, crop: false, clipperCard: false },
    notes: "",
  });
  const saved = item();
  const form = evidenceOf(saved);
  form.checklist.crop = false;
  assert.equal(saved.preparation.evidence.checklist.crop, true, "editing the form leaves the item alone");
});

test("only approved, current, photographed and unretired items are releasable", () => {
  assert.equal(releasable(item()), true);
  assert.equal(releasable(item({ mediaId: null })), false);
  assert.equal(releasable(item({ status: "retired" })), false);
  assert.equal(releasable(item({ preparation: { stage: "previewed", evidence: evidence(), stale: false } })), false);
  assert.equal(releasable(item({ preparation: { stage: "approved", evidence: evidence(), stale: true } })), false);
});

test("the release selection: every unretired question, or only the ready ones", () => {
  const ready = item();
  const notYet = item({ preparation: null, mediaId: null });
  const retired = item({ status: "retired" });
  assert.deepEqual(releaseSelection([ready, notYet, retired], "all").map((i) => i.id), [ready.id, notYet.id]);
  assert.deepEqual(releaseSelection([ready, notYet, retired], "ready").map((i) => i.id), [ready.id]);
});

test("the basis is the sorted id:version list, as the backend computes it", () => {
  assert.equal(
    releaseBasis([
      { id: "mil-a10", version: 2 },
      { id: "mil-a2", version: 5 },
      { id: "mil-a1", version: 1 },
    ]),
    // A plain code-unit sort, exactly the backend's: "0" sorts before ":", so mil-a10 comes before mil-a1.
    "mil-a10:2,mil-a1:1,mil-a2:5",
  );
});

test("coverage counts by stage, and a Trip needs TRIP_SIZE at or below the rank", () => {
  const items = [
    ...Array.from({ length: 6 }, () => item({ rank: "trainee" })),
    ...Array.from({ length: 4 }, () => item({ rank: "first-officer" })),
    item({ rank: "captain", preparation: null }),
    item({ rank: "captain", preparation: { stage: "approved", evidence: evidence(), stale: true } }),
    item({ rank: "captain", status: "retired" }),
  ];
  const report = readiness(items);
  assert.equal(report.total, 12, "retired questions are left out");
  assert.equal(report.approved, 10);
  const [trainee, firstOfficer, captain] = report.ranks;
  assert.deepEqual([trainee.approved, trainee.tripReady], [6, false]);
  assert.deepEqual([firstOfficer.eligibleApproved, firstOfficer.tripReady], [10, true]);
  assert.deepEqual([captain.slots, captain.stages.missing_photo, captain.stale, captain.approved], [2, 1, 1, 0]);
});

test("sample Trips never repeat a question and use the client's options", () => {
  const items = ranks.flatMap((rank) => Array.from({ length: 4 }, () => item({ rank })));
  const trips = sampleTrips(items, "seed");
  assert.deepEqual(trips.map((t) => t.rank), ["captain", "check-airman", "chief-pilot"], "Trainee has 4 and First Officer 8 at or below it");
  for (const trip of trips) {
    assert.equal(trip.questions.length, TRIP_SIZE);
    assert.equal(new Set(trip.questions.map((q) => q.id)).size, TRIP_SIZE);
    const order = ranks.indexOf(trip.rank);
    assert.ok(trip.questions.every((q) => ranks.indexOf(q.rank) <= order), "never above the rank");
    for (const q of trip.questions) {
      const source = items.find((i) => i.id === q.id);
      assert.deepEqual([...q.options].sort(), [source.data.answer, ...source.data.wrong].sort());
    }
  }
  assert.deepEqual(sampleTrips(items, "seed"), trips, "the same seed deals the same samples");
});
