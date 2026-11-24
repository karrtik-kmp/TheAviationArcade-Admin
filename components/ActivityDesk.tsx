"use client";

import { ClockCounterClockwise } from "@phosphor-icons/react";
import { actionText, actorKind, eventWaivers, type AuditEvent } from "@/lib/audit-desk";

const actorLabel = {
  account: "Account",
  operator: "Operator",
  system: "System",
  other: "Actor",
} as const;

function eventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * The game backend's audit log (A3.4): the newest 50 events, newest first, with no paging. Each shows its action, what
 * it was about, the actor as the stored principal (never an email or a name), any dev-demo waiver flag with the value
 * the record gives, and the stored detail as it came.
 */
export function ActivityDesk({ events }: { events: AuditEvent[] }) {
  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">AUDIT LOG</p>
          <h1>Activity</h1>
          <p>Recent staff changes recorded by the game backend.</p>
        </div>
        <span className="admin-total">Latest {events.length}</span>
      </div>
      <section className="admin-panel">
        <div className="admin-panel-header">
          <div>
            <h2>Recent events</h2>
            <p>Most recent first · the newest 50 events, no older pages</p>
          </div>
        </div>
        {events.length ? (
          <ol className="audit-list" role="list">
            {events.map((event) => {
              const waivers = eventWaivers(event);
              const detail = Object.keys(event.detail).length ? JSON.stringify(event.detail, null, 2) : "";
              return (
                <li className="audit-event" key={event.id}>
                  <span className="audit-mark" aria-hidden="true">
                    <ClockCounterClockwise size={17} />
                  </span>
                  <div>
                    <b>{actionText(event.action)}</b>
                    <small>
                      {event.entity ? <>On <code>{event.entity}</code> · </> : null}
                      {actorLabel[actorKind(event.actor)]} <code>{event.actor}</code>
                    </small>
                    {waivers.length > 0 && (
                      <ul className="audit-waivers" role="list" aria-label="Waivers in this record">
                        {waivers.map((waiver) => (
                          <li key={waiver.key} className="audit-waiver">
                            {waiver.label}: <code>{waiver.value}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                    {detail && (
                      <details className="audit-detail">
                        <summary>
                          Detail<span className="sr-only"> of {actionText(event.action)}, {event.id}</span>
                        </summary>
                        <pre>{detail}</pre>
                      </details>
                    )}
                    <small>{event.id}</small>
                  </div>
                  <time dateTime={event.createdAt}>{eventTime(event.createdAt)}</time>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="admin-empty">
            <ClockCounterClockwise size={25} />
            <b>No activity recorded yet</b>
            <span>Staff changes made through the game backend will appear here.</span>
          </div>
        )}
      </section>
    </>
  );
}
