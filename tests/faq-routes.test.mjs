// The FAQ desk on the game backend (API 0.33.0): contract checks of the parsers, the routes' gate, what they send, how
// a refusal comes back, and the browser source. The backend is a fake that records each call.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BackendError } from "../lib/request/backend.ts";
import * as faq from "../lib/request/faq.ts";
import { faqRoutes } from "../lib/request/faq-routes.ts";
import { resolvePrincipal } from "../lib/request/principal.ts";
import { dispatch } from "../lib/request/router.ts";
import { routes } from "../lib/request/routes.ts";
import { createFaqSource, faqStateOf, readFaqExport } from "../lib/faq-source.ts";

// ===== Contract =====

const yaml = await readFile(new URL("../contracts/openapi.yaml", import.meta.url), "utf8");
const block = (name) => {
  const start = yaml.indexOf(`\n    ${name}:\n`);
  assert.ok(start >= 0, `${name} is in the contract`);
  const rest = yaml.slice(start + name.length + 7);
  const end = rest.search(/\n {4}[A-Za-z]/);
  return end < 0 ? rest : rest.slice(0, end);
};
const required = (name) => {
  const found = block(name).match(/\n {6}required: \[([^\]]*)\]/);
  assert.ok(found, `${name} required`);
  return found[1].split(",").map((s) => s.trim()).sort();
};
const keys = (schema) => Object.keys(schema.shape).sort();

test("the FAQ parsers list the contract's keys", () => {
  assert.match(yaml, /\n  version: 0\.33\.0\n/);
  assert.deepEqual(required("FaqDocument"), keys(faq.faqDocumentSchema));
  assert.deepEqual(required("FaqCategory"), keys(faq.faqCategorySchema));
  assert.deepEqual(required("FaqEntry"), keys(faq.faqEntrySchema));
  assert.deepEqual(required("FaqExport"), keys(faq.faqExportSchema));
  assert.deepEqual(required("FaqEditRequest"), keys(faq.faqEditRequestSchema));
  assert.deepEqual(required("FaqImportRequest"), keys(faq.faqImportRequestSchema));
  assert.deepEqual(required("ContentDraftDetail"), keys(faq.faqDraftDetailSchema));
  assert.deepEqual(required("ContentDraft"), keys(faq.faqDraftSchema));
  assert.deepEqual(required("ContentPublishResult"), keys(faq.faqPublishResultSchema));
  for (const op of ["FaqUpsertCategory", "FaqRemoveCategory", "FaqMoveCategory", "FaqUpsertEntry", "FaqRemoveEntry", "FaqMoveEntry"]) {
    const name = op.slice(3, 4).toLowerCase() + op.slice(4);
    const schema = faq.faqOperationSchema.options.find((option) => option.shape.op.value === name);
    assert.ok(schema, op);
    assert.deepEqual(required(op), keys(schema), op);
  }
  assert.match(block("StoredDocumentName"), /enum: \[field-awards, clipper-cards, aircraft-tags, faq\]/);
});

// ===== Routes =====

const doc = (categories = [], version = 0) => ({ format: "faq.v1", version, categories });
const cat = { id: "account", title: "Account", entries: [{ id: "sign-in", question: "How do I sign in?", answer: "Use email." }] };
const detail = (over = {}) => ({
  name: "faq",
  publishedVersion: null,
  draftVersion: 3,
  changed: true,
  edits: { faq: {}, history: [] },
  changeCount: 1,
  changes: [{ kind: "category-added", key: "account" }],
  body: doc([cat], 1),
  ...over,
});
const draft = (over = {}) => {
  const value = detail(over);
  delete value.body;
  return value;
};
const exported = (over = {}) => ({
  kind: "faq-export",
  format: "faq.v1",
  sourceHost: "dev.api.example",
  sourceVersion: 2,
  publishedAt: "2026-11-26T10:00:00.000Z",
  sha256: "a".repeat(64),
  categories: [cat],
  ...over,
});
const base = "/v1/admin/content/documents/faq";

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
  async function call(method, path, body, raw) {
    const headers = { origin, cookie: "aa_session=staff" };
    if (body !== undefined || raw !== undefined) headers["Content-Type"] = "application/json";
    const response = await handle(
      new Request(`${origin}/api/${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }),
      path.split("/"),
    );
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  return { call, calls };
}

/** A backend with a published FAQ: the draft detail, the export, and a write that answers `ContentDraft`. */
const published = (method, path) => {
  if (path === `${base}/draft` && method === "GET") return detail({ publishedVersion: 2 });
  if (path === `${base}/export`) return exported();
  if (path === `${base}/publish`)
    return { name: "faq", version: 3, previousVersion: 2, sha256: "b".repeat(64), byteSize: 10, draftVersion: 4, changeCount: 1, manifestVersion: "m" };
  return draft({ publishedVersion: 2, draftVersion: 4 });
};

test("the FAQ routes are staff routes, every write is a mutation, and mock roles never reach the backend", async () => {
  assert.equal(faqRoutes.length, 6);
  for (const r of faqRoutes) {
    assert.equal(r.audience, "staff", r.path);
    assert.equal(!!r.mutation, r.method !== "GET", r.path);
  }
  const mock = harness({ roles: { status: "ok", roles: [adminRow], source: "mock" } });
  for (const [method, path, body] of [
    ["GET", "admin/faq"],
    ["PATCH", "admin/faq", { draftVersion: 1, operations: [{ op: "removeEntry", id: "x" }] }],
    ["POST", "admin/faq/publish", { draftVersion: 1 }],
    ["GET", "admin/faq/export"],
    ["POST", "admin/faq/import", { draftVersion: 1, file: exported() }],
  ]) {
    const res = await mock.call(method, path, body);
    assert.deepEqual([res.status, res.body.code], [404, "FAQ_UNAVAILABLE"], `${method} ${path}`);
  }
  const member = harness({ roles: { status: "ok", roles: [{ ...adminRow, role: "photographer" }] } });
  assert.equal((await member.call("GET", "admin/faq")).status, 403);
  assert.equal(mock.calls.length + member.calls.length, 0);
});

test("the read gives the draft body and, once published, what is live through export", async () => {
  const first = harness({ reply: () => detail() });
  const before = await first.call("GET", "admin/faq");
  assert.equal(before.status, 200);
  assert.deepEqual(before.body, {
    draft: { categories: [cat] },
    draftVersion: 3,
    publishedVersion: null,
    changed: true,
    live: null,
    liveVersion: null,
    livePublishedAt: null,
  });
  assert.deepEqual(first.calls.map((c) => c.path), [`${base}/draft`], "no export before the first publish");
  const later = harness({ reply: published });
  const after = await later.call("GET", "admin/faq");
  assert.deepEqual([after.body.live, after.body.liveVersion, after.body.livePublishedAt], [{ categories: [cat] }, 2, "2026-11-26T10:00:00.000Z"]);
  assert.equal((await harness({ reply: () => ({ ...detail(), extra: 1 }) }).call("GET", "admin/faq")).status, 502, "strict");
  assert.equal((await harness({ reply: () => detail({ name: "field-awards" }) }).call("GET", "admin/faq")).status, 502);
});

test("a change is one checked operation with the draft version, followed by a fresh read", async () => {
  const { call, calls } = harness({ reply: published });
  const op = { op: "upsertEntry", categoryId: "account", id: "sign-in", question: "How do I sign in?", answer: "Line one.\r\n\r\nLine two." };
  const res = await call("PATCH", "admin/faq", { draftVersion: 3, operations: [op] });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((c) => [c.method, c.path]), [
    ["PATCH", `${base}/draft`],
    ["GET", `${base}/draft`],
    ["GET", `${base}/export`],
  ]);
  assert.deepEqual(calls[0].body, { draftVersion: 3, operations: [op] }, "sent as typed; the backend normalises");
  for (const bad of [
    { draftVersion: 3, operations: [] },
    { draftVersion: 3, operations: [{ ...op, question: "two\nlines" }] },
    { draftVersion: 3, operations: [{ ...op, answer: "a‮b" }] },
    { draftVersion: 3, operations: [{ op: "moveCategory", id: "account", to: 0 }] },
    { draftVersion: 3, operations: [{ op: "removeEntry", id: "Sign In" }] },
    { draftVersion: -1, operations: [{ op: "removeEntry", id: "x" }] },
    { draftVersion: 3, operations: [{ op: "removeEntry", id: "x" }], extra: 1 },
  ]) {
    const refused = await harness({ reply: published }).call("PATCH", "admin/faq", bad);
    assert.deepEqual([refused.status, refused.body.code], [400, "INVALID_REQUEST"], JSON.stringify(bad));
  }
});

test("refusals: conflict, nothing to publish, the backend's reason, too large", async () => {
  const fail = (status, code, errors, detail) =>
    harness({
      reply: () => {
        throw new BackendError(status, code, undefined, errors, detail);
      },
    });
  const patch = { draftVersion: 3, operations: [{ op: "removeCategory", id: "account" }] };
  let res = await fail(409, "version_conflict").call("PATCH", "admin/faq", patch);
  assert.deepEqual([res.status, res.body.code], [409, "VERSION_CONFLICT"]);
  res = await fail(409, "nothing_to_publish").call("POST", "admin/faq/publish", { draftVersion: 3 });
  assert.deepEqual([res.status, res.body.code], [422, "NOTHING_TO_PUBLISH"], "a refusal, not another editor's conflict");
  res = await fail(422, "content_invalid", [], "operations[0]: the category still has entries").call("PATCH", "admin/faq", patch);
  assert.deepEqual([res.status, res.body.code, res.body.errors], [422, "CONTENT_INVALID", ["operations[0]: the category still has entries"]]);
  res = await fail(404, "not_found").call("GET", "admin/faq/export");
  assert.deepEqual([res.status, res.body.code], [404, "NOT_FOUND"]);
  res = await fail(401, "unauthorized").call("GET", "admin/faq");
  assert.equal(res.status, 401);
  const big = harness({ reply: published });
  res = await big.call("PATCH", "admin/faq", undefined, JSON.stringify({ draftVersion: 3, operations: [], pad: "x".repeat(17000) }));
  assert.deepEqual([res.status, res.body.code], [413, "TOO_LARGE"]);
  assert.equal(big.calls.length, 0);
});

test("discard, publish, export and import call their backend routes; import takes a large file", async () => {
  const { call, calls } = harness({ reply: published });
  assert.equal((await call("POST", "admin/faq/discard", { draftVersion: 3 })).status, 200);
  assert.equal((await call("POST", "admin/faq/publish", { draftVersion: 4, note: "Client copy" })).status, 200);
  const file = await call("GET", "admin/faq/export");
  assert.deepEqual(file.body, exported());
  const many = exported({ categories: Array.from({ length: 30 }, (_, i) => ({ id: `c-${i}`, title: "T", entries: [] })) });
  const imported = await call("POST", "admin/faq/import", { draftVersion: 4, file: { ...many, pad: "x".repeat(40000) } });
  assert.equal(imported.status, 200, "more than 16 KB passes on the import route; the backend checks the file");
  const writes = calls.filter((c) => c.method !== "GET");
  assert.deepEqual(writes.map((c) => c.path), [`${base}/draft/discard`, `${base}/publish`, `${base}/import`]);
  assert.deepEqual(writes[1].body, { draftVersion: 4, note: "Client copy" });
  assert.equal(writes[2].body.file.pad.length, 40000, "the file is passed on as read");
  assert.equal((await call("POST", "admin/faq/import", { draftVersion: 4, file: "nope" })).status, 400);
  assert.equal((await call("POST", "admin/faq/publish", { draftVersion: 4, acknowledgeCardRemoval: true })).status, 400);
});

// ===== Browser source =====

test("the source sends one operation per action and maps the draft session's outcomes", async () => {
  const sent = [];
  const state = { draft: { categories: [cat] }, draftVersion: 4, live: null, liveVersion: null, livePublishedAt: null, changed: true };
  const outcomes = [{ kind: "ok", body: state }, { kind: "conflict", message: "x" }, { kind: "blocked", status: 401 }, { kind: "stale" }, { kind: "inactive", message: "gone" }];
  const source = createFaqSource(async (method, url, payload) => {
    sent.push([method, url, payload]);
    return outcomes.shift();
  });
  const ok = await source.change({ op: "removeEntry", id: "sign-in" }, 3);
  assert.equal(ok.kind, "ok");
  assert.equal(ok.value.draftVersion, 4);
  assert.deepEqual(sent[0], ["PATCH", "/api/admin/faq", { draftVersion: 3, operations: [{ op: "removeEntry", id: "sign-in" }] }]);
  assert.equal((await source.publish(4)).kind, "conflict");
  assert.deepEqual(await source.discard(4), { kind: "blocked", status: 401 });
  assert.equal((await source.load()).kind, "stale");
  assert.deepEqual(await source.load(), { kind: "inactive", message: "gone" });
  assert.equal(faqStateOf({ draft: "x" }), null);
  const text = JSON.stringify(exported());
  assert.deepEqual(readFaqExport(text)?.doc, { categories: [cat] });
  assert.equal(readFaqExport("{"), null);
  assert.equal(readFaqExport(JSON.stringify({ ...exported(), kind: "other" })), null);
  const refused = await createFaqSource(async () => assert.fail("nothing is sent")).importFromDev("not json", 4);
  assert.equal(refused.kind, "refused");
});

test("a write that was done stays done when the read after it fails, and the source reads again", async () => {
  let reads = 0;
  const { call } = harness({
    reply: (method, path) => {
      if (method === "POST" && path === `${base}/publish`) return published(method, path);
      reads += 1;
      throw new BackendError(429, "rate_limited", 5);
    },
  });
  const res = await call("POST", "admin/faq/publish", { draftVersion: 3 });
  assert.deepEqual([res.status, res.body], [200, { saved: true }]);
  assert.ok(reads >= 1);
  const outcomes = [{ kind: "ok", body: { saved: true } }, { kind: "refused", status: 429, message: "busy", errors: [] }];
  const source = createFaqSource(async () => outcomes.shift());
  const after = await source.publish(3);
  assert.equal(after.kind, "refused");
  assert.match(after.message, /^Saved\./);
  const positions = [
    { op: "moveCategory", id: "a", position: 30 },
    { op: "moveEntry", id: "a", categoryId: "b", position: 300 },
  ];
  for (const op of positions)
    assert.equal(faq.faqEditRequestSchema.safeParse({ draftVersion: 1, operations: [op] }).success, false, op.op);
});
