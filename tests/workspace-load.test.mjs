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
const down = {
  status: 503,
  body: { error: "The game backend is unavailable for now." },
};
const results = (overrides = {}) => ({
  audit: ok({ events: [] }),
  military: ok({ items: [] }),
  identifier: ok({ items: [] }),
  potd: ok({ items: [] }),
  ...overrides,
});
const allDown = results({ audit: down, military: down, identifier: down, potd: down });

test("every source failing leaves the desks that read their own data reachable", () => {
  assert.equal(blockingStatus(allDown), null);
  const states = sourceStates(allDown);
  for (const section of ["Media", "Store", "Users", "Submissions"]) {
    assert.deepEqual(sourcesFor(section), []);
    assert.deepEqual(sectionView(section, states), { view: "ready", unavailable: [] });
  }
});

test("a desk shows its own source's error, with the server's message", () => {
  assert.equal(sectionView("Aircraft Identifier", sourceStates(results({ identifier: down }))).view, "error");
  assert.deepEqual(sectionView("Aircraft Identifier", sourceStates(results({ potd: down }))), { view: "ready", unavailable: [] });
  const view = sectionView("Plane of the Day", sourceStates(results({ potd: down })));
  assert.equal(view.view, "error");
  assert.deepEqual(view.errors.map(({ source }) => source), ["potd"]);
  assert.equal(view.errors[0].error, down.body.error);
  assert.deepEqual(sectionView("Activity", sourceStates(results({ potd: down }))), { view: "ready", unavailable: [] });
});

test("Military reads only its own backend source", () => {
  assert.deepEqual(sourcesFor("Military readiness"), ["military"]);
  assert.deepEqual(sectionView("Military readiness", sourceStates(results({ audit: down, potd: down }))), {
    view: "ready",
    unavailable: [],
  });
  assert.equal(sectionView("Military readiness", sourceStates(results({ military: down }))).view, "error");
});

test("the Overview renders with what loaded and lists what didn't", () => {
  const view = sectionView("Overview", sourceStates(results({ potd: down, audit: down })));
  assert.equal(view.view, "ready");
  assert.deepEqual(view.unavailable.map(({ source }) => source), ["audit", "potd"]);
  assert.deepEqual([...sourcesFor("Overview")], ["audit", "identifier", "potd"]);
});

test("a section waits while any of its sources loads", () => {
  const states = { ...sourceStates(results()), audit: { state: "loading" } };
  assert.deepEqual(sectionView("Submissions", states), { view: "ready", unavailable: [] });
  assert.deepEqual(sectionView("Overview", states), { view: "loading" });
  assert.deepEqual(sectionView("Activity", states), { view: "loading" });
  assert.deepEqual(sectionView("Plane of the Day", states), { view: "ready", unavailable: [] });
  assert.deepEqual(sectionView("Military readiness", states), { view: "ready", unavailable: [] });
  assert.deepEqual(sectionView("Media", allSources({ state: "loading" })), { view: "ready", unavailable: [] });
});

test("an account mismatch from any one source blocks the whole workspace", () => {
  assert.equal(blockingStatus(results({ audit: { status: 401, body: {} } })), 401);
  assert.equal(blockingStatus(results({ military: { status: 403, body: {} } })), 403);
  assert.equal(blockingStatus(results({ potd: { status: 409, body: { code: "ACCOUNT_CHANGED" } } })), 409);
  // Even when every other source fails differently.
  assert.equal(blockingStatus({ ...allDown, identifier: { status: 401, body: {} } }), 401);
  assert.equal(blockingStatus(results({ potd: { status: 409, body: { code: "VERSION_CONFLICT" } } })), null);
});

test("network failures and bodies without a message get a per-source fallback", () => {
  const states = sourceStates(results({ audit: { status: 0, body: {} }, military: { status: 500, body: { error: 42 } } }));
  assert.equal(states.audit.state, "error");
  assert.equal(states.audit.error, "Could not load the activity log.");
  assert.equal(states.military.error, "Could not load Military readiness.");
  assert.equal(states.potd.state, "ready");
});

test("every source is listed once", () => {
  assert.deepEqual([...new Set(workspaceSources)].sort(), ["audit", "identifier", "military", "potd"]);
});
