"use client";

import {
  Button,
  Checkbox,
  Input,
  MessageBar,
  MessageBarBody,
  Textarea,
} from "@fluentui/react-components";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  CheckCircle,
  Package,
  Shuffle,
  Target,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { ranks } from "@/lib/catalog";
import {
  checklistNames,
  compareIds,
  evidenceOf,
  prepStages,
  rankName,
  readiness,
  releasable,
  releaseBasis,
  releaseSelection,
  sampleTrips,
  stageErrors,
  stageNames,
  stageOf,
  TRIP_SIZE,
  type MilitaryDesk,
  type MilitaryItem,
  type PrepEvidence,
  type PrepStage,
} from "@/lib/military-prep";
import { LinkedPhoto, usePublishedPhotos } from "@/components/PhotoLink";

const badge: Record<PrepStage, string> = {
  missing_photo: "",
  rights_checked: "status-changes-requested",
  content_prepared: "status-pending",
  previewed: "status-pending",
  approved: "status-approved",
};
export function StageBadge({ item }: { item: MilitaryItem }) {
  if (item.status === "retired") return <span className="status-badge">Retired</span>;
  const stage = stageOf(item);
  return (
    <span className={`status-badge ${item.preparation?.stale ? "status-changes-requested" : badge[stage]}`}>
      {stageNames[stage]}
      {item.preparation?.stale ? " · prepare again" : ""}
    </span>
  );
}

export type ReleaseAction =
  | { action: "upload"; itemIds: string[]; basis: string }
  | { action: "activate"; release: number }
  | { action: "restore" };

/** The client's Military sheet on the game backend: preparation per question, rank coverage and recorded releases. */
export function MilitaryWorkspace({
  desk,
  sessionKey,
  busy,
  onOpen,
  onSave,
  onRelease,
  onBlocked,
  onOpenMedia,
}: {
  desk: MilitaryDesk;
  sessionKey: string;
  busy: boolean;
  /** Records the version a save will be based on (the draft session keeps it). */
  onOpen: (id: string, version: number) => void;
  onSave: (item: MilitaryItem, stage: PrepStage, evidence: PrepEvidence, mediaId: string | null) => Promise<MilitaryItem | null>;
  onRelease: (step: ReleaseAction) => Promise<boolean>;
  /** A photo read was refused for the account: the workspace stops and clears private data. */
  onBlocked: (status: number) => void;
  /** Opens the Media desk, where a photo is published; absent when this account can't see it. */
  onOpenMedia?: () => void;
}) {
  const items = useMemo(() => [...desk.items].sort((a, b) => compareIds(a.id, b.id)), [desk.items]);
  const report = useMemo(() => readiness(items), [items]);
  const [filter, setFilter] = useState<"all" | PrepStage>("all");
  const [openId, setOpenId] = useState("");
  const [draft, setDraft] = useState<PrepEvidence | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [backTo, setBackTo] = useState<PrepStage | "">("");
  const open = items.find((item) => item.id === openId) ?? null;
  const photos = usePublishedPhotos(sessionKey, onBlocked);
  // The question open now, read after an await: a late answer must never fill another question's form.
  const openRef = useRef("");

  function choose(item: MilitaryItem) {
    openRef.current = item.id;
    setOpenId(item.id);
    onOpen(item.id, item.version);
    setDraft(evidenceOf(item));
    setMediaId(item.mediaId);
    setBackTo("");
  }
  function close() {
    openRef.current = "";
    setOpenId("");
  }
  async function save(next: PrepStage) {
    if (!open || !draft) return;
    const savedId = open.id;
    const updated = await onSave(open, next, draft, mediaId);
    if (updated && updated.id === savedId && openRef.current === savedId) {
      setDraft(evidenceOf(updated));
      setMediaId(updated.mediaId);
      setBackTo("");
    }
  }
  const set = <K extends keyof PrepEvidence>(key: K, value: PrepEvidence[K]) => draft && setDraft({ ...draft, [key]: value });

  const stage: PrepStage = open ? stageOf(open) : "missing_photo";
  const at = prepStages.indexOf(stage);
  const next = prepStages[at + 1] as PrepStage | undefined;
  // From Rights checked on the backend accepts only a published photo. Known only once the whole list has loaded.
  const unpublishedPhoto =
    !!mediaId && photos.complete && !photos.options.some((photo) => photo.id === mediaId);
  const missing =
    next && draft
      ? [
          ...stageErrors(next, draft, mediaId),
          ...(unpublishedPhoto && prepStages.indexOf(next) >= 1
            ? [`Publish ${mediaId} in the Media desk first, or link a published photo.`]
            : []),
        ]
      : [];
  const retired = open?.status === "retired";
  const stale = !!open?.preparation?.stale;
  const locked = stage === "approved" || retired;

  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">LAUNCH PREPARATION</p>
          <h1>Military readiness</h1>
          <p>
            Prepare the {report.total} questions of the client&apos;s Military sheet on the game backend. Approval and
            releases are recorded, not delivered: nothing reaches a player and Military stays Coming Soon.
          </p>
        </div>
        <span className="admin-total">
          {report.approved} / {report.total} approved
        </span>
      </div>

      {items.length === 0 ? (
        <section className="admin-panel detail-placeholder">
          <Target size={28} />
          <b>No Military questions on the game backend</b>
          <p>The client&apos;s Military sheet has not been imported into this backend yet. Run the content import there.</p>
        </section>
      ) : (
        <>
          <section className="admin-panel military-report">
            <div className="admin-panel-header">
              <div>
                <h2>Rank coverage</h2>
                <p>
                  A Trip needs {TRIP_SIZE} different approved questions at or below its rank. This is a preview: the
                  game backend checks whether a release can fill a Trip at every rank.
                </p>
              </div>
            </div>
            <div className="admin-table-scroll">
              <table className="admin-table military-table">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    {prepStages.map((s) => (
                      <th scope="col" key={s}>
                        {stageNames[s]}
                      </th>
                    ))}
                    <th scope="col">Approved and current</th>
                    <th scope="col">Eligible approved</th>
                    <th scope="col">Trip</th>
                  </tr>
                </thead>
                <tbody>
                  {report.ranks.map((r) => (
                    <tr key={r.rank}>
                      <th scope="row">
                        {rankName(r.rank)} <small>{r.slots} in sheet</small>
                      </th>
                      {prepStages.map((s) => (
                        <td key={s}>{r.stages[s]}</td>
                      ))}
                      <td>
                        {desk.ownRankCounts[r.rank]}
                        {r.stale > 0 && <small> · {r.stale} to prepare again</small>}
                      </td>
                      <td>
                        {r.eligibleApproved} / {r.eligibleTotal}
                      </td>
                      <td>
                        {r.tripReady ? (
                          <span className="status-badge status-approved">Ready</span>
                        ) : (
                          <span className="status-badge">{TRIP_SIZE - r.eligibleApproved} short</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <ReleasePanel desk={desk} items={items} busy={busy} onRelease={onRelease} />

          <div className="admin-toolbar content-toolbar">
            <select aria-label="Filter by stage" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="all">All stages</option>
              {prepStages.map((s) => (
                <option key={s} value={s}>
                  {stageNames[s]}
                </option>
              ))}
            </select>
            <span>Ranks, answers and wrong answers come from the client&apos;s sheet. Changes need a new sheet from Josh.</span>
          </div>

          <div className="admin-split content-split">
            <section className={`admin-panel admin-record-list military-roster ${open ? "mobile-hidden" : ""}`}>
              {ranks.map(({ id: rank }) => {
                const rows = items.filter((item) => item.rank === rank && (filter === "all" || stageOf(item) === filter));
                if (!rows.length) return null;
                return (
                  <div key={rank} role="group" aria-label={rankName(rank)}>
                    <div className="military-rank-head">{rankName(rank)}</div>
                    {rows.map((item) => (
                      <button
                        key={item.id}
                        className={`admin-record ${item.id === openId ? "selected" : ""}`}
                        aria-current={item.id === openId ? "true" : undefined}
                        disabled={busy}
                        onClick={() => choose(item)}
                      >
                        <span>
                          <b>{item.data.answer}</b>
                          <small>
                            {item.id} · {item.mediaId ? `photo ${item.mediaId}` : item.data.sourceFile ? "no photo linked" : "photo not supplied"}
                          </small>
                        </span>
                        <StageBadge item={item} />
                      </button>
                    ))}
                  </div>
                );
              })}
            </section>

            {open && draft ? (
              <section className="admin-panel content-editor">
                <div className="content-editor-head">
                  <div>
                    <button className="admin-back" disabled={busy} onClick={close}>
                      <ArrowLeft size={16} /> Close question
                    </button>
                    <p className="eyebrow">
                      {rankName(open.rank).toUpperCase()} · {open.id}
                    </p>
                    <h2>{open.data.answer}</h2>
                    <StageBadge item={open} />
                  </div>
                  <span className="editor-version">Version {open.version}</span>
                </div>
                <ol className="military-stepper" aria-label="Preparation stages">
                  {prepStages.map((s, i) => (
                    <li key={s} className={i < at ? "done" : i === at ? "current" : ""} aria-current={i === at ? "step" : undefined}>
                      {i <= at && <CheckCircle size={14} weight="fill" />}
                      {stageNames[s]}
                    </li>
                  ))}
                </ol>
                {retired ? (
                  <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>This question is retired, so it cannot be prepared.</MessageBarBody>
                  </MessageBar>
                ) : stale ? (
                  <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>
                      {stage === "approved"
                        ? "This question changed after approval (a sheet import, an edit or a new photo link). Step it back to Previewed and preview it again."
                        : "This question changed after it was prepared (a sheet import, an edit or a new photo link). Check it and save to prepare it again."}
                    </MessageBarBody>
                  </MessageBar>
                ) : (
                  stage === "approved" && (
                    <MessageBar intent="success" layout="multiline">
                      <MessageBarBody>
                        Approved. Step back to change this question (to Missing photo if its photo was withdrawn).
                        Approval does not publish or release it.
                      </MessageBarBody>
                    </MessageBar>
                  )
                )}

                <fieldset className="form-grid admin-fieldset" disabled={locked || busy}>
                  <h3 className="military-legend full">Photograph and rights</h3>
                  <p className="field-hint full">
                    {open.data.sourceFile
                      ? `Client photo: ${open.data.sourceFile}${open.data.photographer ? ` · ${open.data.photographer}` : " · no photographer named"}. Upload and publish it in the Media desk, then link it here.`
                      : "The client has not supplied this photograph yet."}
                  </p>
                  <label className="admin-field full">
                    <span>Linked photo</span>
                    <select value={mediaId ?? ""} onChange={(event) => setMediaId(event.target.value || null)}>
                      <option value="">No photo linked</option>
                      {photos.options.map((photo) => (
                        <option key={photo.id} value={photo.id}>
                          {photo.label}
                        </option>
                      ))}
                      {mediaId && !photos.options.some((photo) => photo.id === mediaId) && (
                        <option value={mediaId}>
                          {mediaId} · {photos.complete ? "not published" : "not among the photos listed"}
                        </option>
                      )}
                    </select>
                    <small>
                      {photos.error
                        ? photos.error
                        : photos.loading
                          ? "Loading the published photos…"
                          : photos.options.length
                            ? "From Rights checked on, the linked photo must be published and not the demo account's."
                            : "No published photos yet. Publish one in the Media desk first."}
                    </small>
                  </label>
                  {mediaId && <LinkedPhoto mediaId={mediaId} sessionKey={sessionKey} onBlocked={onBlocked} use="release" />}
                  <label className="admin-field">
                    <span>Photograph source</span>
                    <select
                      value={draft.photoSource}
                      onChange={(event) => set("photoSource", event.target.value as PrepEvidence["photoSource"])}
                    >
                      <option value="">Not chosen</option>
                      <option value="media">The linked photo and its licence</option>
                      <option value="licensed">Separately licensed</option>
                    </select>
                  </label>
                  {draft.photoSource === "licensed" ? (
                    <Field label="License or source (https://)" value={draft.licenseUrl} onChange={(v) => set("licenseUrl", v)} max={600} />
                  ) : (
                    <span />
                  )}
                  <Field label="Attribution" value={draft.attribution} onChange={(v) => set("attribution", v)} />
                  <label className="admin-field full">
                    <span>Permission or license terms</span>
                    <Textarea rows={2} maxLength={2400} value={draft.permission} onChange={(_, item) => set("permission", item.value)} />
                  </label>

                  <h3 className="military-legend full">Question content</h3>
                  <Field
                    label="Identity reference (https://)"
                    value={draft.referenceUrl}
                    onChange={(v) => set("referenceUrl", v)}
                    max={600}
                    full
                  />
                  <div className="admin-field full">
                    <span>From the client&apos;s sheet</span>
                    <dl className="military-client">
                      <dt>Answer</dt>
                      <dd>{open.data.answer}</dd>
                      <dt>Wrong answers</dt>
                      <dd>{open.data.wrong.join(" · ")}</dd>
                    </dl>
                    <p className="field-hint">If an answer looks wrong, note it below for Josh; it is not edited here.</p>
                  </div>

                  <h3 className="military-legend full">Preview checklist</h3>
                  <div className="full military-checklist">
                    {checklistNames.map(({ key, label }) => (
                      <Checkbox
                        key={key}
                        label={label}
                        checked={draft.checklist[key]}
                        onChange={(_, item) => set("checklist", { ...draft.checklist, [key]: item.checked === true })}
                      />
                    ))}
                  </div>
                  <label className="admin-field full">
                    <span>Editorial notes</span>
                    <Textarea rows={2} maxLength={2400} value={draft.notes} onChange={(_, item) => set("notes", item.value)} />
                  </label>
                </fieldset>

                {!retired && next && missing.length > 0 && (
                  <div className="military-missing" role="status">
                    <Target size={16} />
                    <div>
                      <b>Before {stageNames[next]}</b>
                      <ul>
                        {missing.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                      {unpublishedPhoto && onOpenMedia && (
                        <Button size="small" onClick={onOpenMedia}>
                          Open the Media desk
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {!retired && (
                  <div className="admin-actions editor-actions">
                    {!locked && (
                      <Button disabled={busy} onClick={() => void save(stage)}>
                        {busy ? "Saving…" : stale ? "Save and prepare again" : "Save"}
                      </Button>
                    )}
                    {next && (
                      <Button appearance="primary" disabled={busy || missing.length > 0} onClick={() => void save(next)}>
                        {next === "approved" ? "Approve package" : `Mark ${stageNames[next]}`}
                      </Button>
                    )}
                    {at > 0 && (
                      <span className="military-step-back">
                        <select
                          aria-label="Step back to"
                          value={backTo || prepStages[at - 1]}
                          disabled={busy}
                          onChange={(event) => setBackTo(event.target.value as PrepStage)}
                        >
                          {prepStages.slice(0, at).map((s) => (
                            <option key={s} value={s}>
                              {stageNames[s]}
                            </option>
                          ))}
                        </select>
                        <Button appearance="subtle" disabled={busy} onClick={() => void save(backTo || prepStages[at - 1])}>
                          Step back
                        </Button>
                      </span>
                    )}
                  </div>
                )}
                <p className="admin-demo-note">
                  Each save is checked and versioned by the game backend and recorded in its audit log. Approved questions
                  reach a release only when you upload one; releases are not delivered to players.
                </p>
              </section>
            ) : (
              <section className="admin-panel detail-placeholder">
                <Target size={28} />
                <b>Select a question</b>
                <p>Open a row of the client&apos;s sheet to prepare its photograph and rights.</p>
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Recorded releases. The game backend repeats every check (approved and current, a published photo of its own, a Trip
 * at every rank) and refuses a release built on other versions than the previewed ones. Nothing is delivered.
 */
function ReleasePanel({
  desk,
  items,
  busy,
  onRelease,
}: {
  desk: MilitaryDesk;
  items: MilitaryItem[];
  busy: boolean;
  onRelease: (step: ReleaseAction) => Promise<boolean>;
}) {
  const { pointer, releases } = desk;
  const [scope, setScope] = useState<"all" | "ready">("all");
  const chosen = useMemo(() => releaseSelection(items, scope), [items, scope]);
  const basis = releaseBasis(chosen);
  /** Item-level reasons, worded as the backend would; the backend also checks the photos and the Trips. */
  const errors = useMemo(() => {
    const out: string[] = [];
    const photoOwner = new Map<string, string>();
    for (const item of chosen) {
      const label = `${item.id} (${item.data.answer})`;
      if (item.preparation?.stage !== "approved") out.push(`${label}: not approved.`);
      else if (item.preparation.stale) out.push(`${label}: changed since approval; prepare it again.`);
      if (!item.mediaId) out.push(`${label}: no linked photo.`);
      else if (photoOwner.has(item.mediaId)) out.push(`${label}: uses the same photo as ${photoOwner.get(item.mediaId)}.`);
      else photoOwner.set(item.mediaId, item.id);
    }
    return out;
  }, [chosen]);
  const [seed, setSeed] = useState(1);
  const [showTrips, setShowTrips] = useState(false);
  const [reviewed, setReviewed] = useState("");
  const trips = useMemo(() => sampleTrips(chosen, `${basis}#${seed}`), [chosen, basis, seed]);
  const current = releases.find((r) => r.number === pointer.current);
  const previous = pointer.history[pointer.history.length - 1];
  const confirmed = showTrips && reviewed === basis && basis !== "";
  const unchanged = current?.basis === basis;
  // The newest upload that was never made live and is newer than the current release (an older one would step back).
  const candidate = releases.find((r) => r.status === "uploaded" && r.number > (pointer.current ?? 0));
  const ready = items.filter(releasable).length;

  return (
    <section className="admin-panel military-release" aria-labelledby="military-release-title">
      <div className="admin-panel-header">
        <div>
          <h2 id="military-release-title">Releases</h2>
          <p>
            A release freezes the chosen questions with their photos. Uploading records it; making it live moves the
            pointer. Both are recorded, not delivered: no player receives a Military release yet.
          </p>
        </div>
        <span className="status-badge">{current ? `Release ${current.number} current` : "No release yet"}</span>
      </div>
      {current && (
        <p className="military-release-current">
          Release {current.number} · {current.aircraft} questions · {new Date(current.createdAt).toLocaleString()}
          {unchanged ? " · matches the selection below" : " · differs from the selection below"}
        </p>
      )}
      {candidate && (
        <p className="military-release-current">
          Release {candidate.number} uploaded, not live · {candidate.aircraft} questions ·{" "}
          {new Date(candidate.createdAt).toLocaleString()}
        </p>
      )}

      <label className="admin-field military-release-scope">
        <span>Questions in the release</span>
        <select
          value={scope}
          onChange={(event) => {
            setScope(event.target.value as typeof scope);
            setReviewed("");
          }}
        >
          <option value="all">Every question ({items.filter((item) => item.status !== "retired").length})</option>
          <option value="ready">Only approved questions with a photo ({ready})</option>
        </select>
      </label>

      {chosen.length === 0 ? (
        <p className="field-hint">No question is approved, current and photographed yet.</p>
      ) : errors.length > 0 ? (
        <div className="military-missing" role="status">
          <Target size={16} />
          <div>
            <b>Before release</b>
            <ul>
              {errors.slice(0, 6).map((m) => (
                <li key={m}>{m}</li>
              ))}
              {errors.length > 6 && <li>and {errors.length - 6} more.</li>}
            </ul>
          </div>
        </div>
      ) : (
        <p className="military-release-ready">
          <CheckCircle size={16} weight="fill" /> All {chosen.length} chosen questions are approved with their own photos.
          The game backend checks the photos and the Trips again on upload.
        </p>
      )}

      <div className="admin-actions">
        <Button icon={<Package size={16} />} disabled={!chosen.length} aria-expanded={showTrips} onClick={() => setShowTrips(!showTrips)}>
          {showTrips ? "Hide sample Trips" : "Preview sample Trips"}
        </Button>
        {showTrips && (
          <Button
            appearance="subtle"
            icon={<Shuffle size={16} />}
            onClick={() => {
              setSeed(seed + 1);
              setReviewed("");
            }}
          >
            Shuffle samples
          </Button>
        )}
        {candidate && (
          <Button
            appearance="subtle"
            icon={<CheckCircle size={16} />}
            disabled={busy}
            onClick={() => void onRelease({ action: "activate", release: candidate.number })}
          >
            Make release {candidate.number} live
          </Button>
        )}
        {previous !== undefined && (
          <Button
            appearance="subtle"
            icon={<ArrowCounterClockwise size={16} />}
            disabled={busy}
            onClick={() => void onRelease({ action: "restore" })}
          >
            Restore release {previous}
          </Button>
        )}
      </div>

      {showTrips && (
        <div className="military-trips">
          {ranks.map(({ id: rank }) => {
            const trip = trips.find((t) => t.rank === rank);
            return (
              <details key={rank} className="military-trip">
                <summary>
                  {rankName(rank)}{" "}
                  <small>{trip ? `${trip.questions.length} questions` : `No sample: fewer than ${TRIP_SIZE} questions at or below this rank`}</small>
                </summary>
                {trip && (
                  <ol>
                    {trip.questions.map((q) => (
                      <li key={q.id}>
                        <span className="military-trip-nophoto">{q.mediaId ?? "No photo"}</span>
                        <span>
                          <b>{q.answer}</b>
                          <small>{q.options.join(" · ")}</small>
                          <small>{rankName(q.rank)}</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </details>
            );
          })}
        </div>
      )}

      <div className="military-release-confirm">
        <Checkbox
          label="I reviewed the sample Trips for this selection"
          checked={confirmed}
          disabled={!showTrips || !chosen.length}
          onChange={(_, item) => setReviewed(item.checked === true ? basis : "")}
        />
        <Button
          appearance="primary"
          disabled={busy || !chosen.length || errors.length > 0 || !confirmed || unchanged}
          onClick={() =>
            void onRelease({ action: "upload", itemIds: chosen.map((item) => item.id), basis }).then((ok) => ok && setReviewed(""))
          }
        >
          {unchanged ? "Already the current release" : "Upload release"}
        </Button>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  full = false,
  max = 160,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  full?: boolean;
  /** Matches the backend limit for this field. */
  max?: number;
}) {
  return (
    <label className={`admin-field ${full ? "full" : ""}`}>
      <span>{label}</span>
      <Input value={value} maxLength={max} onChange={(_, data) => onChange(data.value)} />
    </label>
  );
}
