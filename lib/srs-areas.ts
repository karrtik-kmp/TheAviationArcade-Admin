/**
 * The Admin's share of the SRS (`../docs/SRS.md` §4, 2026-11-26), as the workspace shows it: the sidebar groups,
 * the status pages for areas with no desk yet, and the Overview's coverage panel.
 *
 * Statuses follow this repo's own record (`docs/TASKS.md`, "SRS requirements owned by the Admin"), not the SRS copy.
 * When a requirement changes there, change it here too. Nothing here is client content: it names the requirement and
 * what it waits for, never a product, partner, price or threshold.
 */

export type RequirementStatus = "built" | "partial" | "backlog" | "blocked";

export type Requirement = {
  id: string;
  text: string;
  status: RequirementStatus;
  /** What exists, or what it waits for. */
  note?: string;
};

/** A workspace section that has a working desk. */
export type DeskSection =
  | "Overview"
  | "Submissions"
  | "Aircraft Identifier"
  | "Plane of the Day"
  | "Military readiness"
  | "Media"
  | "Store"
  | "Users"
  | "FAQ"
  | "Activity";

/** A section with no desk yet: its page lists the area's requirements and what blocks each. */
export type PlannedSection =
  | "Gallery"
  | "Content databases"
  | "Progression"
  | "First Class Pass"
  | "Marketplace"
  | "Player tools"
  | "Website content";

export type Section = DeskSection | PlannedSection;

export type SrsArea = {
  id: string;
  /** The SRS section, e.g. "§4.6". */
  ref: string;
  title: string;
  /** One line on what the area is for. */
  summary: string;
  /** The desks that serve it today. */
  desks: DeskSection[];
  /** Its status page, when part of it has no desk. */
  planned?: PlannedSection;
  /** Why it waits, when the whole area waits on one thing. */
  waitsOn?: string;
  requirements: Requirement[];
};

export const srsAreas: SrsArea[] = [
  {
    id: "pod",
    ref: "§4.1",
    title: "Picture of the Day",
    summary: "Schedule, describe and publish the daily aircraft photo.",
    desks: ["Plane of the Day", "Media"],
    requirements: [
      { id: "AD-POD-01", text: "Upload aircraft images", status: "partial", note: "Upload route exists; no upload screen. Photos come from photographers on the website." },
      { id: "AD-POD-02", text: "Schedule future entries by date", status: "built", note: "Scheduled status with a date. Not yet walked against the backend seed." },
      { id: "AD-POD-03", text: "Manage photographer details", status: "partial", note: "Staff-typed photographer text on the entry. Which details are meant: OI-26." },
      { id: "AD-POD-04", text: "Manage photographer social media links", status: "partial", note: "Instagram only. More networks need a backend schema change." },
      { id: "AD-POD-05", text: "Manage aircraft information", status: "partial", note: "One aircraft text field. Make, model and variant need backend fields." },
      { id: "AD-POD-06", text: "Preview a scheduled entry", status: "backlog", note: "Only the Media desk previews the photo." },
      { id: "AD-POD-07", text: "Publish and unpublish entries", status: "partial", note: "Unpublish (published to archived) still to walk against the backend." },
      { id: "AD-POD-08", text: "Reorder the recent gallery (optional)", status: "backlog", note: "Needs a backend order field." },
    ],
  },
  {
    id: "gallery",
    ref: "§4.2",
    title: "Gallery",
    summary: "Archived images, gallery order and featured images.",
    desks: [],
    planned: "Gallery",
    requirements: [
      { id: "AD-GAL-01", text: "Manage archived images", status: "blocked", note: "OI-27: archived Picture of the Day entries, or withdrawn photos?" },
      { id: "AD-GAL-02", text: "Set gallery order", status: "backlog", note: "Needs a backend order field and route (with AD-POD-08)." },
      { id: "AD-GAL-03", text: "Mark featured images", status: "backlog", note: "No featured flag on the backend yet." },
    ],
  },
  {
    id: "submissions",
    ref: "§4.3",
    title: "Photographer submissions",
    summary: "Every photo is reviewed before it is public.",
    desks: ["Submissions", "Media"],
    requirements: [
      { id: "AD-SUB-01", text: "Review photo submissions", status: "built" },
      { id: "AD-SUB-02", text: "Publish, request changes or decline with a reason", status: "built", note: "API 0.30.0. Not on dev yet." },
      { id: "AD-SUB-03", text: "Manage submission status", status: "built", note: "Review queues, reopen, withdraw a decision." },
      { id: "AD-SUB-04", text: "View the photographer's release acknowledgement", status: "built", note: "Photo Submission Agreement of 2026-12-01." },
      { id: "AD-SUB-05", text: "Feature an approved photo as the Picture of the Day", status: "built", note: "Start a Plane of the Day draft after publishing." },
    ],
  },
  {
    id: "content",
    ref: "§4.4",
    title: "Game content",
    summary: "Questions and reference data for the eight game modules.",
    desks: ["Aircraft Identifier", "Military readiness"],
    planned: "Content databases",
    requirements: [
      { id: "AD-CNT-01", text: "Manage questions", status: "blocked", note: "OI-10 for editing answers. The desks check photographs and rights; text comes from client sheets." },
      { id: "AD-CNT-02", text: "Airport database", status: "backlog", note: "Waits for client data." },
      { id: "AD-CNT-03", text: "Aircraft database", status: "backlog", note: "Waits for Josh's attribute grid." },
      { id: "AD-CNT-04", text: "Call sign database", status: "backlog", note: "Waits for client data." },
      { id: "AD-CNT-05", text: "Tail identifier database", status: "backlog", note: "Waits for client data." },
      { id: "AD-CNT-06", text: "Runway layouts", status: "backlog", note: "Waits for client data." },
      { id: "AD-CNT-07", text: "Code Search data", status: "backlog", note: "Waits for the backend import." },
      { id: "AD-CNT-08", text: "Import and export client sheets", status: "partial", note: "Military releases upload, go live and restore. No xlsx import or export screen." },
    ],
  },
  {
    id: "progression",
    ref: "§4.5",
    title: "Progression",
    summary: "Status Points, Miles, rank thresholds, rewards and subscription settings.",
    desks: [],
    planned: "Progression",
    waitsOn: "OI-09: the rules are code in the backend, per the points-progression spec. A threshold change can promote or demote existing players.",
    requirements: [
      { id: "AD-PRG-01", text: "Configure Status Point awards", status: "blocked", note: "OI-09" },
      { id: "AD-PRG-02", text: "Configure Miles awards", status: "blocked", note: "OI-09" },
      { id: "AD-PRG-03", text: "Configure rank thresholds", status: "blocked", note: "OI-09" },
      { id: "AD-PRG-04", text: "Configure rewards", status: "blocked", note: "OI-09" },
      { id: "AD-PRG-05", text: "Configure subscription settings", status: "blocked", note: "OI-09" },
    ],
  },
  {
    id: "fcp",
    ref: "§4.6",
    title: "First Class Pass",
    summary: "Member benefits that grow over time, managed here.",
    desks: [],
    planned: "First Class Pass",
    requirements: [
      { id: "AD-FCP-01", text: "Manage subscription benefits", status: "backlog" },
      { id: "AD-FCP-02", text: "Manage premium downloadable content", status: "backlog", note: "OI-17" },
      { id: "AD-FCP-03", text: "Manage exclusive member content", status: "backlog" },
      { id: "AD-FCP-04", text: "Manage partner discount offers", status: "backlog", note: "OI-18" },
      { id: "AD-FCP-05", text: "Configure in-app premium benefits", status: "blocked", note: "OI-09 (multiplier) and OI-11 (ads)." },
      { id: "AD-FCP-06", text: "Manage membership tiers (future-ready)", status: "backlog" },
    ],
  },
  {
    id: "marketplace",
    ref: "§4.7",
    title: "Marketplace",
    summary: "The affiliate marketplace the website shows.",
    desks: [],
    planned: "Marketplace",
    waitsOn: "Client content (website CQ-2). Product text is sanitised here and again where the website renders it.",
    requirements: [
      { id: "AD-MKT-01", text: "Manage product categories", status: "blocked", note: "Client content" },
      { id: "AD-MKT-02", text: "Manage products", status: "blocked", note: "Client content" },
      { id: "AD-MKT-03", text: "Edit product text in a rich content editor", status: "blocked", note: "Client content" },
      { id: "AD-MKT-04", text: "Manage product images", status: "blocked", note: "Client content" },
      { id: "AD-MKT-05", text: "Manage affiliate links", status: "blocked", note: "Client content" },
      { id: "AD-MKT-06", text: "Mark featured products", status: "blocked", note: "Client content" },
      { id: "AD-MKT-07", text: "Publish and unpublish products", status: "blocked", note: "Client content" },
    ],
  },
  {
    id: "users",
    ref: "§4.8",
    title: "Players and staff",
    summary: "Find players, their purchases and Pass, and who holds which role.",
    desks: ["Users", "Store"],
    planned: "Player tools",
    requirements: [
      { id: "AD-USR-01", text: "Find and view players", status: "partial", note: "The Store desk's player view; the Users desk for roles." },
      { id: "AD-USR-02", text: "Manage a player's rank", status: "backlog", note: "OI-25. A manual change is a ledger entry with a reason." },
      { id: "AD-USR-03", text: "Monitor achievements", status: "backlog", note: "Needs a backend read for staff." },
      { id: "AD-USR-04", text: "Statistics dashboard", status: "backlog", note: "OI-22: the metrics are not specified." },
      { id: "AD-USR-05", text: "Manage First Class Pass memberships", status: "partial", note: "Entitlements are read-only. Manual grants: OI-25." },
      { id: "AD-USR-06", text: "Grant and revoke staff; block and unblock photo submission", status: "built", note: "Backend roles only." },
    ],
  },
  {
    id: "website",
    ref: "§4.8–4.9",
    title: "Website content",
    summary: "What the public website shows that someone keeps up to date.",
    desks: ["FAQ"],
    planned: "Website content",
    requirements: [
      { id: "AD-FAQ-01", text: "Edit and publish the FAQ and gameplay guides", status: "built", note: "API 0.33.0." },
      { id: "AD-FAQ-02", text: "Copy the FAQ from dev to live", status: "built", note: "Export on dev, import into the live draft, publish on live." },
      { id: "WB-PTR", text: "Partner directory", status: "blocked", note: "OI-19: does the Admin own it?" },
      { id: "WB-CON", text: "Contact-form inbox", status: "blocked", note: "OI-19" },
      { id: "WB-HOM-07/08", text: "Homepage featured partners and ad placements", status: "blocked", note: "OI-19" },
      { id: "AD-COM-01", text: "Moderate the community forum", status: "blocked", note: "OI-04: not in the proposal." },
    ],
  },
];

export const plannedSections: PlannedSection[] = srsAreas.flatMap((area) => (area.planned ? [area.planned] : []));

export function isPlanned(section: Section): section is PlannedSection {
  return (plannedSections as string[]).includes(section);
}

export function areaForPlanned(section: PlannedSection): SrsArea {
  const area = srsAreas.find((item) => item.planned === section);
  if (!area) throw new Error(`No SRS area for ${section}`);
  return area;
}

/** The sidebar, in SRS order. Planned items open a status page. */
export const navGroups: { caption: string; items: Section[] }[] = [
  { caption: "Workspace", items: ["Overview", "Activity"] },
  { caption: "Photos", items: ["Submissions", "Plane of the Day", "Media", "Gallery"] },
  { caption: "Game content", items: ["Aircraft Identifier", "Military readiness", "Content databases"] },
  { caption: "Players", items: ["Users", "Store", "Player tools", "First Class Pass", "Progression"] },
  { caption: "Website", items: ["FAQ", "Marketplace", "Website content"] },
];

export type Coverage = Record<RequirementStatus, number> & { total: number };

export function coverage(requirements: Requirement[]): Coverage {
  const counts: Coverage = { built: 0, partial: 0, backlog: 0, blocked: 0, total: requirements.length };
  for (const requirement of requirements) counts[requirement.status] += 1;
  return counts;
}

export const statusLabel: Record<RequirementStatus, string> = {
  built: "Built",
  partial: "Partial",
  backlog: "Not started",
  blocked: "Blocked",
};
