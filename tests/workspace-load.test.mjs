import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allSources,
  blockingStatus,
  sectionView,
  sourceStates,
  sourcesFor,
  workspaceSources,
} from "../lib/workspace-load.ts";

const ok = (body = {}) => ({ status: 200, body });
const d1Down = {
  status: 503,
  body: { error: "This desk is moving to the game backend and is unavailable for now." },
};
const results = (overrides = {}) => ({
  submissions: ok({ submissions: [] }),
  content: ok({ records: [] }),
  audit: ok({ events: [] }),
  military: ok({ items: [] }),
  identifier: ok({ items: [] }),
  potd: ok({ items: [] }),
  ...overrides,
});
const allD1Down = results({ submissions: d1Down, content: d1Down, audit: d1Down, military: d1Down });

test("every D1 source failing leaves the backend desks reachable", () => {
  assert.equal(blockingStatus(allD1Down), null);
  const states = sourceStates(allD1Down);
  for (const section of ["Media", "Store", "Users"]) {
    assert.deepEqual(sourcesFor(section), []);
    assert.deepEqual(sectionView(section, states), { view: "ready", unavailable: [] });
  }
});

test("a desk shows its own source's error, with the server's message", () => {
  const states = sourceStates(results({ content: d1Down }));
  assert.deepEqual(sectionView("Aircraft Identifier", states), { view: "ready", unavailable: [] }, "on the backend since A3.2");
  assert.equal(sectionView("Aircraft Identifier", sourceStates(results({ identifier: d1Down }))).view, "error");
  assert.deepEqual(sectionView("Plane of the Day", states), { view: "ready", unavailable: [] }, "on the backend since A3.3");
  const view = sectionView("Plane of the Day", sourceStates(results({ potd: d1Down })));
  assert.equal(view.view, "error");
  assert.deepEqual(view.errors.map(({ source }) => source), ["potd"]);
  assert.equal(view.errors[0].error, d1Down.body.error);
  assert.deepEqual(sectionView("Submissions", states), { view: "ready", unavailable: [] });
  assert.deepEqual(sectionView("Activity", states), { view: "ready", unavailable: [] });
});

test("Military reads only its own backend source since A3.1, so the D1 desks failing don't hide it", () => {
  assert.deepEqual(sourcesFor("Military readiness"), ["military"]);
  const d1Only = results({ submissions: d1Down, content: d1Down, audit: d1Down });
  assert.deepEqual(sectionView("Military readiness", sourceStates(d1Only)), { view: "ready", unavailable: [] });
  assert.equal(sectionView("Military readiness", sourceStates(results({ military: d1Down }))).view, "error");
});

test("the Overview renders with what loaded and lists what didn't", () => {
  const view = sectionView("Overview", sourceStates(results({ submissions: d1Down, audit: d1Down })));
  assert.equal(view.view, "ready");
  assert.deepEqual(view.unavailable.map(({ source }) => source), ["submissions", "audit"]);
});

test("a section waits while any of its sources loads", () => {
  const states = { ...sourceStates(results()), submissions: { state: "loading" } };
  // Submissions reads the game backend's media itself since the A3 fix wave, so the D1 source no longer holds it up.
  assert.deepEqual(sectionView("Submissions", states), { view: "ready", unavailable: [] });
  assert.deepEqual(sectionView("Overview", states), { view: "loading" });
  assert.deepEqual(sectionView("Plane of the Day", states), { view: "ready", unavailable: [] });
  assert.deepEqual(sectionView("Military readiness", states), { view: "ready", unavailable: [] });
  assert.deepEqual(sectionView("Media", allSources({ state: "loading" })), { view: "ready", unavailable: [] });
});

test("an account mismatch from any one source blocks the whole workspace", () => {
  assert.equal(blockingStatus(results({ audit: { status: 401, body: {} } })), 401);
  assert.equal(blockingStatus(results({ military: { status: 403, body: {} } })), 403);
  assert.equal(blockingStatus(results({ content: { status: 409, body: { code: "ACCOUNT_CHANGED" } } })), 409);
  // Even when every other source fails differently.
  assert.equal(blockingStatus({ ...allD1Down, submissions: { status: 401, body: {} } }), 401);
  assert.equal(blockingStatus(results({ content: { status: 409, body: { code: "VERSION_CONFLICT" } } })), null);
});

test("network failures and bodies without a message get a per-source fallback", () => {
  const states = sourceStates(results({ audit: { status: 0, body: {} }, military: { status: 500, body: { error: 42 } } }));
  assert.equal(states.audit.state, "error");
  assert.equal(states.audit.error, "Could not load the activity log.");
  assert.equal(states.military.error, "Could not load Military readiness.");
  assert.equal(states.content.state, "ready");
});

test("every source is listed once", () => {
  assert.deepEqual([...new Set(workspaceSources)].sort(), ["audit", "content", "identifier", "military", "potd", "submissions"]);
});
