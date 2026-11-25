// The Military desk on the game backend (A3.1): contract checks of the parsers, the routes' gate, what they send
// and how a backend refusal comes back. The backend is a fake that records each call.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BackendError, BackendNotConnected } from "../lib/request/backend.ts";
import * as military from "../lib/request/military.ts";
import { militaryRoutes } from "../lib/request/military-routes.ts";
import { resolvePrincipal } from "../lib/request/principal.ts";
import { dispatch } from "../lib/request/router.ts";
import { routes } from "../lib/request/routes.ts";

// ===== Contract tests =====

const yaml = await readFile(new URL("../contracts/openapi.yaml", import.meta.url), "utf8");
const block = (name) => {
  const start = yaml.indexOf(`\n    ${name}:\n      type:`);
  assert.ok(start >= 0, `${name} is in the contract`);
  const rest = yaml.slice(start + name.length + 7);
  const end = rest.search(/\n {4}[A-Za-z]/);
  return end < 0 ? rest : rest.slice(0, end);
};
const list = (text, key, indent = 6) => {
  const found = text.match(new RegExp(String.raw`\n {${indent}}${key}: \[([^\]]*)\]`));
  assert.ok(found, key);
  return found[1].split(",").map((s) => s.trim()).filter(Boolean).sort();
};
const keys = (schema) => Object.keys(schema.shape).sort();

test("the Military parsers list the contract's keys and enums", () => {
  assert.deepEqual(list(block("ContentItem"), "required"), keys(military.militaryItemSchema));
  assert.deepEqual(list(block("PrepStage"), "enum"), [...military.prepStages].sort());
  assert.deepEqual(list(block("Rank"), "enum"), [...military.rankIds].sort());
  assert.deepEqual(list(block("PrepEvidence"), "required"), keys(military.prepEvidenceSchema));
  assert.deepEqual(list(block("ContentItemPreparationRequest"), "required"), keys(military.preparationRequestSchema));
  assert.deepEqual(list(block("ContentItemPreparationChange"), "required"), keys(military.preparationChangeSchema));
  assert.deepEqual(list(block("ReleaseSummary"), "required"), keys(military.releaseSummarySchema));
  assert.deepEqual(list(block("ReleaseState"), "required"), keys(military.releaseStateSchema));
  assert.deepEqual(list(block("ReleaseList"), "required"), keys(military.releaseListSchema));
  // ReleaseUploadRequest's `note` is optional, as is ReleasePointerRequest's.
  assert.deepEqual([...list(block("ReleaseUploadRequest"), "required"), "note"].sort(), keys(military.releaseUploadRequestSchema));
  assert.deepEqual([...list(block("ReleasePointerRequest"), "required"), "note"].sort(), keys(military.releasePointerRequestSchema));
  assert.deepEqual(list(block("OwnRankCounts"), "required"), [...military.rankIds].sort());
});

// ===== Routes =====

const evidence = {
  photoSource: "media",
  licenseUrl: "",
  permission: "Josh supplied this photograph for the game.",
  attribution: "Tyler Hardie",
  referenceUrl: "",
  checklist: { identity: false, answers: false, crop: false, clipperCard: false },
  notes: "",
};
const item = (over = {}) => ({
  id: "mil-a1",
  rank: "trainee",
  status: "approved",
  source: "client_sheet",
  version: 3,
  data: {
    answer: "Warthog A-10 Thunderbolt II",
    wrong: ["Sukhoi Su-25 Frogfoot", "Ilyushin Il-102", "Northrop YA-9"],
    sourceFile: "MA_A_10_10_23_26_1.jpg",
    photographer: "Tyler Hardie",
  },
  mediaId: "med-7",
  preparation: { stage: "rights_checked", evidence, stale: false },
  updatedAt: "2026-11-18T10:00:00.000Z",
  ...over,
});
const pointer = { current: null, history: [], version: 0 };
const releaseList = {
  pointer,
  releases: [],
  ownRankCounts: { trainee: 0, "first-officer": 0, captain: 0, "check-airman": 0, "chief-pilot": 0 },
};
const summary = {
  number: 1,
  basis: "mil-a1:3",
  aircraft: 1,
  createdAt: "2026-11-18T10:00:00.000Z",
  note: null,
  status: "uploaded",
};
const base = "/v1/admin/content/aircraft-identifier-military";

const project = "demo-airplane-games";
const origin = "http://site.test";
const identity = (uid, email) => ({
  userId: `firebase:${project}:${uid}`,
  email,
  fullName: null,
  emailVerified: true,
  expiresAt: 9999999999,
  authTime: 1,
});
const adminRow = { role: "admin", state: "active", revision: 1, requestedAt: "2026-11-01T00:00:00.000Z", decidedAt: "2026-11-02T00:00:00.000Z" };

/** `reply(method, path, body)` answers each backend call; it may throw a BackendError. */
function harness({ reply = () => ({}), roles = { status: "ok", roles: [adminRow] } } = {}) {
  const calls = [];
  const handle = dispatch(routes, {
    principal: (request) =>
      resolvePrincipal(request.headers, {
        verifier: { verify: async () => identity("editor", "editor@example.com") },
        cookieName: "aa_session",
        roles: async () => roles,
        projectId: project,
        demoUid: "demo-uid",
      }),
    backend: () => {
      const run = async (method, path, body) => {
        calls.push({ method, path, body });
        return reply(method, path, body);
      };
      return { getJson: (path) => run("GET", path), send: (method, path, body) => run(method, path, body) };
    },
  });
  async function call(method, path, body) {
    const headers = { origin, cookie: "aa_session=staff" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await handle(
      new Request(`${origin}/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      path.split("/"),
    );
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  }
  return { call, calls };
}

test("the Military routes are all staff routes, and mutations are marked", () => {
  for (const r of militaryRoutes) {
    assert.equal(r.audience, "staff", r.path);
    assert.equal(!!r.mutation, r.method !== "GET", r.path);
  }
});

test("with mock roles or no backend the desk says why and makes no backend call", async () => {
  const mock = harness({ roles: { status: "ok", roles: [adminRow], source: "mock" } });
  const res = await mock.call("GET", "admin/military");
  assert.deepEqual([res.status, res.body.code], [404, "MILITARY_UNAVAILABLE"]);
  assert.match(res.body.error, /mock roles/);
  assert.equal(mock.calls.length, 0);
  const none = harness({ roles: { status: "not-connected" } });
  // Roles that cannot be read grant no staff role, so the router refuses before the handler (and any call).
  const unread = await none.call("GET", "admin/military");
  assert.deepEqual([unread.status, unread.body.code], [503, "ROLES_UNAVAILABLE"]);
  assert.equal(none.calls.length, 0);
  const unreachable = harness({ reply: () => Promise.reject(new BackendNotConnected()) });
  const down = await unreachable.call("GET", "admin/military");
  assert.deepEqual([down.status, down.body.code], [503, "BACKEND_NOT_CONNECTED"]);
});

test("the desk reads the items and the release state in one answer", async () => {
  const { call, calls } = harness({
    reply: (_method, path) => (path.endsWith("/items") ? { items: [item()] } : releaseList),
  });
  const res = await call("GET", "admin/military");
  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`).sort(), [`GET ${base}/items`, `GET ${base}/releases`]);
  assert.deepEqual(res.body, { items: [item()], ...releaseList });
});

test("an answer off the contract is refused, not passed on", async () => {
  for (const items of [[{ ...item(), extra: true }], [item({ data: { ...item().data, hint: "x" } })], [item({ rank: "pilot" })]]) {
    const { call } = harness({ reply: (_m, path) => (path.endsWith("/items") ? { items } : releaseList) });
    const res = await call("GET", "admin/military");
    assert.deepEqual([res.status, res.body.code], [502, "BACKEND_CONTRACT"]);
  }
});

test("a preparation goes to the item's backend route as sent, with the base version", async () => {
  const saved = item({ version: 4 });
  const { call, calls } = harness({ reply: () => ({ changed: true, item: saved }) });
  const body = { version: 3, stage: "rights_checked", evidence, mediaId: "med-7" };
  const res = await call("PUT", "admin/military/mil-a1/preparation", body);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { changed: true, item: saved });
  assert.deepEqual(calls, [{ method: "PUT", path: `${base}/items/mil-a1/preparation`, body }]);
});

test("a preparation carrying question content or a bad photo id is refused before any call", async () => {
  const { call, calls } = harness();
  for (const body of [
    { version: 3, stage: "rights_checked", evidence: { ...evidence, answer: "F-16" }, mediaId: null },
    { version: 3, stage: "rights_checked", evidence, mediaId: "photo-7" },
    { version: 0, stage: "rights_checked", evidence, mediaId: null },
    { version: 3, stage: "published", evidence, mediaId: null },
  ]) {
    const res = await call("PUT", "admin/military/mil-a1/preparation", body);
    assert.deepEqual([res.status, res.body.code], [400, "INVALID_REQUEST"], JSON.stringify(body));
  }
  assert.equal((await call("PUT", "admin/military/..%2F/preparation", { version: 3, stage: "missing_photo", evidence, mediaId: null })).status, 404);
  assert.equal(calls.length, 0);
});

test("backend refusals keep their reasons; a busy lock is a retry, not a conflict", async () => {
  const cases = [
    [new BackendError(409, "version_conflict"), 409, "VERSION_CONFLICT"],
    [new BackendError(422, "content_invalid", undefined, ["Record the permission or license terms in at least 10 characters."]), 422, "CONTENT_INVALID"],
    [new BackendError(409, "import_in_progress", 4), 503, "BUSY"],
    [new BackendError(404, "not_found"), 404, "NOT_FOUND"],
    [new BackendError(401, "unauthorized"), 401, "SIGNED_OUT"],
    [new BackendError(500, ""), 503, "BACKEND_UNAVAILABLE"],
    [new BackendError(422, "something_new"), 502, "BACKEND_CONTRACT"],
  ];
  for (const [error, status, code] of cases) {
    const { call } = harness({
      reply: () => {
        throw error;
      },
    });
    const res = await call("PUT", "admin/military/mil-a1/preparation", { version: 3, stage: "missing_photo", evidence, mediaId: null });
    assert.deepEqual([res.status, res.body.code], [status, code], `${error.status} ${error.code}`);
    if (code === "CONTENT_INVALID") assert.deepEqual(res.body.errors, error.errors);
    if (code === "BUSY") {
      assert.equal(res.headers.get("Retry-After"), "4");
      assert.match(res.body.error, /in 4 seconds/);
    }
  }
});

test("upload, activate and restore go to the release routes", async () => {
  const state = { pointer: { current: 1, history: [], version: 1 }, releases: [{ ...summary, status: "released" }] };
  const { call, calls } = harness({ reply: (_m, path) => (path.endsWith("/releases") ? summary : state) });
  const upload = { itemIds: ["mil-a1"], basis: "mil-a1:3", previewed: true };
  const uploaded = await call("POST", "admin/military/releases", upload);
  assert.deepEqual([uploaded.status, uploaded.body], [201, summary]);
  const live = await call("POST", "admin/military/releases/1/activate", { expectedPointerVersion: 0 });
  assert.deepEqual([live.status, live.body], [200, state]);
  const back = await call("POST", "admin/military/releases/restore", { expectedPointerVersion: 1 });
  assert.equal(back.status, 200);
  assert.deepEqual(calls, [
    { method: "POST", path: `${base}/releases`, body: upload },
    { method: "POST", path: `${base}/releases/1/activate`, body: { expectedPointerVersion: 0 } },
    { method: "POST", path: `${base}/releases/restore`, body: { expectedPointerVersion: 1 } },
  ]);
});

test("a release request that the backend would refuse as malformed never leaves", async () => {
  const { call, calls } = harness();
  for (const body of [
    { itemIds: ["mil-a1"], basis: "mil-a1:3", previewed: false },
    { itemIds: ["mil-a1", "mil-a1"], basis: "mil-a1:3,mil-a1:3", previewed: true },
    { itemIds: [], basis: "", previewed: true },
  ])
    assert.equal((await call("POST", "admin/military/releases", body)).status, 400, JSON.stringify(body));
  assert.equal((await call("POST", "admin/military/releases/0/activate", { expectedPointerVersion: 0 })).status, 404);
  assert.equal((await call("POST", "admin/military/releases/one/activate", { expectedPointerVersion: 0 })).status, 404);
  assert.equal((await call("POST", "admin/military/releases/restore", { pointerVersion: 0 })).status, 400);
  assert.equal(calls.length, 0);
});

test("an activate refused by the guard names each change; nothing_to_publish says so", async () => {
  const changes = ["mil-a1 changed since the release was uploaded."];
  const guard = harness({
    reply: () => {
      throw new BackendError(409, "version_conflict", undefined, changes);
    },
  });
  const res = await guard.call("POST", "admin/military/releases/2/activate", { expectedPointerVersion: 1 });
  assert.deepEqual([res.status, res.body.code], [409, "VERSION_CONFLICT"]);
  assert.match(res.body.error, /changed since it was uploaded\. mil-a1 changed/);
  const same = harness({
    reply: () => {
      throw new BackendError(409, "nothing_to_publish");
    },
  });
  const again = await same.call("POST", "admin/military/releases", { itemIds: ["mil-a1"], basis: "mil-a1:3", previewed: true });
  assert.deepEqual([again.status, again.body.code], [409, "NOTHING_TO_PUBLISH"]);
});

test("BackendError keeps only string reasons, bounded", async () => {
  const { backendClient } = await import("../lib/request/backend.ts");
  const reasons = ["first", 7, "", "second", ...Array.from({ length: 150 }, (_, i) => `r${i}`)];
  const client = backendClient(
    {
      baseUrl: "http://backend.test",
      fetch: async () => Response.json({ error: { code: "content_invalid", message: "x", requestId: "r" }, errors: reasons }, { status: 422 }),
    },
    { reveal: () => "token" },
  );
  await assert.rejects(client.getJson("/x"), (error) => {
    assert.ok(error instanceof BackendError);
    assert.equal(error.errors.length, 100);
    assert.deepEqual(error.errors.slice(0, 3), ["first", "second", "r0"]);
    return true;
  });
});

test("the remaining refusals map as the contract says", async () => {
  const upload = { itemIds: ["mil-a1"], basis: "mil-a1:3", previewed: true };
  const cases = [
    [new BackendError(409, "release_in_progress", 2), 503, "BUSY"],
    [new BackendError(403, "forbidden"), 403, "FORBIDDEN"],
    [new BackendError(413, "body_too_large"), 413, "TOO_LARGE"],
    [new BackendError(429, "rate_limited", 7.2), 429, "RATE_LIMITED"],
    [new BackendError(422, "unknown_item_ids"), 422, "UNKNOWN_ITEMS"],
  ];
  for (const [error, status, code] of cases) {
    const { call } = harness({
      reply: () => {
        throw error;
      },
    });
    const res = await call("POST", "admin/military/releases", upload);
    assert.deepEqual([res.status, res.body.code], [status, code], `${error.status} ${error.code}`);
    if (error.retryAfter !== undefined) assert.equal(res.headers.get("Retry-After"), String(Math.ceil(error.retryAfter)));
  }
});

test("a preparation conflict carries the backend's reasons, and a 404 on the desk read says what is missing", async () => {
  const conflict = harness({
    reply: () => {
      throw new BackendError(409, "version_conflict", undefined, ["mil-a1 was saved by another editor."]);
    },
  });
  const res = await conflict.call("PUT", "admin/military/mil-a1/preparation", { version: 3, stage: "missing_photo", evidence, mediaId: null });
  assert.deepEqual([res.status, res.body.errors], [409, ["mil-a1 was saved by another editor."]]);
  assert.match(res.body.error, /^Someone changed this question first\. mil-a1 was saved/);
  const old = harness({
    reply: () => {
      throw new BackendError(404, "not_found");
    },
  });
  const read = await old.call("GET", "admin/military");
  assert.match(read.body.error, /does not offer the Military desk/);
});

test("with mock roles no Military write reaches the backend either", async () => {
  const mock = harness({ roles: { status: "ok", roles: [adminRow], source: "mock" } });
  for (const [method, path, body] of [
    ["PUT", "admin/military/mil-a1/preparation", { version: 3, stage: "missing_photo", evidence, mediaId: null }],
    ["POST", "admin/military/releases", { itemIds: ["mil-a1"], basis: "mil-a1:3", previewed: true }],
    ["POST", "admin/military/releases/1/activate", { expectedPointerVersion: 0 }],
    ["POST", "admin/military/releases/restore", { expectedPointerVersion: 1 }],
  ]) {
    const res = await mock.call(method, path, body);
    assert.deepEqual([res.status, res.body.code], [404, "MILITARY_UNAVAILABLE"], path);
  }
  assert.equal(mock.calls.length, 0);
});
