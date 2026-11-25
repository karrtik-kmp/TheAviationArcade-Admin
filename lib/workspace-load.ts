/**
 * A3.0: the editorial workspace loads each data source on its own, so one source that fails (today: every D1 route
 * answers 503) shows its own error on the desks that need it instead of hiding the whole workspace. Desks that read
 * nothing here (Media, Store, Users load their own data from the backend) never wait on these sources.
 */

export type WorkspaceSource = "submissions" | "content" | "audit" | "military" | "identifier" | "potd";
export type SourceState =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; error: string };
export type SourceStates = Record<WorkspaceSource, SourceState>;

export const workspaceSources: readonly WorkspaceSource[] = ["submissions", "content", "audit", "military", "identifier", "potd"];

export const sourceUrl: Record<WorkspaceSource, string> = {
  submissions: "/api/admin/submissions",
  content: "/api/admin/content",
  audit: "/api/admin/audit",
  military: "/api/admin/military",
  identifier: "/api/admin/identifier",
  potd: "/api/admin/plane-of-the-day",
};

export const sourceLabel: Record<WorkspaceSource, string> = {
  submissions: "Submissions",
  content: "Content records",
  audit: "Activity",
  military: "Military readiness",
  identifier: "Aircraft Identifier",
  potd: "Plane of the Day",
};

const fallbackError: Record<WorkspaceSource, string> = {
  submissions: "Could not load submissions.",
  content: "Could not load content records.",
  audit: "Could not load the activity log.",
  military: "Could not load Military readiness.",
  identifier: "Could not load the Aircraft Identifier questions.",
  potd: "Could not load the Plane of the Day items.",
};

/** Which sources each workspace section reads. Sections not listed read none. */
const sectionNeeds: Record<string, readonly WorkspaceSource[]> = {
  Overview: ["submissions", "content", "audit", "identifier", "potd"],
  // On the game backend's media since the A3 fix wave: the desk reads its own lists, as the Media desk does.
  Submissions: [],
  // On the game backend since A3.2 (the view-only demo shows sample drafts and loads nothing).
  "Aircraft Identifier": ["identifier"],
  // On the game backend since A3.3 (editorial kind `plane-of-the-day`); the desk reads the published photos itself.
  "Plane of the Day": ["potd"],
  // On the game backend since A3.1; its photos come from the Media routes, which the desk reads itself.
  "Military readiness": ["military"],
  Activity: ["audit"],
};

export function sourcesFor(section: string): readonly WorkspaceSource[] {
  return sectionNeeds[section] ?? [];
}

export function allSources(state: SourceState): SourceStates {
  return { submissions: state, content: state, audit: state, military: state, identifier: state, potd: state };
}

/** One source's response: an HTTP status and parsed body, or a network failure (`status: 0`). */
export type SourceResult = { status: number; body: unknown };

function bodyField(body: unknown, field: string): string {
  if (!body || typeof body !== "object" || !(field in body)) return "";
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

/**
 * Any 401/403 or ACCOUNT_CHANGED from any source blocks the whole workspace (the account no longer matches), and no
 * source's data is applied. Returns the status to block with, or null.
 */
export function blockingStatus(results: Record<WorkspaceSource, SourceResult>): number | null {
  for (const source of workspaceSources) {
    const { status, body } = results[source];
    if (status === 401 || status === 403) return status;
    if (bodyField(body, "code") === "ACCOUNT_CHANGED") return status || 409;
  }
  return null;
}

/** The state of each source after a load that was not blocked. */
export function sourceStates(results: Record<WorkspaceSource, SourceResult>): SourceStates {
  const states = {} as SourceStates;
  for (const source of workspaceSources) {
    const { status, body } = results[source];
    states[source] =
      status >= 200 && status < 300
        ? { state: "ready" }
        : { state: "error", error: bodyField(body, "error") || fallbackError[source] };
  }
  return states;
}

export type SectionView =
  | { view: "loading" }
  | { view: "error"; errors: { source: WorkspaceSource; label: string; error: string }[] }
  | { view: "ready"; unavailable: { source: WorkspaceSource; label: string; error: string }[] };

/**
 * What a section shows. A section waits while any of its sources loads. The Overview renders with whatever loaded and
 * lists what didn't; every other section needs all of its sources.
 */
export function sectionView(section: string, states: SourceStates): SectionView {
  const needs = sourcesFor(section);
  if (needs.some((source) => states[source].state === "loading")) return { view: "loading" };
  const failed = needs.flatMap((source) => {
    const state = states[source];
    return state.state === "error" ? [{ source, label: sourceLabel[source], error: state.error }] : [];
  });
  if (failed.length && section !== "Overview") return { view: "error", errors: failed };
  return { view: "ready", unavailable: failed };
}
