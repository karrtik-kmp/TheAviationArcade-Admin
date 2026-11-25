// The Submissions desk (A3 fix wave, B1a): the Media desk in review mode over the game backend's media. These are the
// rules the browser keeps; the routes are the media routes, tested in media.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agreementVersion, hasPublishableStatement, nameRemovedBlocker, publishBlockers, reviewChecks, reviewKey, reviewReady, rightsOwnerOnly, ticksFor } from "../lib/media-form.ts";
import { sourcesFor } from "../lib/workspace-load.ts";

const licence = { credit: "A. Pilot", licenceName: "CC BY 4.0", licenceUrl: null, sourceUrl: null, attributionText: null, creditRequired: true };
const stated = { statement: "v1_own", statedAt: "2026-11-20T10:00:00.000Z", statedBy: "firebase:p:u" };

test("the review checks are the five the plan names, each with its own id", () => {
  assert.deepEqual(
    reviewChecks.map((check) => check.id),
    ["quality", "credit", "licence", "rights", "safe"],
  );
  assert.equal(new Set(reviewChecks.map((check) => check.label)).size, reviewChecks.length);
});

test("a photo without a usable rights statement says only the photographer can fix it", () => {
  assert.deepEqual(publishBlockers(licence, stated), []);
  for (const rights of [null, { ...stated, statement: "d1_private_review" }]) {
    const blockers = publishBlockers(licence, rights);
    assert.deepEqual(blockers, [{ field: "rights", message: rightsOwnerOnly }], JSON.stringify(rights));
  }
  assert.match(rightsOwnerOnly, /Only the photographer can state the rights/);
});

test("the Submissions desk loads its own lists, like the Media desk", () => {
  assert.deepEqual([...sourcesFor("Submissions")], []);
  assert.deepEqual([...sourcesFor("Media")], []);
});

test("publishing needs every check ticked for THIS revision; a new revision starts them again", () => {
  const all = reviewChecks.map((check) => check.id);
  const photo = { id: "med-1", revision: 4 };
  const key = reviewKey(photo);
  assert.equal(key, "med-1:4");
  assert.equal(reviewReady({ key, ids: all }, key), true);
  assert.equal(reviewReady({ key, ids: all.slice(1) }, key), false, "one check missing");
  assert.equal(reviewReady({ key: "", ids: [] }, key), false, "nothing ticked yet");
  // The owner edited the photo, or another admin saved it: the revision moved, so the ticks no longer count.
  const moved = reviewKey({ ...photo, revision: 5 });
  assert.equal(reviewReady({ key, ids: all }, moved), false);
  assert.deepEqual(ticksFor({ key, ids: all }, moved), []);
  // Nor do ticks made on another photo at the same revision.
  assert.equal(reviewReady({ key, ids: all }, reviewKey({ id: "med-2", revision: 4 })), false);
});

test("0.29.0: the v2 agreement can be published; a v2 photo whose name was removed cannot", () => {
  const v2 = { statement: "v2_agreement_2026-12-01", statedAt: "2026-12-01T10:00:00.000Z" };
  assert.equal(hasPublishableStatement(v2), true);
  assert.equal(agreementVersion(v2), "2026-12-01");
  assert.equal(agreementVersion(stated), null);
  assert.deepEqual(publishBlockers(licence, v2, { fullName: "Sam Spotter" }), []);
  assert.deepEqual(publishBlockers(licence, v2, { fullName: null }), [{ field: "fullName", message: nameRemovedBlocker }]);
  // A v1 photo has no private name to need.
  assert.deepEqual(publishBlockers(licence, stated, { fullName: null }), []);
});

// 0.30.0 review feedback: which decisions the desk offers, and the reason rule it checks before sending.
const { reviewActions, reasonErrors, reasonLength, REVIEW_REASON_MAX } = await import("../lib/media-form.ts");
const decided = (decision) => ({ decision, reason: "x", version: 1, decidedAt: "2026-11-25T10:00:00.000Z" });

test("0.30.0: the review decisions offered follow the contract for every state", () => {
  const offer = (state, publishedVersion, draftVersion, review) =>
    reviewActions({ state, publishedVersion, draftVersion, review }).map((a) => `${a.decision}:${a.label}`);
  assert.deepEqual(offer("unverified", null, 1, null), ["changes_requested:Request changes", "declined:Decline"]);
  assert.deepEqual(offer("unverified", null, 1, decided("changes_requested")), [
    "changes_requested:Change the reason",
    "declined:Decline",
    "null:Withdraw the decision",
  ]);
  assert.deepEqual(offer("unverified", null, 2, decided("declined")), [
    "changes_requested:Reopen: request changes",
    "declined:Change the reason",
    "null:Withdraw the decision",
  ]);
  assert.deepEqual(offer("published", 1, 2, null), ["changes_requested:Request changes"], "a pending draft; never declined");
  assert.deepEqual(offer("published", 2, 2, null), [], "nothing pending");
  assert.deepEqual(offer("published", 2, 2, decided("changes_requested")), ["null:Withdraw the decision"]);
  assert.deepEqual(offer("withdrawn", null, 2, null), []);
  assert.deepEqual(offer("withdrawn", null, 2, decided("changes_requested")), ["null:Withdraw the decision"], "withdrawn keeps it");
});

test("0.30.0: the reason is counted and checked as it will be stored", () => {
  assert.equal(reasonLength("  a\r\nb  "), 3);
  assert.equal(reasonLength("\u{1F600}"), 1);
  assert.equal(reasonErrors("Please add the airline.\nThanks."), undefined);
  assert.equal(reasonErrors(`${"x".repeat(REVIEW_REASON_MAX)}   `), undefined);
  for (const bad of ["", "   ", "a\tb", "a\u0000b", "a\u2028b", "a\uD800b", "x".repeat(REVIEW_REASON_MAX + 1)])
    assert.equal(typeof reasonErrors(bad), "string", JSON.stringify(bad));
});
