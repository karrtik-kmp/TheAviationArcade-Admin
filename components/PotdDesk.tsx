"use client";

import { Button, Input, MessageBar, MessageBarBody, Textarea } from "@fluentui/react-components";
import { ArrowLeft, ImageSquare, Target } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { LinkedPhoto, usePublishedPhotos } from "@/components/PhotoLink";
import { ranks } from "@/lib/catalog";
import { factualSourceText } from "@/lib/dev-waiver";
import {
  comparePotd,
  formOf,
  isDirty,
  photosInUse,
  potdErrors,
  potdFieldLabels,
  potdStatusLabel,
  type PotdData,
  type PotdForm,
  type PotdItem,
  type PotdStatus,
} from "@/lib/potd-desk";

const statuses = Object.keys(potdStatusLabel) as PotdStatus[];
const statusClass: Record<PotdStatus, string> = {
  draft: "",
  scheduled: "status-pending",
  published: "status-published",
  archived: "status-archived",
};
type TextKey = keyof typeof potdFieldLabels;
const textFields: { key: TextKey; label: string; long?: boolean; hint?: string }[] = [
  { key: "title", label: potdFieldLabels.title },
  { key: "aircraft", label: potdFieldLabels.aircraft },
  { key: "photographer", label: potdFieldLabels.photographer },
  { key: "instagram", label: potdFieldLabels.instagram, hint: "Empty, a handle such as @name, or an https link." },
  { key: "credit", label: potdFieldLabels.credit, hint: "Never public. Players see the photo's licence credit." },
  { key: "factualSource", label: potdFieldLabels.factualSource, hint: "An https link. Needed before scheduling or publishing." },
  { key: "description", label: potdFieldLabels.description, long: true, hint: "At least 15 characters before scheduling or publishing." },
  { key: "correctAnswer", label: potdFieldLabels.correctAnswer, hint: "Editorial only; never shown to players." },
];

/**
 * Plane of the Day on the game backend (editorial kind `plane-of-the-day`): drafts made from published photos, their
 * text, and scheduling (`scheduled` with a date). Nothing is prefilled: staff type only what the client supplied. Every
 * save is checked and versioned by the backend.
 */
export function PotdDesk({
  items: unsorted,
  sessionKey,
  busy,
  devDemoWaiver,
  onOpen,
  onSave,
  onCreate,
  onBlocked,
  onOpenMedia,
  initialOpenId,
}: {
  items: PotdItem[];
  sessionKey: string;
  busy: boolean;
  /** Dev Admin only: an empty factual source is allowed when scheduling or publishing (lib/dev-waiver.ts). */
  devDemoWaiver: boolean;
  /** Records the version later saves are based on (the draft session keeps it). */
  onOpen: (id: string, version: number) => void;
  onSave: (item: PotdItem, form: PotdForm) => Promise<PotdItem | null>;
  onCreate: (mediaId: string) => Promise<PotdItem | null>;
  /** A photo read was refused for the account: the workspace stops and clears private data. */
  onBlocked: (status: number) => void;
  /** Opens the Media desk; absent when this account can't see it. */
  onOpenMedia?: () => void;
  /** An item to open on arrival (a draft just made from the Submissions desk); its base version is already recorded. */
  initialOpenId?: string;
}) {
  const items = useMemo(() => [...unsorted].sort(comparePotd), [unsorted]);
  const inUse = useMemo(() => photosInUse(items), [items]);
  const photos = usePublishedPhotos(sessionKey, onBlocked);
  const [filter, setFilter] = useState<"current" | PotdStatus>("current");
  // An arriving item opens at once. The workspace recorded its base version when it made it (see AdminApp `photoActions`).
  const arriving = initialOpenId ? (unsorted.find((each) => each.id === initialOpenId) ?? null) : null;
  const [openId, setOpenId] = useState(arriving?.id ?? "");
  const [form, setForm] = useState<PotdForm | null>(arriving ? formOf(arriving) : null);
  const [newPhoto, setNewPhoto] = useState("");
  // The item open now, read after an await: a late answer must never fill another item's form.
  const openRef = useRef(arriving?.id ?? "");
  const open = items.find((item) => item.id === openId) ?? null;

  function choose(item: PotdItem) {
    openRef.current = item.id;
    setOpenId(item.id);
    onOpen(item.id, item.version);
    setForm(formOf(item));
  }
  function close() {
    openRef.current = "";
    setOpenId("");
  }
  async function save() {
    if (!open || !form) return;
    const id = open.id;
    const updated = await onSave(open, form);
    if (!updated || updated.id !== id || openRef.current !== id) return;
    setForm(formOf(updated));
  }
  async function create() {
    if (!newPhoto) return;
    const created = await onCreate(newPhoto);
    if (!created) return;
    setNewPhoto("");
    choose(created);
  }

  const shown = items.filter((item) => (filter === "current" ? item.status !== "archived" : item.status === filter));
  const errors = form ? potdErrors(form, { devDemoWaiver }) : [];
  const dirty = !!open && !!form && isDirty(open, form);
  const setData = (patch: Partial<PotdData>) => form && setForm({ ...form, data: { ...form.data, ...patch } });
  const scheduledCount = items.filter((item) => item.status === "scheduled").length;
  const activeCount = items.filter((item) => item.status !== "archived").length;
  const sourceText = open ? factualSourceText({ status: open.status, factualSource: open.data.factualSource }) : null;

  const creator = (
    <section className="admin-panel potd-create">
      <h2>New draft from a published photo</h2>
      <div className="form-grid">
        <label className="admin-field full">
          <span>Published photo</span>
          <select value={newPhoto} disabled={busy || photos.loading} onChange={(event) => setNewPhoto(event.target.value)}>
            <option value="">{photos.loading ? "Loading the published photos…" : "Choose a photo"}</option>
            {photos.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
                {inUse.has(option.id) ? " · already has an item" : ""}
              </option>
            ))}
          </select>
          <small>
            {photos.error ||
              (!photos.loading && photos.options.length === 0
                ? "No published photos yet. Publish one in the Media desk first."
                : "The photo is fixed for the item's life. Nothing is filled in from it.")}
            {onOpenMedia && (
              <>
                {" "}
                <button type="button" className="admin-text-button" onClick={onOpenMedia}>
                  Open the Media desk
                </button>
              </>
            )}
          </small>
        </label>
        {newPhoto && <LinkedPhoto mediaId={newPhoto} sessionKey={sessionKey} onBlocked={onBlocked} use="players" subject="feature" />}
      </div>
      <div className="admin-actions editor-actions">
        <Button appearance="primary" disabled={busy || !newPhoto} onClick={() => void create()}>
          {busy ? "Creating…" : "Create draft"}
        </Button>
      </div>
    </section>
  );

  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">DAILY EXPERIENCE</p>
          <h1>Plane of the Day</h1>
          <p>
            Plane of the Day items on the game backend. Each one shows a published photo on its date. Every change is
            recorded with your account.
          </p>
        </div>
        <span className="admin-total">
          {activeCount} {activeCount === 1 ? "item" : "items"} · {scheduledCount} scheduled
        </span>
      </div>

      {items.length === 0 ? (
        <>
          <section className="admin-panel detail-placeholder">
            <ImageSquare size={28} />
            <b>No Plane of the Day drafts yet</b>
            <p>Publish their photos in the Media desk, then run the content seed again.</p>
          </section>
          {creator}
        </>
      ) : (
        <>
          <div className="admin-toolbar content-toolbar">
            <select aria-label="Filter items" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="current">All but archived</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {potdStatusLabel[status]}
                </option>
              ))}
            </select>
            <span>Scheduled and published items are listed by date. Several items may share a date.</span>
          </div>

          <div className="admin-split content-split">
            <section className={`admin-panel admin-record-list ${open ? "mobile-hidden" : ""}`}>
              {shown.length === 0 && (
                <div className="admin-empty">
                  <ImageSquare size={25} />
                  <b>Nothing here</b>
                  <span>No items have this status.</span>
                </div>
              )}
              {shown.map((item) => (
                <button
                  key={item.id}
                  className={`admin-record ${item.id === openId ? "selected" : ""}`}
                  aria-current={item.id === openId ? "true" : undefined}
                  disabled={busy}
                  onClick={() => choose(item)}
                >
                  <span>
                    <b>{item.data.title.trim() || "Untitled"}</b>
                    <small>
                      {item.id} · photo {item.mediaId}
                      {item.dateKey ? ` · ${item.dateKey}` : ""}
                    </small>
                  </span>
                  <span className={`status-badge ${statusClass[item.status]}`}>{potdStatusLabel[item.status]}</span>
                </button>
              ))}
            </section>

            {open && form ? (
              <section className="admin-panel content-editor">
                <div className="content-editor-head">
                  <div>
                    <button className="admin-back" disabled={busy} onClick={close}>
                      <ArrowLeft size={16} /> Close item
                    </button>
                    <p className="eyebrow">
                      {open.id} · PHOTO {open.mediaId}
                    </p>
                    <h2>{open.data.title.trim() || "Untitled"}</h2>
                    <span className={`status-badge ${statusClass[open.status]}`}>{potdStatusLabel[open.status]}</span>
                  </div>
                  <span className="editor-version">Version {open.version}</span>
                </div>
                {sourceText && open.data.factualSource.trim() === "" && (
                  <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>{sourceText}</MessageBarBody>
                  </MessageBar>
                )}

                <LinkedPhoto mediaId={open.mediaId} sessionKey={sessionKey} onBlocked={onBlocked} use="players" subject="feature" />

                <fieldset className="form-grid admin-fieldset" disabled={busy}>
                  <h3 className="military-legend full">Schedule</h3>
                  <label className="admin-field">
                    <span>Status</span>
                    <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as PotdStatus })}>
                      {statuses.map((status) => (
                        <option key={status} value={status}>
                          {potdStatusLabel[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="admin-field">
                    <span>Date</span>
                    <Input type="date" value={form.dateKey} onChange={(_, data) => setForm({ ...form, dateKey: data.value })} />
                  </label>

                  <h3 className="military-legend full">Feature</h3>
                  {textFields.map(({ key, label, long, hint }) => (
                    <label className={`admin-field ${long || key === "factualSource" ? "full" : ""}`} key={key}>
                      <span>{label}</span>
                      {long ? (
                        <Textarea value={form.data[key]} resize="vertical" onChange={(_, data) => setData({ [key]: data.value })} />
                      ) : (
                        <Input value={form.data[key]} onChange={(_, data) => setData({ [key]: data.value })} />
                      )}
                      {hint && <small>{hint}</small>}
                    </label>
                  ))}
                  {form.data.distractors.map((value, i) => (
                    <label className="admin-field" key={`distractor-${i}`}>
                      <span>Distractor {i + 1}</span>
                      <Input
                        value={value}
                        onChange={(_, data) =>
                          setData({ distractors: form.data.distractors.map((each, j) => (j === i ? data.value : each)) })
                        }
                      />
                    </label>
                  ))}
                  <label className="admin-field">
                    <span>Difficulty</span>
                    <select value={form.data.difficulty} onChange={(event) => setData({ difficulty: event.target.value })}>
                      <option value="">None</option>
                      {ranks.map(({ id, name }) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                </fieldset>

                {(dirty || form.status === "scheduled" || form.status === "published") && errors.length > 0 && (
                  <div className="military-missing" role="status">
                    <Target size={16} />
                    <div>
                      <b>Before saving</b>
                      <ul>
                        {errors.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                {devDemoWaiver && (form.status === "scheduled" || form.status === "published") && !form.data.factualSource.trim() && (
                  <p className="field-hint">Dev demo: this item may go live without a factual source. It will read &quot;No source (dev demo)&quot;.</p>
                )}
                <div className="admin-actions editor-actions">
                  <Button appearance="primary" disabled={busy || !dirty || errors.length > 0} onClick={() => void save()}>
                    {busy ? "Saving…" : "Save item"}
                  </Button>
                  <Button appearance="subtle" disabled={busy || !dirty} onClick={() => setForm(formOf(open))}>
                    Undo changes
                  </Button>
                </div>
                <p className="admin-demo-note">
                  The backend checks the photo again on every scheduled or published save: it must still be published with a
                  licence credit. Each change is versioned and recorded in its audit log with your account.
                </p>
              </section>
            ) : (
              <section className="admin-panel detail-placeholder">
                <ImageSquare size={28} />
                <b>Select an item</b>
                <p>Open an item to write its text and schedule it.</p>
              </section>
            )}
          </div>
          {creator}
        </>
      )}
    </>
  );
}
