"use client";

/**
 * The workspace laid out by the SRS's Admin areas (`lib/srs-areas.ts`): the grouped sidebar, the status page for an
 * area with no desk yet, and the Overview's coverage panel. Nothing here reads or writes private data.
 */

import {
  AirplaneInFlight,
  AirplaneTilt,
  ArrowRight,
  ChartLineUp,
  ClipboardText,
  ClockCounterClockwise,
  Database,
  Globe,
  GridFour,
  IdentificationCard,
  ImageSquare,
  Images,
  Question,
  ShoppingBag,
  SquaresFour,
  Storefront,
  Ticket,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";
import type { RefObject } from "react";
import {
  areaForPlanned,
  coverage,
  isPlanned,
  navGroups,
  srsAreas,
  statusLabel,
  type DeskSection,
  type PlannedSection,
  type RequirementStatus,
  type Section,
  type SrsArea,
} from "@/lib/srs-areas";

export const sectionIcons: Record<Section, Icon> = {
  Overview: SquaresFour,
  Activity: ClockCounterClockwise,
  Submissions: ClipboardText,
  "Plane of the Day": ImageSquare,
  Media: Images,
  Gallery: GridFour,
  "Aircraft Identifier": AirplaneInFlight,
  "Military readiness": AirplaneTilt,
  "Content databases": Database,
  Users: UsersThree,
  Store: Storefront,
  "Player tools": IdentificationCard,
  "First Class Pass": Ticket,
  Progression: ChartLineUp,
  FAQ: Question,
  Marketplace: ShoppingBag,
  "Website content": Globe,
};

/** The group a section sits in, for the top bar's trail. */
export function groupOf(section: Section): string {
  return navGroups.find((group) => group.items.includes(section))?.caption ?? "Workspace";
}

export function SidebarNav({
  section,
  visible,
  onSelect,
  reviewCount,
  navRef,
}: {
  section: Section;
  /** Desk sections this account may open; planned pages are always shown. */
  visible: (section: DeskSection) => boolean;
  onSelect: (section: Section) => void;
  /** The "to review" badge on Submissions, already formatted, or empty. */
  reviewCount: string;
  navRef: RefObject<HTMLElement | null>;
}) {
  return (
    <nav ref={navRef} aria-label="Admin sections" className="admin-nav">
      {navGroups.map((group) => {
        const items = group.items.filter((item) => isPlanned(item) || visible(item));
        if (!items.length) return null;
        return (
          <div className="admin-nav-group" key={group.caption}>
            <span className="admin-nav-caption">{group.caption}</span>
            {items.map((item) => {
              const Icon = sectionIcons[item];
              const current = section === item;
              const planned = isPlanned(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => onSelect(item)}
                  className={`admin-nav-item${current ? " active" : ""}${planned ? " planned" : ""}`}
                  aria-current={current ? "page" : undefined}
                >
                  <Icon size={18} weight={current ? "fill" : "regular"} aria-hidden />
                  <span className="admin-nav-label">{item}</span>
                  {planned && (
                    <span className="admin-nav-planned" title="Planned: no desk yet">
                      <span className="sr-only">, planned, no desk yet</span>
                    </span>
                  )}
                  {item === "Submissions" && reviewCount && (
                    <span className="admin-nav-count">
                      {reviewCount}
                      <span className="sr-only"> to review</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function StatusBadge({ status }: { status: RequirementStatus }) {
  return <span className={`srs-status srs-${status}`}>{statusLabel[status]}</span>;
}

function CoverageBar({ area }: { area: SrsArea }) {
  const counts = coverage(area.requirements);
  const parts: RequirementStatus[] = ["built", "partial", "backlog", "blocked"];
  const summary = parts
    .filter((status) => counts[status])
    .map((status) => `${counts[status]} ${statusLabel[status].toLowerCase()}`)
    .join(", ");
  return (
    <span className="srs-bar" role="img" aria-label={summary}>
      {parts.map((status) =>
        counts[status] ? (
          <span key={status} className={`srs-bar-part srs-${status}`} style={{ flexGrow: counts[status] }} />
        ) : null,
      )}
    </span>
  );
}

function RequirementList({ area }: { area: SrsArea }) {
  return (
    <ul className="srs-requirements">
      {area.requirements.map((requirement) => (
        <li key={requirement.id}>
          <code>{requirement.id}</code>
          <span className="srs-requirement-copy">
            <b>{requirement.text}</b>
            {requirement.note && <small>{requirement.note}</small>}
          </span>
          <StatusBadge status={requirement.status} />
        </li>
      ))}
    </ul>
  );
}

/** The page for an area with no desk yet: what the SRS asks for, what works today, and what each part waits for. */
export function PlannedArea({
  section,
  onNavigate,
  canOpen,
}: {
  section: PlannedSection;
  onNavigate: (section: Section) => void;
  canOpen: (section: DeskSection) => boolean;
}) {
  const area = areaForPlanned(section);
  const counts = coverage(area.requirements);
  const desks = area.desks.filter(canOpen);
  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">SRS {area.ref} · NOT BUILT YET</p>
          <h1>{section}</h1>
          <p>{area.summary}</p>
        </div>
      </div>
      <div className="srs-facts" aria-label={`${area.title} requirements`}>
        <span>
          <strong>{counts.total}</strong> requirements
        </span>
        <span>
          <strong>{counts.built + counts.partial}</strong> built or partial
        </span>
        <span>
          <strong>{counts.blocked}</strong> blocked
        </span>
      </div>
      {area.waitsOn && (
        <p className="srs-waits" role="note">
          <b>Waits on</b> {area.waitsOn}
        </p>
      )}
      <div className="srs-page">
        <section className="admin-panel">
          <div className="admin-panel-header">
            <div>
              <h2>{area.title} requirements</h2>
              <p>Statuses from this repo&apos;s record of the SRS, checked against the code.</p>
            </div>
          </div>
          <RequirementList area={area} />
        </section>
        <section className="admin-panel srs-today">
          <div className="admin-panel-header">
            <div>
              <h2>Working today</h2>
              <p>{desks.length ? "The desks that already cover part of this area" : "No desk covers this area yet"}</p>
            </div>
          </div>
          {desks.length ? (
            desks.map((desk) => {
              const Icon = sectionIcons[desk];
              return (
                <button type="button" key={desk} className="srs-desk-link" onClick={() => onNavigate(desk)}>
                  <span className="shortcut-icon">
                    <Icon size={19} aria-hidden />
                  </span>
                  <b>{desk}</b>
                  <ArrowRight size={16} aria-hidden />
                </button>
              );
            })
          ) : (
            <p className="srs-today-empty">
              Each requirement says what it waits for: an open issue, a backend change or content from the client.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

/** The Overview's panel: each SRS area's progress, opened to its requirement list. */
export function CoveragePanel({
  onNavigate,
  canOpen,
}: {
  onNavigate: (section: Section) => void;
  canOpen: (section: DeskSection) => boolean;
}) {
  const all = coverage(srsAreas.flatMap((area) => area.requirements));
  return (
    <section className="admin-panel srs-coverage" aria-labelledby="srs-coverage-title">
      <div className="admin-panel-header">
        <div>
          <h2 id="srs-coverage-title">Admin scope</h2>
          <p>
            {all.built} of {all.total} SRS §4 requirements built, {all.partial} partial, {all.blocked} blocked on an
            open issue or client content
          </p>
        </div>
        <span className="srs-legend" aria-hidden>
          {(["built", "partial", "backlog", "blocked"] as const).map((status) => (
            <span key={status}>
              <i className={`srs-${status}`} />
              {statusLabel[status]}
            </span>
          ))}
        </span>
      </div>
      <div className="srs-areas">
        {srsAreas.map((area) => {
          const counts = coverage(area.requirements);
          const target: Section | undefined = area.planned ?? area.desks.find(canOpen);
          return (
            <details key={area.id} className="srs-area">
              <summary>
                <span className="srs-area-ref">{area.ref}</span>
                <span className="srs-area-title">
                  <b>{area.title}</b>
                  <small>
                    {counts.built}/{counts.total} built
                  </small>
                </span>
                <CoverageBar area={area} />
              </summary>
              <RequirementList area={area} />
              {target && (
                <button type="button" className="admin-text-button srs-open" onClick={() => onNavigate(target)}>
                  Open {target} <span aria-hidden>→</span>
                </button>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}
