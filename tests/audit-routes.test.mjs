// The Activity desk on the game backend (A3.4): contract checks of the parser, the route's gate, what it sends, how a
// refusal comes back, and the desk's browser rules. The backend is a fake that records each call.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BackendError, BackendNotConnected } from "../lib/request/backend.ts";
import * as audit from "../lib/request/audit.ts";
import { auditRoutes } from "../lib/request/audit-routes.ts";
import { resolvePrincipal } from "../lib/request/principal.ts";
import { dispatch } from "../lib/request/router.ts";
import { routes } from "../lib/request/routes.ts";
import { actionText, actorKind, detailText, eventWaivers } from "../lib/audit-desk.ts";
import { sectionView, sourceStates, sourceUrl, sourcesFor, workspaceSources } from "../lib/workspace-load.ts";

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

test("the audit parser lists the contract's keys, actions and limits", () => {
  const event = block("AuditEvent");
  const events = block("AuditEventList");
  assert.deepEqual(list(event, "required"), keys(audit.auditEventSchema));
  assert.deepEqual(properties(event), keys(audit.auditEventSchema));
  assert.match(event, /additionalProperties: false/);
  assert.deepEqual(list(events, "required"), keys(audit.auditEventListSchema));
  assert.deepEqual(list(event, "enum", 10), [...audit.auditActions].sort(), "every audit action, none extra");
  assert.equal(new Set(audit.auditActions).size, audit.auditActions.length);
  assert.match(events, /maxItems: 50\n/);
  assert.ok(event.includes(`pattern: "${audit.auditEventIdPattern.source}"`), "the id pattern is the contract's");
  // `detail` is an open object in the contract: the parser keeps every key the backend sends.
  assert.match(event, /detail:\n {10}type: object\n {10}additionalProperties: true/);
});

test("the audit read takes no query, and the waiver flags are where the contract says", () => {
  const start = yaml.indexOf("\n  /v1/admin/audit:\n");
  assert.ok(start >= 0);
  const operation = yaml.slice(start, yaml.indexOf("\n  /v1/", start + 5));
  assert.doesNotMatch(operation, /\n {6}parameters:/, "the operation declares no parameters");
  assert.match(operation, /No query parameters: any key is 400/);
  assert.match(operation, /`actor` is a principal, never an email or a name/);
  // 0.27.1: the dev waiver is recorded in the audit details, never in a response. `creditWaived` (the demo seed's
  // `media_import` rows) is a Backend detail key the contract does not name; the desk shows it the same way.
  assert.match(yaml, /`media_publish\.licenceWaived`, `editorial_save\.factualSourceWaived`/);
});

// ===== Routes =====

const project = "demo-airplane-games";
const origin = "http://site.test";
const adminRow = { role: "admin", state: "active", revision: 1, requestedAt: "2026-11-01T00:00:00.000Z", decidedAt: "2026-11-02T00:00:00.000Z" };
const event = (over = {}) => ({
  id: "aud-42",
  entity: "med-7",
  action: "media_publish",
  actor: `firebase:${project}:editor`,
  detail: { version: 2, licenceWaived: "dev-demo" },
  createdAt: "2026-11-19T10:00:00.000Z",
  ...over,
});
const events = () => [
  event(),
  event({ id: "aud-41", entity: "plane-of-the-day", action: "editorial_save", detail: { id: "ed-3", changes: ["status"], factualSourceWaived: "dev-demo" } }),
  event({ id: "aud-40", entity: "media", action: "media_import", actor: "operator:josh", detail: { fileName: "pod.csv", creditWaived: "dev-demo", rightsEvidenceLength: 0 } }),
  event({ id: "aud-1", entity: `firebase:${project}:new`, action: "role_request", actor: "system:signup", detail: {} }),
];

function harness({ reply = () => ({ events: events() }), roles = { status: "ok", roles: [adminRow] } } = {}) {
  const calls = [];
  const handle = dispatch(routes, {
    principal: (request) =>
      resolvePrincipal(request.headers, {
        verifier: {
          verify: async () => ({
            userId: `firebase:${project}:editor`,
            email: "editor@example.com",
            fullName: "Ed Editor",
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
  async function call(method, path, query = "") {
    const response = await handle(
      new Request(`${origin}/api/${path}${query}`, { method, headers: { origin, cookie: "aa_session=staff" } }),
      path.split("/"),
    );
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  }
  return { call, calls };
}

test("the audit route is one staff read that replaces the D1 one", () => {
  assert.equal(auditRoutes.length, 1);
  assert.deepEqual([auditRoutes[0].method, auditRoutes[0].path, auditRoutes[0].audience, !!auditRoutes[0].mutation], ["GET", "admin/audit", "staff", false]);
  const table = routes.filter((r) => r.path === "admin/audit");
  assert.equal(table.length, 1, "the D1 audit route is gone");
  assert.equal(table[0], auditRoutes[0]);
  assert.equal(sourceUrl.audit, "/api/admin/audit");
});

test("with mock roles the audit route says why and makes no backend call; others never reach the backend", async () => {
  const mock = harness({ roles: { status: "ok", roles: [adminRow], source: "mock" } });
  const res = await mock.call("GET", "admin/audit");
  assert.deepEqual([res.status, res.body.code], [404, "AUDIT_UNAVAILABLE"]);
  assert.match(res.body.error, /mock roles/);
  const unread = harness({ roles: { status: "unavailable" } });
  assert.equal((await unread.call("GET", "admin/audit")).status, 503);
  const member = harness({ roles: { status: "ok", roles: [{ ...adminRow, role: "photographer" }] } });
  assert.equal((await member.call("GET", "admin/audit")).status, 403, "a photographer is not an admin");
  assert.equal(mock.calls.length + unread.calls.length + member.calls.length, 0);
});

test("the events are read with no query and passed on as the backend gave them", async () => {
  const { call, calls } = harness();
  const res = await call("GET", "admin/audit", "?limit=500&actor=editor%40example.com");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { events: events() }, "unchanged: actors as principals, detail and waiver flags as given");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(calls, [{ method: "GET", path: "/v1/admin/audit", body: undefined }], "the browser's query never leaves");
  // The signed-in editor's email and name are known to the route, and still never appear in what it returns.
  assert.doesNotMatch(JSON.stringify(res.body), /editor@example\.com|Ed Editor/);
  // An empty log and a full one are both on the contract.
  assert.equal((await harness({ reply: () => ({ events: [] }) }).call("GET", "admin/audit")).status, 200);
  const fifty = Array.from({ length: 50 }, (_, i) => event({ id: `aud-${50 - i}` }));
  assert.equal((await harness({ reply: () => ({ events: fifty }) }).call("GET", "admin/audit")).body.events.length, 50);
});

test("an answer off the contract is refused whole", async () => {
  const off = [
    { events: [event({ action: "Media_Publish" })] },
    { events: [event({ action: "a".repeat(65) })] },
    { events: [event({ action: "2fa_reset" })] },
    { events: [event({ action: "" })] },
    { events: [event({ id: "aud-0" })] },
    { events: [event({ id: "42" })] },
    { events: [event({ email: "editor@example.com" })] },
    { events: [event({ detail: ["x"] })] },
    { events: [event({ detail: "x" })] },
    { events: [event({ detail: null })] },
    { events: [event({ actor: 7 })] },
    { events: [event({ createdAt: "yesterday" })] },
    { events: [{ ...event(), actor: undefined }] },
    { events: Array.from({ length: 51 }, (_, i) => event({ id: `aud-${i + 1}` })) },
    { events: [], next: "aud-1" },
    { items: [] },
    null,
  ];
  for (const body of off) {
    const res = await harness({ reply: () => body }).call("GET", "admin/audit");
    assert.deepEqual([res.status, res.body.code], [502, "BACKEND_CONTRACT"], JSON.stringify(body)?.slice(0, 80));
    assert.equal(res.body.events, undefined);
  }
});

test("an action the Admin does not know yet is listed, not a reason to refuse the whole log", async () => {
  // The contract's list is closed today, but the backend adds actions with new waves (0.24 and 0.25 both did).
  for (const action of ["future_thing", "release_v2", "military_approved"]) {
    const res = await harness({ reply: () => ({ events: [event(), event({ id: "aud-9", action })] }) }).call("GET", "admin/audit");
    assert.equal(res.status, 200, action);
    assert.equal(res.body.events.at(-1).action, action);
  }
  assert.equal(actionText("future_thing"), "future thing");
});

test("refusals: each backend failure says what it means", async () => {
  const cases = [
    [new BackendError(401, "unauthorized"), 401, "SIGNED_OUT"],
    [new BackendError(403, "forbidden"), 403, "FORBIDDEN"],
    [new BackendError(404, "not_found"), 404, "NOT_FOUND"],
    [new BackendError(429, "rate_limited", 2.2), 429, "RATE_LIMITED"],
    [new BackendError(400, "invalid_request"), 502, "BACKEND_CONTRACT"],
    [new BackendError(409, "version_conflict"), 502, "BACKEND_CONTRACT"],
    [new BackendError(503, "service_unavailable"), 503, "BACKEND_UNAVAILABLE"],
    [new BackendError(0, ""), 503, "BACKEND_UNAVAILABLE"],
    [new BackendNotConnected(), 503, "BACKEND_NOT_CONNECTED"],
  ];
  for (const [error, status, code] of cases) {
    const res = await harness({
      reply: () => {
        throw error;
      },
    }).call("GET", "admin/audit");
    assert.deepEqual([res.status, res.body.code], [status, code], `${error.status} ${error.code}`);
    if (code === "RATE_LIMITED") assert.equal(res.headers.get("Retry-After"), "3");
    if (code === "NOT_FOUND") assert.match(res.body.error, /API 0\.26\.0 or later/);
  }
});

// ===== The desk's browser rules =====

test("waiver flags come from the record, with its value, on whatever action carries them", () => {
  const [publish, save, imported, request] = events();
  assert.deepEqual(eventWaivers(publish), [{ key: "licenceWaived", label: "Licence waived", value: "dev-demo" }]);
  assert.deepEqual(eventWaivers(save), [{ key: "factualSourceWaived", label: "Source waived", value: "dev-demo" }]);
  assert.deepEqual(eventWaivers(imported), [{ key: "creditWaived", label: "Credit waived", value: "dev-demo" }]);
  assert.deepEqual(eventWaivers(request), []);
  // A value is shown exactly: not trimmed, not turned into yes/no, not inferred from a missing licence.
  assert.deepEqual(eventWaivers({ detail: { licenceWaived: " other ", creditWaived: true, factualSourceWaived: null } }).map((w) => w.value), [
    " other ",
    "null",
    "true",
  ]);
  assert.deepEqual(eventWaivers({ detail: { licenceName: null, changes: { licenceWaived: "dev-demo" } } }), [], "only the detail's own keys");
  assert.equal(detailText({ a: 1 }), '{"a":1}');
  assert.equal(detailText(undefined), "");
});

test("the actor is shown as stored, with only its documented kind", () => {
  assert.equal(actorKind(`firebase:${project}:editor`), "account");
  assert.equal(actorKind("operator:josh"), "operator");
  assert.equal(actorKind("system:signup"), "system");
  assert.equal(actorKind("editor@example.com"), "other");
  assert.equal(actionText("store_product_retire"), "store product retire");
});

test("a failed audit load shows on the Activity desk and as unavailable on the Overview", () => {
  assert.deepEqual(sourcesFor("Activity"), ["audit"]);
  const unavailable = {
    status: 404,
    body: { error: "The Activity desk reads the game backend's audit log, so it is not available while this website uses mock roles.", code: "AUDIT_UNAVAILABLE" },
  };
  // Every other source loads; built from the source list so another desk's sources can change without touching this.
  const states = sourceStates(
    Object.fromEntries(workspaceSources.map((source) => [source, source === "audit" ? unavailable : { status: 200, body: {} }])),
  );
  const activity = sectionView("Activity", states);
  assert.equal(activity.view, "error");
  assert.match(activity.errors[0].error, /mock roles/);
  assert.ok(sectionView("Overview", states).unavailable.some((u) => u.source === "audit"));
});
