import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  DEV_DEMO_WAIVER,
  WAIVED_LICENCE_TEXT,
  WAIVED_SOURCE_TEXT,
  devDemoWaiverOn,
  devDemoWaiverProblem,
  factualSourceText,
  isDevAdminHost,
  licenceNameText,
} from "../lib/dev-waiver.ts";
import { publishBlockers } from "../lib/media-form.ts";
import { editorialErrors } from "../lib/rules.ts";
import { devDemoWaiverProblem as serverWaiverProblem, startupProblems } from "../scripts/node-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const licence = (over = {}) => ({
  credit: null,
  licenceName: null,
  licenceUrl: null,
  sourceUrl: null,
  attributionText: null,
  creditRequired: false,
  ...over,
});
const potd = (over = {}) => ({
  title: "Spitfire over the coast",
  aircraft: "Supermarine Spitfire",
  photographer: "Josh M",
  credit: "Josh M",
  factualSource: "",
  description: "A Spitfire photographed at an air show.",
  correctAnswer: "",
  distractors: ["", "", ""],
  difficulty: "Cadet",
  ...over,
});

test("the waiver is on only for exactly dev-demo on a dev or local admin host", () => {
  assert.equal(DEV_DEMO_WAIVER, "dev-demo");
  for (const host of ["dev.admin.playairplanegames.com", "DEV.ADMIN.playairplanegames.com:443", "localhost:5173", "127.0.0.1", "[::1]:5173"])
    assert.equal(devDemoWaiverOn(host, "dev-demo"), true, host);
  for (const host of ["admin.playairplanegames.com", "playairplanegames.com", "dev.playairplanegames.com", "evil.dev.admin.example.com.attacker", "dev.admin.", "", null, undefined])
    assert.equal(devDemoWaiverOn(host, "dev-demo"), false, String(host));
  for (const value of [undefined, null, "", "Dev-Demo", "dev-demo ", "1", "true"])
    assert.equal(devDemoWaiverOn("dev.admin.playairplanegames.com", value), false, String(value));
  assert.equal(isDevAdminHost("admin.playairplanegames.com"), false);
});

test("the hosted server refuses the waiver on prod, a bad value or a missing SITE_URL", () => {
  const dev = { PORT: "3201", SITE_URL: "https://dev.admin.playairplanegames.com" };
  assert.deepEqual(startupProblems({ ...dev, DEV_DEMO_WAIVER: "dev-demo" }), []);
  assert.deepEqual(startupProblems({ PORT: "3200", SITE_URL: "https://admin.playairplanegames.com" }), [], "unset is fine on prod");
  for (const env of [
    { PORT: "3200", SITE_URL: "https://admin.playairplanegames.com", DEV_DEMO_WAIVER: "dev-demo" },
    { PORT: "3201", DEV_DEMO_WAIVER: "dev-demo" },
    { PORT: "3201", SITE_URL: "not a url", DEV_DEMO_WAIVER: "dev-demo" },
    { PORT: "3201", SITE_URL: "https://dev.playairplanegames.com", DEV_DEMO_WAIVER: "dev-demo" },
    { ...dev, DEV_DEMO_WAIVER: "yes" },
  ])
    assert.notDeepEqual(startupProblems(env), [], JSON.stringify(env));
});

test("the server's copy of the startup rule agrees with lib/dev-waiver.ts", () => {
  const values = [undefined, "", "dev-demo", "on"];
  const urls = [undefined, "", "x", "https://dev.admin.playairplanegames.com", "https://admin.playairplanegames.com", "http://dev.admin.example.test:8080"];
  for (const value of values) for (const url of urls) assert.equal(serverWaiverProblem(value, url), devDemoWaiverProblem(value, url), `${value} ${url}`);
});

test("web.env.example leaves the waiver off", () => {
  const example = readFileSync(path.join(root, "web.env.example"), "utf8");
  assert.match(example, /^# DEV_DEMO_WAIVER=dev-demo$/m);
  assert.doesNotMatch(example, /^DEV_DEMO_WAIVER=/m);
});

test("with the waiver a missing licence name stops nothing; credit and rights still do", () => {
  const on = { devDemoWaiver: true };
  assert.deepEqual(publishBlockers(licence()).map((b) => b.field), ["licenceName"], "off by default");
  assert.deepEqual(publishBlockers(licence(), undefined, { devDemoWaiver: false }).map((b) => b.field), ["licenceName"]);
  assert.deepEqual(publishBlockers(licence(), undefined, on), []);
  assert.deepEqual(publishBlockers(licence({ creditRequired: true }), undefined, on).map((b) => b.field), ["credit"]);
  assert.deepEqual(publishBlockers(licence(), null, on).map((b) => b.field), ["rights"]);
  assert.deepEqual(publishBlockers(licence(), { statement: "v1_own", statedAt: "2026-11-16T00:00:00Z" }, on), []);
});

test("with the waiver a Plane of the Day item may have no source; a given source must still be https", () => {
  const on = { devDemoWaiver: true };
  assert.ok(editorialErrors("potd", potd()).includes("Add an https factual source."), "off by default");
  assert.deepEqual(editorialErrors("potd", potd(), on), []);
  assert.deepEqual(editorialErrors("potd", potd({ factualSource: "   " }), on), []);
  assert.ok(editorialErrors("potd", potd({ factualSource: "http://example.com" }), on).includes("Add an https factual source."));
  assert.deepEqual(editorialErrors("potd", potd({ factualSource: "https://example.com/spitfire" }), on), []);
  assert.ok(editorialErrors("potd", potd({ credit: "" }), on).includes("Add a photographer credit."), "credit is not waived");
  const identifier = potd({ correctAnswer: "Spitfire", distractors: ["Hurricane", "Mustang", "Zero"] });
  assert.ok(editorialErrors("identifier", identifier, on).includes("Add an https factual source."), "identifier is not waived");
});

test("labels come from the record: a licence name or source is never made up", () => {
  assert.equal(licenceNameText({ licence: { licenceName: "CC BY 4.0" }, publishedAt: "2026-11-16T00:00:00Z" }), "CC BY 4.0");
  assert.equal(licenceNameText({ licence: { licenceName: null }, publishedAt: "2026-11-16T00:00:00Z" }), WAIVED_LICENCE_TEXT);
  assert.equal(licenceNameText({ licence: { licenceName: null }, publishedAt: null }), null);
  assert.equal(licenceNameText({ licence: { licenceName: null } }), null);
  assert.equal(WAIVED_LICENCE_TEXT, "Published without a licence (dev demo)");
  assert.equal(WAIVED_SOURCE_TEXT, "No source (dev demo)");
  assert.equal(factualSourceText({ status: "published", factualSource: "" }), WAIVED_SOURCE_TEXT);
  assert.equal(factualSourceText({ status: "scheduled", factualSource: " " }), WAIVED_SOURCE_TEXT);
  assert.equal(factualSourceText({ status: "draft", factualSource: "" }), null);
  assert.equal(factualSourceText({ status: "published", factualSource: "https://example.com" }), "https://example.com");
});
