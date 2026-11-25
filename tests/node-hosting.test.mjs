import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { SETTING_KEYS, setting } from "../lib/settings.ts";
import { startupProblems } from "../scripts/node-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

function sources(dir) {
  const out = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(rel.split(path.sep).join("/"));
  }
  return out;
}

test("app code never imports cloudflare:workers or the retired #runtime alias", () => {
  const offenders = ["app", "lib", "components"]
    .flatMap(sources)
    .concat(["proxy.ts", "vite.config.ts"])
    .filter((file) => /["'](cloudflare:workers|#runtime)["']/.test(read(file)));
  assert.deepEqual(offenders, []);
});

test("only the D1 backup-export fixtures under lib/ still mention D1Database", () => {
  const kept = new Set(["lib/submissions/d1.ts", "lib/d1/kernel.ts"]);
  const offenders = sources("lib").filter((file) => !kept.has(file) && /D1Database/.test(read(file)));
  assert.deepEqual(offenders, []);
  for (const file of kept) assert.match(read(file), /D1Database/, file);
});

test("the build has no Cloudflare plugin and the Node build script exists", () => {
  assert.doesNotMatch(read("vite.config.ts"), /@cloudflare\/vite-plugin/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.devDependencies["@cloudflare/vite-plugin"], undefined);
  assert.equal(pkg.scripts["build:node"], "node scripts/build-node.mjs");
  assert.equal(pkg.scripts.deploy, undefined);
});

test("settings come from the process environment; unset reads as undefined", () => {
  const key = "MOCK_PHOTOGRAPHER_EMAILS";
  const before = process.env[key];
  try {
    process.env[key] = "a@b.test";
    assert.equal(setting(key), "a@b.test");
    delete process.env[key];
    assert.equal(setting(key), undefined);
  } finally {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  }
});

test("web.env.example names every setting the server reads, and never the emulator", () => {
  const example = read("web.env.example");
  for (const key of SETTING_KEYS) assert.match(example, new RegExp(`^#? ?${key}=`, "m"), key);
  for (const key of ["HOST", "PORT"]) assert.match(example, new RegExp(`^${key}=`, "m"), key);
  assert.doesNotMatch(example, /^FIREBASE_AUTH_EMULATOR_HOST=/m);
  assert.doesNotMatch(example, /^FIREBASE_PROJECT_ID=demo-/m);
  assert.deepEqual(startupProblems(Object.fromEntries(
    example.split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => line.split(/=(.*)/s).slice(0, 2)),
  )), []);
});

test("the server entry accepts an admin environment", () => {
  assert.deepEqual(startupProblems({ PORT: "3201" }), []);
  assert.deepEqual(startupProblems({ PORT: "3201", SITE_SURFACE: "admin", PUBLIC_SITE_URL: "https://dev.playairplanegames.com" }), []);
});

test("the server entry refuses public or unknown surfaces, bad ports, the emulator and a bad PUBLIC_SITE_URL", () => {
  for (const env of [
    { PORT: "3201", SITE_SURFACE: "public" },
    { PORT: "3201", SITE_SURFACE: "" },
    { PORT: "3201", SITE_SURFACE: "Admin" },
    {},
    { PORT: "" },
    { PORT: "x" },
    { PORT: "0" },
    { PORT: "70000" },
    { PORT: "3201", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" },
    { PORT: "3201", PUBLIC_SITE_URL: "javascript:alert(1)" },
    { PORT: "3201", PUBLIC_SITE_URL: "https://playairplanegames.com/account" },
  ])
    assert.notDeepEqual(startupProblems(env), [], JSON.stringify(env));
});

test("the server process exits 1 with 'Refusing to start' on a bad environment", () => {
  const entry = path.join(root, "scripts", "node-server.mjs");
  const run = (env) =>
    spawnSync(process.execPath, [entry], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: 20_000 });
  for (const env of [
    { SITE_SURFACE: "public", PORT: "3999" },
    { SITE_SURFACE: "admin" },
    { PORT: "3999", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" },
  ]) {
    const result = run(env);
    assert.equal(result.status, 1, JSON.stringify(env));
    assert.match(result.stderr, /Refusing to start/);
  }
});

test("GET /api/health exists and needs no auth", () => {
  const route = read("app/api/health/route.ts");
  assert.match(route, /export function GET\(\)/);
  assert.doesNotMatch(route, /principal|requireArea|cookie/i);
});
