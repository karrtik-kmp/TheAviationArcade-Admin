/**
 * The dev demo waiver (user ruling 2026-11-16, website docs/intent/hosting-dev-demo.md; Backend `6e3512a`, API 0.27.1).
 *
 * On the DEV Admin only, `DEV_DEMO_WAIVER=dev-demo` relaxes two browser pre-checks so the user can publish Josh's
 * demo content: a photo may be published with no licence name (`publishBlockers`), and a Plane of the Day item may
 * be scheduled or published with an empty factual source (`editorialErrors`). It relaxes nothing else, and it
 * authorizes nothing: the Backend stays the authority and still refuses unless its own `DEV_DEMO_WAIVER` is on,
 * which it allows only on a `_dev` database.
 *
 * Prod: the hosted server refuses to start with the setting unless `SITE_URL` is a `dev.admin.` origin
 * (scripts/node-server.mjs), and the layout ignores it on any host that is not `dev.admin.<domain>` or loopback.
 *
 * The labels are inferred from the records, never from the switch: a published version with `licenceName: null`
 * was published under the waiver, and so was a live Plane of the Day item with an empty `factualSource`, since
 * production never allows either. No licence name or source is ever made up.
 */

/** The one value that turns the waiver on, the same as the Backend's. */
export const DEV_DEMO_WAIVER = "dev-demo";

export const WAIVED_LICENCE_TEXT = "Published without a licence (dev demo)";
export const WAIVED_SOURCE_TEXT = "No source (dev demo)";

/** A dev or local admin host: `dev.admin.<domain>`, `localhost`, `127.0.0.1` or `[::1]` (any port). */
export function isDevAdminHost(host: string | null | undefined): boolean {
  const raw = (host ?? "").trim().toLowerCase();
  const name = raw.startsWith("[") ? raw.replace(/^(\[[^\]]*\])(:\d+)?$/, "$1") : raw.replace(/:\d+$/, "");
  if (name === "localhost" || name === "127.0.0.1" || name === "[::1]") return true;
  return /^dev\.admin\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(name);
}

/** Whether this request's pages relax the two pre-checks: exactly `dev-demo`, and only on a dev or local host. */
export function devDemoWaiverOn(host: string | null | undefined, configured: string | null | undefined): boolean {
  return configured === DEV_DEMO_WAIVER && isDevAdminHost(host);
}

/** Why the hosted server must refuse this setting; null when it may start. `siteUrl` is the env's `SITE_URL`. */
export function devDemoWaiverProblem(configured: string | undefined, siteUrl: string | undefined): string | null {
  if (configured === undefined || configured === "") return null;
  if (configured !== DEV_DEMO_WAIVER) return `DEV_DEMO_WAIVER must be ${DEV_DEMO_WAIVER} or unset.`;
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

/** How a version's licence reads: its name; the waiver label for a published version without one; else null. */
export function licenceNameText(version: {
  licence: { licenceName: string | null };
  publishedAt?: string | null;
}): string | null {
  if (version.licence.licenceName) return version.licence.licenceName;
  return version.publishedAt ? WAIVED_LICENCE_TEXT : null;
}

/** How a Plane of the Day item's source reads: the source; the waiver label when live without one; else null. */
export function factualSourceText(item: { status: string; factualSource: string }): string | null {
  if (item.factualSource.trim()) return item.factualSource;
  return item.status === "published" || item.status === "scheduled" ? WAIVED_SOURCE_TEXT : null;
}
