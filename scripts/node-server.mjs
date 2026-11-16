// The production server for the Node build. `npm run build:node` copies this file to dist-node/server.mjs,
// next to the Vinext output in dist/. The host starts it from the checkout with:
//   node --env-file=envVar/.env dist-node/server.mjs
// Settings come from the process environment only (web.env.example lists them).
//
// This repo is the Admin: it serves only the staff desks (/admin, admin sign-in, /sign-out) and the API they
// call. There is no public surface to switch to, so a SITE_SURFACE other than "admin" is a wrong env file.
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHUTDOWN_GRACE_MS = 15_000; // The server contract allows 20 s.

/** Every reason this environment must not serve; empty when it may. Exported for tests. */
export function startupProblems(env) {
  const problems = [];
  if (env.SITE_SURFACE !== undefined && env.SITE_SURFACE !== "admin")
    problems.push("SITE_SURFACE must be admin or unset: this build is the Admin.");
  const port = Number(env.PORT);
  if (!env.PORT || !Number.isInteger(port) || port <= 0 || port > 65535) problems.push("PORT must be a port number.");
  // The deploy refuses the Auth emulator; a production build would also throw on it per request.
  if (env.FIREBASE_AUTH_EMULATOR_HOST) problems.push("FIREBASE_AUTH_EMULATOR_HOST is local only; unset it.");
  if (env.PUBLIC_SITE_URL && !validSiteUrl(env.PUBLIC_SITE_URL))
    problems.push("PUBLIC_SITE_URL must be an http(s) origin such as https://playairplanegames.com.");
  const waiver = devDemoWaiverProblem(env.DEV_DEMO_WAIVER, env.SITE_URL);
  if (waiver) problems.push(waiver);
  return problems;
}

/**
 * The dev demo waiver is dev only (ruling 2026-11-16): exactly `dev-demo`, and only with SITE_URL on a dev.admin.
 * host. Kept in step with lib/dev-waiver.ts `devDemoWaiverProblem` (this file runs without the app's TypeScript;
 * tests/dev-waiver.test.mjs checks both agree).
 */
export function devDemoWaiverProblem(configured, siteUrl) {
  if (configured === undefined || configured === "") return null;
  if (configured !== "dev-demo") return "DEV_DEMO_WAIVER must be dev-demo or unset.";
  let host = "";
  try {
    host = siteUrl ? new URL(siteUrl).hostname : "";
  } catch {
    host = "";
  }
  if (!/^dev\.admin\./.test(host))
    return "DEV_DEMO_WAIVER is for the dev Admin only: SITE_URL must be its https://dev.admin.<domain> origin.";
  return null;
}

function validSiteUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function main() {
  const problems = startupProblems(process.env);
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    console.error("Refusing to start.");
    process.exit(1);
  }
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT);

  // nginx (exactly one hop) terminates TLS and sets X-Forwarded-Proto, so request URLs, and with them the
  // same-origin checks on every write, see https. Vinext reads this when its server module loads, so set it
  // before the import. X-Forwarded-Host stays untrusted. Hosting headers never authorize anything.
  process.env.VINEXT_TRUST_PROXY ??= "1";

  const { startProdServer } = await import("vinext/server/prod-server");
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
  const { server } = await startProdServer({ host, port, outDir });
  console.log(`Serving the Admin on http://${host}:${port}`);

  let stopping = false;
  function stop(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: closing.`);
    const force = setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  }
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
