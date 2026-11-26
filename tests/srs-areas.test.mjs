import assert from "node:assert/strict";
import { test } from "node:test";
import { areaForPlanned, coverage, isPlanned, navGroups, plannedSections, srsAreas } from "../lib/srs-areas.ts";
import { sectionView, allSources } from "../lib/workspace-load.ts";

const desks = [
  "Overview",
  "Submissions",
  "Aircraft Identifier",
  "Plane of the Day",
  "Military readiness",
  "Media",
  "Store",
  "Users",
  "FAQ",
  "Activity",
];

test("the sidebar lists every desk and every planned page exactly once", () => {
  const listed = navGroups.flatMap((group) => group.items);
  assert.equal(new Set(listed).size, listed.length);
  assert.deepEqual([...listed].sort(), [...desks, ...plannedSections].sort());
});

test("every planned page belongs to one area and is never a desk", () => {
  for (const section of plannedSections) {
    assert.ok(isPlanned(section));
    assert.equal(srsAreas.filter((area) => area.planned === section).length, 1);
    assert.ok(!desks.includes(section));
    assert.ok(areaForPlanned(section).requirements.length > 0);
  }
  for (const desk of desks) assert.ok(!isPlanned(desk));
});

test("requirement ids are unique and coverage adds up", () => {
  const all = srsAreas.flatMap((area) => area.requirements);
  assert.equal(new Set(all.map((item) => item.id)).size, all.length);
  const counts = coverage(all);
  assert.equal(counts.built + counts.partial + counts.backlog + counts.blocked, counts.total);
});

test("an area's desks are real desks", () => {
  for (const area of srsAreas) for (const desk of area.desks) assert.ok(desks.includes(desk), desk);
});

test("a planned page reads nothing, so it never waits on or fails with a backend source", () => {
  const failing = allSources({ state: "error", error: "down" });
  for (const section of plannedSections) assert.deepEqual(sectionView(section, failing), { view: "ready", unavailable: [] });
});
