// The Aircraft Identifier desk on the game backend (A3.2): contract checks of the parsers, the routes' gate, what
// they send, how a refusal comes back, and the desk's browser rules. The backend is a fake that records each call.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BackendError, backendClient } from "../lib/request/backend.ts";
import * as identifier from "../lib/request/identifier.ts";
import { identifierRoutes } from "../lib/request/identifier-routes.ts";
import { resolvePrincipal } from "../lib/request/principal.ts";
import { dispatch } from "../lib/request/router.ts";
import { routes } from "../lib/request/routes.ts";
import { compareIdentifierIds, misusedPhotos, payloadErrors, photoNumber, photoPartners } from "../lib/identifier-desk.ts";

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
const properties = (text) => [...text.matchAll(/\n {8}([A-Za-z]+):/g)].map((m) => m[1]).sort();

test("the Identifier parsers list the contract's keys", () => {
  assert.deepEqual(list(block("ContentItem"), "required"), keys(identifier.identifierItemSchema));
  assert.deepEqual(list(block("ContentItemChange"), "required"), keys(identifier.identifierChangeSchema));
  assert.deepEqual(properties(block("ContentItemEditRequest")), keys(identifier.identifierEditRequestSchema));
  assert.deepEqual(list(block("ContentItemVersionRequest"), "required"), keys(identifier.identifierVersionRequestSchema));
  assert.deepEqual(list(block("ContentItemMediaRequest"), "required"), keys(identifier.identifierMediaRequestSchema));
  assert.match(block("ContentItemEditRequest"), /Airport Spotter and Identifier are `\{ answer, wrong\[3\], sourceFile \}`/);
});

// ===== Routes =====

const item = (over = {}) => ({
  id: "ai-a11",
  rank: "chief-pilot",
  status: "approved",
  source: "client_sheet",
  version: 2,
  data: { answer: "Airbus A321neo", wrong: ["Airbus A321ceo", "Airbus A320neo", "Airbus A320ceo"], sourceFile: "ai-a11.jpg" },
  mediaId: null,
  preparation: null,
  updatedAt: "2026-11-19T10:00:00.000Z",
  ...over,
});
const base = "/v1/admin/content/identifier";
const change = (over = {}) => ({ changed: true, item: item({ version: 3, ...over }), diff: [{ field: "rank", from: "captain", to: "chief-pilot" }] });

const project = "demo-airplane-games";
const origin = "http://site.test";
const adminRow = { role: "admin", state: "active", revision: 1, requestedAt: "2026-11-01T00:00:00.000Z", decidedAt: "2026-11-02T00:00:00.000Z" };

function harness({ reply = () => ({}), roles = { status: "ok", roles: [adminRow] } } = {}) {
  const calls = [];
  const handle = dispatch(routes, {
    principal: (request) =>
      resolvePrincipal(request.headers, {
        verifier: {
          verify: async () => ({
            userId: `firebase:${project}:editor`,
            email: "editor@example.com",
            fullName: null,
            emailVerified: true,
            expiresAt: 9999999999,
            authTime: 1,
          }),
        },
        cookieName: "aa_session",
        roles: async () => roles,
        projectId: project,
        demoUid: "demo-uid",
      }),
    db: () => {
      throw new Error("no D1 here");
    },
    photos: () => {
      throw new Error("no photo storage here");
    },
    editorial: () => {
      throw new Error("no editorial store here");
    },
    content: () => {
      throw new Error("no content store here");
    },
    references: async () => ({}),
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

test("the Identifier routes are staff routes, and every write is marked as a mutation", () => {
  for (const r of identifierRoutes) {
    assert.equal(r.audience, "staff", r.path);
    assert.equal(!!r.mutation, r.method !== "GET", r.path);
  }
});

test("with mock roles every Identifier route says why and makes no backend call", async () => {
  const mock = harness({ roles: { status: "ok", roles: [adminRow], source: "mock" } });
  for (const [method, path, body] of [
    ["GET", "admin/identifier"],
    ["PATCH", "admin/identifier/ai-a11", { version: 2 }],
    ["POST", "admin/identifier/ai-a11/retire", { version: 2 }],
    ["POST", "admin/identifier/ai-a11/restore", { version: 2 }],
    ["PUT", "admin/identifier/ai-a11/media", { mediaId: null, expectedVersion: 2 }],
  ]) {
    const res = await mock.call(method, path, body);
    assert.deepEqual([res.status, res.body.code], [404, "IDENTIFIER_UNAVAILABLE"], `${method} ${path}`);
  }
  assert.equal(mock.calls.length, 0);
  // Roles that cannot be read fail closed in the router, before any backend call.
  const unread = harness({ roles: { status: "unavailable" } });
  const res = await unread.call("GET", "admin/identifier");
  assert.deepEqual([res.status, res.body.code], [503, "ROLES_UNAVAILABLE"]);
  const member = harness({ roles: { status: "ok", roles: [{ ...adminRow, role: "player" }] } });
  assert.equal((await member.call("PATCH", "admin/identifier/ai-a11", { version: 2 })).status, 403);
  assert.equal(unread.calls.length + member.calls.length, 0);
});

test("the list is read from the content module and checked", async () => {
  const { call, calls } = harness({ reply: () => ({ items: [item(), item({ id: "ai-a11-2", data: { ...item().data, sourceFile: "ai-a11-2.jpg" } })] }) });
  const res = await call("GET", "admin/identifier");
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 2);
  assert.deepEqual(calls, [{ method: "GET", path: `${base}/items`, body: undefined }]);
  // A Military-shaped payload (with a photographer) is off this module's contract.
  const off = harness({ reply: () => ({ items: [item({ data: { ...item().data, photographer: "x" } })] }) });
  assert.deepEqual((await off.call("GET", "admin/identifier")).body.code, "BACKEND_CONTRACT");
});

test("edit, retire, restore and the photo link go to the item's backend routes as sent", async () => {
  const { call, calls } = harness({ reply: () => change() });
  const edit = { version: 2, rank: "chief-pilot", data: item().data };
  assert.equal((await call("PATCH", "admin/identifier/ai-a11", edit)).status, 200);
  assert.equal((await call("POST", "admin/identifier/ai-a11/retire", { version: 3 })).status, 200);
  assert.equal((await call("POST", "admin/identifier/ai-a11-2/restore", { version: 4 })).status, 200);
  assert.equal((await call("PUT", "admin/identifier/ai-a11/media", { mediaId: "med-9", expectedVersion: 5 })).status, 200);
  assert.deepEqual(calls, [
    { method: "PATCH", path: `${base}/items/ai-a11`, body: edit },
    { method: "POST", path: `${base}/items/ai-a11/retire`, body: { version: 3 } },
    { method: "POST", path: `${base}/items/ai-a11-2/restore`, body: { version: 4 } },
    { method: "PUT", path: `${base}/items/ai-a11/media`, body: { mediaId: "med-9", expectedVersion: 5 } },
  ]);
});

test("a malformed write or an id that is not the module's never leaves", async () => {
  const { call, calls } = harness();
  for (const [method, path, body] of [
    ["PATCH", "admin/identifier/ai-a11", { version: 2, data: { ...item().data, hint: "x" } }],
    ["PATCH", "admin/identifier/ai-a11", { version: 2, rank: "pilot" }],
    ["PATCH", "admin/identifier/ai-a11", { rank: "captain" }],
    // The edit replaces the whole payload: a missing key or a short answer list never reaches the backend.
    ["PATCH", "admin/identifier/ai-a11", { version: 2, data: { answer: "A", wrong: ["B", "C", "D"] } }],
    ["PATCH", "admin/identifier/ai-a11", { version: 2, data: { answer: "A", wrong: ["B", "C"], sourceFile: "ai-a11.jpg" } }],
    ["POST", "admin/identifier/ai-a11/retire", { version: 0 }],
    ["PUT", "admin/identifier/ai-a11/media", { mediaId: "photo-9", expectedVersion: 2 }],
    ["PUT", "admin/identifier/ai-a11/media", { mediaId: "med-9", version: 2 }],
  ])
    assert.equal((await call(method, path, body)).status, 400, JSON.stringify(body));
  for (const id of ["mil-a1", "ai-a0", "ai-a11-1", "..%2F"])
    assert.equal((await call("PATCH", `admin/identifier/${id}`, { version: 2 })).status, 404, id);
  assert.equal(calls.length, 0);
});

test("refusals: an edit's reasons come from the backend message; a lock is a retry; a conflict is a conflict", async () => {
  const cases = [
    ["PATCH", "admin/identifier/ai-a11", { version: 2 }, new BackendError(422, "import_invalid", undefined, [], "The item is not valid: Wrong Answer 2 is missing. Nothing was changed."), 422, "CONTENT_INVALID"],
    ["PUT", "admin/identifier/ai-a11/media", { mediaId: "med-9", expectedVersion: 2 }, new BackendError(422, "media_invalid"), 422, "MEDIA_INVALID"],
    ["POST", "admin/identifier/ai-a11/retire", { version: 2 }, new BackendError(409, "version_conflict"), 409, "VERSION_CONFLICT"],
    ["POST", "admin/identifier/ai-a11/retire", { version: 2 }, new BackendError(409, "import_in_progress", 3), 503, "BUSY"],
    ["POST", "admin/identifier/ai-a11/retire", { version: 2 }, new BackendError(422, "import_invalid"), 502, "BACKEND_CONTRACT"],
    ["GET", "admin/identifier", undefined, new BackendError(404, "not_found"), 404, "NOT_FOUND"],
  ];
  for (const [method, path, body, error, status, code] of cases) {
    const { call } = harness({
      reply: () => {
        throw error;
      },
    });
    const res = await call(method, path, body);
    assert.deepEqual([res.status, res.body.code], [status, code], `${method} ${path} ${error.code}`);
    if (code === "CONTENT_INVALID") assert.deepEqual(res.body.errors, [error.detail]);
    if (code === "BUSY") assert.equal(res.headers.get("Retry-After"), "3");
    if (method === "GET") assert.match(res.body.error, /does not offer the Aircraft Identifier content/);
  }
});

test("BackendError keeps the backend's own message, trimmed and bounded", async () => {
  const client = (message) =>
    backendClient(
      {
        baseUrl: "http://backend.test",
        fetch: async () => Response.json({ error: { code: "import_invalid", message, requestId: "r" } }, { status: 422 }),
      },
      { reveal: () => "token" },
    );
  await assert.rejects(client("  The item is not valid.  ").getJson("/x"), (error) => error.detail === "The item is not valid.");
  await assert.rejects(client("x".repeat(1500)).getJson("/x"), (error) => error.detail.length === 1000 && error.detail.endsWith("…"));
  await assert.rejects(client(7).getJson("/x"), (error) => error.detail === "");
});

// ===== The desk's browser rules =====

test("payload pre-checks are the backend's rules in its words", () => {
  assert.deepEqual(payloadErrors({ answer: "Boeing 737", wrong: ["A320", "A321", "E190"] }), []);
  assert.deepEqual(payloadErrors({ answer: " ", wrong: ["A320", "", "E190"] }), ["Correct Answer is missing.", "Wrong Answer 2 is missing."]);
  assert.deepEqual(payloadErrors({ answer: "Boeing  737", wrong: ["boeing 737", "A321", "E190"] }), [
    "The correct and wrong answers must all be different.",
  ]);
});

test("questions on the same client photo are partners; one backend photo on two client photos is flagged", () => {
  const items = [
    item({ id: "ai-a11", mediaId: "med-1" }),
    item({ id: "ai-a11-2", mediaId: "med-1" }),
    item({ id: "ai-a12", mediaId: "med-1" }),
    item({ id: "ai-a13", mediaId: "med-2" }),
    item({ id: "ai-a14", mediaId: "med-2", status: "retired" }),
  ];
  assert.equal(photoNumber("ai-a11-2"), "11");
  assert.deepEqual(photoPartners(items, "ai-a11").map((i) => i.id), ["ai-a11-2"]);
  assert.deepEqual(photoPartners(items, "ai-a12"), []);
  const misused = misusedPhotos(items);
  assert.deepEqual([...misused.keys()], ["med-1"], "a pair sharing med-1 is fine; ai-a12 also using it is not; retired items don't count");
  assert.deepEqual(misused.get("med-1"), ["ai-a11", "ai-a11-2", "ai-a12"]);
});

test("ids sort in the backend's natural order", () => {
  assert.deepEqual(["ai-a10", "ai-a11-2", "ai-a2", "ai-a11"].sort(compareIdentifierIds), ["ai-a2", "ai-a10", "ai-a11", "ai-a11-2"]);
});
