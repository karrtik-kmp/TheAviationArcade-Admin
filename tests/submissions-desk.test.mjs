// The Submissions desk (A3 fix wave, B1a): the Media desk in review mode over the game backend's media. These are the
// rules the browser keeps; the routes are the media routes, tested in media.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { publishBlockers, reviewChecks, reviewKey, reviewReady, rightsOwnerOnly, ticksFor } from "../lib/media-form.ts";
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
