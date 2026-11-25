// The Plane of the Day desk on the game backend (A3.3): contract checks of the parsers, the routes' gate, what they send,
// how a refusal comes back, and the desk's browser rules. The backend is a fake that records each call.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BackendError } from "../lib/request/backend.ts";
import * as potd from "../lib/request/potd.ts";
import { potdRoutes } from "../lib/request/potd-routes.ts";
import { resolvePrincipal } from "../lib/request/principal.ts";
import { dispatch } from "../lib/request/router.ts";
import { routes } from "../lib/request/routes.ts";
import { comparePotd, formOf, isDirty, photosInUse, potdErrors, saveBody, storedLength } from "../lib/potd-desk.ts";

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

test("the Plane of the Day parsers list the contract's keys and values", () => {
  assert.deepEqual(list(block("EditorialItem"), "required"), keys(potd.potdItemSchema));
  assert.deepEqual(list(block("EditorialData"), "required"), keys(potd.potdDataSchema));
  assert.deepEqual(list(block("EditorialItemList"), "required"), keys(potd.potdItemListSchema));
  assert.deepEqual(list(block("EditorialCreated"), "required"), keys(potd.potdCreatedSchema));
  assert.deepEqual(list(block("EditorialChange"), "required"), keys(potd.potdChangeSchema));
  assert.deepEqual(properties(block("EditorialCreateRequest")), keys(potd.potdCreateRequestSchema));
  assert.deepEqual(properties(block("EditorialSaveRequest")), keys(potd.potdSaveRequestSchema));
  assert.deepEqual(keys(potd.potdDataRequestSchema), keys(potd.potdDataSchema), "a request carries the same data keys");
  assert.deepEqual(list(block("EditorialStatus"), "enum", 6), [...potd.potdStatuses].sort());
  assert.ok(list(block("EditorialKind"), "enum", 6).includes(potd.potdBackendKind));
  assert.match(block("EditorialItem"), /pattern: "\^ed-\[1-9\]\[0-9\]\{0,14\}\$"/);
  assert.equal(potd.potdIdPattern.source, "^ed-[1-9][0-9]{0,14}$");
});

// ===== Routes =====

const data = (over = {}) => ({
  title: "",
  aircraft: "",
  photographer: "",
  instagram: "",
  credit: "",
  description: "",
  correctAnswer: "",
  distractors: ["", "", ""],
  difficulty: "",
  factualSource: "",
  ...over,
});
const item = (over = {}) => ({
  id: "ed-4",
  kind: "plane-of-the-day",
  mediaId: "med-7",
  status: "draft",
  dateKey: null,
  version: 1,
  data: data(),
  createdAt: "2026-11-19T10:00:00.000Z",
  updatedAt: "2026-11-19T10:00:00.000Z",
  ...over,
});
const base = "/v1/admin/editorial/plane-of-the-day";

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

const saveRequest = (over = {}) => ({ version: 1, status: "draft", data: data(), dateKey: null, ...over });

test("the Plane of the Day routes are staff routes, and every write is marked as a mutation", () => {
  assert.equal(potdRoutes.length, 3);
  for (const r of potdRoutes) {
    assert.equal(r.audience, "staff", r.path);
    assert.equal(!!r.mutation, r.method !== "GET", r.path);
  }
});

test("with mock roles every Plane of the Day route says why and makes no backend call", async () => {
  const mock = harness({ roles: { status: "ok", roles: [adminRow], source: "mock" } });
  for (const [method, path, body] of [
    ["GET", "admin/plane-of-the-day"],
    ["POST", "admin/plane-of-the-day", { mediaId: "med-7" }],
    ["PUT", "admin/plane-of-the-day/ed-4", saveRequest()],
  ]) {
    const res = await mock.call(method, path, body);
    assert.deepEqual([res.status, res.body.code], [404, "POTD_UNAVAILABLE"], `${method} ${path}`);
  }
  assert.equal(mock.calls.length, 0);
  const unread = harness({ roles: { status: "unavailable" } });
  const res = await unread.call("GET", "admin/plane-of-the-day");
  assert.deepEqual([res.status, res.body.code], [503, "ROLES_UNAVAILABLE"]);
  const member = harness({ roles: { status: "ok", roles: [{ ...adminRow, role: "photographer" }] } });
  assert.equal((await member.call("PUT", "admin/plane-of-the-day/ed-4", saveRequest())).status, 403);
  assert.equal(unread.calls.length + member.calls.length, 0);
});

test("the list is read from the editorial kind and checked, and the kind becomes the Admin's potd", async () => {
  const { call, calls } = harness({ reply: () => ({ items: [item(), item({ id: "ed-5", status: "scheduled", dateKey: "2026-12-01" })] }) });
  const res = await call("GET", "admin/plane-of-the-day");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((each) => [each.id, each.kind]), [["ed-4", "potd"], ["ed-5", "potd"]]);
  assert.deepEqual(calls, [{ method: "GET", path: `${base}/items`, body: undefined }]);
  for (const off of [
    item({ kind: "identifier" }),
    item({ imageUrl: "https://x.test/a.jpg" }),
    item({ data: { ...data(), hint: "x" } }),
    item({ dateKey: "1 Dec" }),
  ]) {
    const { call: offCall } = harness({ reply: () => ({ items: [off] }) });
    assert.equal((await offCall("GET", "admin/plane-of-the-day")).body.code, "BACKEND_CONTRACT", JSON.stringify(off));
  }
});

test("create and save go to the item routes as sent", async () => {
  const { call, calls } = harness({
    reply: (method) => (method === "POST" ? { item: item() } : { changed: true, item: item({ version: 2, status: "scheduled", dateKey: "2026-12-01" }) }),
  });
  const created = await call("POST", "admin/plane-of-the-day", { mediaId: "med-7" });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.kind, "potd");
  const body = saveRequest({ status: "scheduled", dateKey: "2026-12-01", data: data({ title: "Concorde" }) });
  const saved = await call("PUT", "admin/plane-of-the-day/ed-4", body);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.item.version, 2);
  assert.deepEqual(calls, [
    { method: "POST", path: `${base}/items`, body: { mediaId: "med-7" } },
    { method: "PUT", path: `${base}/items/ed-4`, body },
  ]);
});

test("a malformed write or an id that is not an editorial id never leaves", async () => {
  const { call, calls } = harness();
  for (const [method, path, body] of [
    ["POST", "admin/plane-of-the-day", {}],
    ["POST", "admin/plane-of-the-day", { mediaId: "photo-7" }],
    ["POST", "admin/plane-of-the-day", { mediaId: "med-7", imageUrl: "https://x.test/a.jpg" }],
    ["PUT", "admin/plane-of-the-day/ed-4", { status: "draft", data: data() }],
    ["PUT", "admin/plane-of-the-day/ed-4", saveRequest({ status: "live" })],
    ["PUT", "admin/plane-of-the-day/ed-4", saveRequest({ dateKey: "2026-1-1" })],
    ["PUT", "admin/plane-of-the-day/ed-4", saveRequest({ data: { title: "x" } })],
    ["PUT", "admin/plane-of-the-day/ed-4", saveRequest({ version: 0 })],
  ])
    assert.equal((await call(method, path, body)).status, 400, JSON.stringify(body));
  for (const id of ["ed-0", "ai-a1", "ed-4x", "..%2F"])
    assert.equal((await call("PUT", `admin/plane-of-the-day/${id}`, saveRequest())).status, 404, id);
  assert.equal(calls.length, 0);
});

test("refusals: the backend's reasons pass through; a conflict is a conflict; a 409 off a save is off the contract", async () => {
  const reasons = ["Add a title of at least 3 characters.", "The photo has no licence credit."];
  const cases = [
    ["PUT", "admin/plane-of-the-day/ed-4", saveRequest(), new BackendError(422, "content_invalid", undefined, reasons), 422, "CONTENT_INVALID"],
    ["POST", "admin/plane-of-the-day", { mediaId: "med-7" }, new BackendError(422, "content_invalid", undefined, ["The photo is not published."]), 422, "CONTENT_INVALID"],
    ["PUT", "admin/plane-of-the-day/ed-4", saveRequest(), new BackendError(409, "version_conflict"), 409, "VERSION_CONFLICT"],
    ["POST", "admin/plane-of-the-day", { mediaId: "med-7" }, new BackendError(409, "version_conflict"), 502, "BACKEND_CONTRACT"],
    ["PUT", "admin/plane-of-the-day/ed-4", saveRequest(), new BackendError(404, "not_found"), 404, "NOT_FOUND"],
    ["GET", "admin/plane-of-the-day", undefined, new BackendError(404, "not_found"), 404, "NOT_FOUND"],
    ["GET", "admin/plane-of-the-day", undefined, new BackendError(429, "rate_limited", 4), 429, "RATE_LIMITED"],
    ["GET", "admin/plane-of-the-day", undefined, new BackendError(500, "internal"), 503, "BACKEND_UNAVAILABLE"],
    // The list takes no input: the contract gives it no 400 or 413, so either is off the contract on a read.
    ["GET", "admin/plane-of-the-day", undefined, new BackendError(400, "invalid_request"), 502, "BACKEND_CONTRACT"],
    ["GET", "admin/plane-of-the-day", undefined, new BackendError(413, "invalid_request"), 502, "BACKEND_CONTRACT"],
    ["PUT", "admin/plane-of-the-day/ed-4", saveRequest(), new BackendError(400, "invalid_request"), 400, "INVALID_REQUEST"],
    ["PUT", "admin/plane-of-the-day/ed-4", saveRequest(), new BackendError(413, "invalid_request"), 413, "TOO_LARGE"],
  ];
  for (const [method, path, body, error, status, code] of cases) {
    const { call } = harness({
      reply: () => {
        throw error;
      },
    });
    const res = await call(method, path, body);
    assert.deepEqual([res.status, res.body.code], [status, code], `${method} ${path} ${error.code}`);
    if (code === "CONTENT_INVALID") assert.deepEqual(res.body.errors, error.errors);
    if (code === "RATE_LIMITED") assert.equal(res.headers.get("Retry-After"), "4");
    if (method === "GET" && code === "NOT_FOUND") assert.match(res.body.error, /does not offer the Plane of the Day desk/);
  }
});

test("an over-long text goes to the backend, whose 422 names the field; more than 20 distractors stays a 400", async () => {
  const long = saveRequest({ data: data({ description: "a".repeat(2500) }) });
  const reasons = ["data.description must be at most 2400 characters"];
  const { call, calls } = harness({
    reply: () => {
      throw new BackendError(422, "content_invalid", undefined, reasons);
    },
  });
  const res = await call("PUT", "admin/plane-of-the-day/ed-4", long);
  assert.deepEqual([res.status, res.body.code, res.body.errors], [422, "CONTENT_INVALID", reasons]);
  assert.equal(calls.length, 1, "the save reached the backend");
  const many = saveRequest({ data: data({ distractors: Array(21).fill("x") }) });
  assert.equal((await call("PUT", "admin/plane-of-the-day/ed-4", many)).status, 400);
  assert.equal(calls.length, 1);
});

// ===== The desk's browser rules =====

const live = (over = {}) =>
  formOf(
    item({
      status: "scheduled",
      dateKey: "2026-12-01",
      data: data({ title: "Concorde", description: "The supersonic airliner at Heathrow.", factualSource: "https://example.org/concorde" }),
      ...over,
    }),
  );

test("a draft needs only a well-formed shape; scheduling needs the backend's fields", () => {
  assert.deepEqual(potdErrors(formOf(item())), []);
  assert.deepEqual(potdErrors(live()), []);
  assert.deepEqual(potdErrors({ ...formOf(item()), status: "published" }), [
    "Add a title of at least 3 characters.",
    "Add a description of at least 15 characters.",
    "Add a factual source that starts with https://.",
    "Choose the date it runs.",
  ]);
  const form = live();
  assert.deepEqual(potdErrors({ ...form, data: { ...form.data, instagram: "not a handle!" } }), [
    "Instagram must be empty, a handle such as @name, or an https link.",
  ]);
  for (const instagram of ["@spotter.one", "spotter_1", "https://instagram.com/x"])
    assert.deepEqual(potdErrors({ ...form, data: { ...form.data, instagram } }), [], instagram);
  assert.deepEqual(potdErrors({ ...form, data: { ...form.data, difficulty: "Captain" } }), ["Choose a rank for the difficulty, or none."]);
  assert.deepEqual(potdErrors({ ...form, dateKey: "2026-02-29" }), ["Use a real calendar date."]);
});

test("length is measured as the backend measures it: CRLF as one, trimmed, in code points", () => {
  assert.equal(storedLength("a\r\n".repeat(1200)), 2399);
  assert.equal(storedLength("\u{1D538}".repeat(2400)), 2400);
  const form = formOf(item());
  const withText = (over) => ({ ...form, data: { ...form.data, ...over } });
  assert.deepEqual(potdErrors(withText({ description: "a\r\n".repeat(1200) })), [], "3600 raw, 2399 stored");
  assert.deepEqual(potdErrors(withText({ title: "\u{1D538}".repeat(2400) })), [], "4800 UTF-16 units, 2400 code points");
  assert.deepEqual(potdErrors(withText({ title: "\u{1D538}".repeat(2401) })), ["Title is 2401 characters; the limit is 2400."]);
  assert.deepEqual(potdErrors(withText({ credit: `${"a".repeat(2400)}\n` })), [], "a trailing newline is trimmed");
  assert.deepEqual(potdErrors(withText({ distractors: ["", "b".repeat(2401), ""] })), ["Distractor 2 is 2401 characters; the limit is 2400."]);
  assert.deepEqual(potdErrors(withText({ credit: "c".repeat(2500) })), ["Staff credit note is 2500 characters; the limit is 2400."]);
});

test("the dev waiver allows only an EMPTY source; a given source must still be https", () => {
  const form = live();
  const empty = { ...form, data: { ...form.data, factualSource: "  " } };
  assert.deepEqual(potdErrors(empty, { devDemoWaiver: true }), []);
  assert.deepEqual(potdErrors(empty), ["Add a factual source that starts with https://."]);
  const http = { ...form, data: { ...form.data, factualSource: "http://example.org" } };
  assert.deepEqual(potdErrors(http, { devDemoWaiver: true }), ["Add a factual source that starts with https://."]);
});

test("the form always holds three distractors, saves null for no date, and knows when it changed", () => {
  const blank = item({ data: data({ distractors: [] }) });
  assert.deepEqual(formOf(blank).data.distractors, ["", "", ""]);
  assert.deepEqual(saveBody(formOf(item())), { status: "draft", data: data(), dateKey: null });
  assert.equal(isDirty(item(), formOf(item())), false);
  const form = formOf(item());
  assert.equal(isDirty(item(), { ...form, dateKey: "2026-12-01" }), true);
  assert.equal(isDirty(item(), { ...form, data: { ...form.data, title: "Concorde" } }), true);
});

test("live items list by date first, then the rest by last update; archived photos are free again", () => {
  const items = [
    item({ id: "ed-1", updatedAt: "2026-11-19T09:00:00.000Z" }),
    item({ id: "ed-2", status: "published", dateKey: "2026-12-03" }),
    item({ id: "ed-3", status: "scheduled", dateKey: "2026-12-01", mediaId: "med-8" }),
    item({ id: "ed-4", updatedAt: "2026-11-20T09:00:00.000Z", status: "archived", mediaId: "med-9" }),
  ];
  assert.deepEqual([...items].sort(comparePotd).map((each) => each.id), ["ed-3", "ed-2", "ed-4", "ed-1"]);
  assert.deepEqual([...photosInUse(items)].sort(), ["med-7", "med-8"]);
});
