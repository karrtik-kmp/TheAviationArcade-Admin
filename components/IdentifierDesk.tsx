"use client";

import { Button, Input, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { ArrowLeft, Target } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { LinkedPhoto, usePublishedPhotos } from "@/components/PhotoLink";
import { ranks, type RankId } from "@/lib/catalog";
import {
  compareIdentifierIds,
  misusedPhotos,
  payloadErrors,
  photoPartners,
  type IdentifierItem,
} from "@/lib/identifier-desk";

export type IdentifierChange =
  | { kind: "edit"; rank: RankId; answer: string; wrong: string[] }
  | { kind: "retire" }
  | { kind: "restore" }
  | { kind: "media"; mediaId: string | null };

type Form = { rank: RankId; answer: string; wrong: string[] };
const formOf = (item: IdentifierItem): Form => ({ rank: item.rank, answer: item.data.answer, wrong: [...item.data.wrong] });
const rankName = (id: RankId) => ranks.find((rank) => rank.id === id)?.name ?? id;

/**
 * The client's Aircraft Identifier sheet on the game backend (content module `identifier`): each question's rank and
 * answers, its linked photo, and whether it is retired. Every write is checked and versioned by the backend.
 */
export function IdentifierDesk({
  items: unsorted,
  sessionKey,
  busy,
  onOpen,
  onChange,
  onBlocked,
  onOpenMedia,
}: {
  items: IdentifierItem[];
  sessionKey: string;
  busy: boolean;
  /** Records the version later writes are based on (the draft session keeps it). */
  onOpen: (id: string, version: number) => void;
  onChange: (item: IdentifierItem, change: IdentifierChange) => Promise<IdentifierItem | null>;
  /** A photo read was refused for the account: the workspace stops and clears private data. */
  onBlocked: (status: number) => void;
  /** Opens the Media desk; absent when this account can't see it. */
  onOpenMedia?: () => void;
}) {
  const items = useMemo(() => [...unsorted].sort((a, b) => compareIdentifierIds(a.id, b.id)), [unsorted]);
  const misused = useMemo(() => misusedPhotos(items), [items]);
  const photos = usePublishedPhotos(sessionKey, onBlocked);
  const [filter, setFilter] = useState<"all" | "no-photo" | "retired">("all");
  const [openId, setOpenId] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  // The question open now, read after an await: a late answer must never fill another question's form.
  const openRef = useRef("");
  const open = items.find((item) => item.id === openId) ?? null;

  function choose(item: IdentifierItem) {
    openRef.current = item.id;
    setOpenId(item.id);
    onOpen(item.id, item.version);
    setForm(formOf(item));
    setPhoto(item.mediaId);
  }
  function close() {
    openRef.current = "";
    setOpenId("");
  }
  /** Sends one change; the form is refreshed only from an answer for the question still open. */
  async function send(change: IdentifierChange) {
    if (!open) return;
    const id = open.id;
    const updated = await onChange(open, change);
    if (!updated || updated.id !== id || openRef.current !== id) return;
    if (change.kind === "edit") setForm(formOf(updated));
    if (change.kind === "media") setPhoto(updated.mediaId);
  }

  const live = items.filter((item) => item.status !== "retired").length;
  const shown = items.filter(
    (item) =>
      filter === "all" ||
      (filter === "retired" ? item.status === "retired" : item.status !== "retired" && !item.mediaId),
  );
  const errors = form ? payloadErrors(form) : [];
  const dirty =
    !!open &&
    !!form &&
    (form.rank !== open.rank || form.answer !== open.data.answer || form.wrong.some((w, i) => w !== open.data.wrong[i]));
  const partners = open ? photoPartners(items, open.id) : [];
  const misusedWith = open?.mediaId ? (misused.get(open.mediaId) ?? []).filter((id) => id !== open.id) : [];
  const retired = open?.status === "retired";

  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">GAME CONTENT</p>
          <h1>Aircraft Identifier</h1>
          <p>
            The questions of the client&apos;s Aircraft Identifier sheet (2026-09-28) on the game backend. Every change is
            recorded with your account. Change a question only to match what Josh supplied.
          </p>
        </div>
        <span className="admin-total">
          {live} questions · {items.filter((item) => item.status !== "retired" && item.mediaId).length} with a photo
        </span>
      </div>

      {items.length === 0 ? (
        <section className="admin-panel detail-placeholder">
          <Target size={28} />
          <b>No Aircraft Identifier questions on the game backend</b>
          <p>The client&apos;s sheet has not been imported into this backend yet. Run the content import there.</p>
        </section>
      ) : (
        <>
          <div className="admin-toolbar content-toolbar">
            <select aria-label="Filter questions" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="all">All questions</option>
              <option value="no-photo">No photo linked</option>
              <option value="retired">Retired</option>
            </select>
            <span>Questions come from the client&apos;s sheet. Two questions can share one client photo (ai-a11 and ai-a11-2).</span>
          </div>

          <div className="admin-split content-split">
            <section className={`admin-panel admin-record-list military-roster ${open ? "mobile-hidden" : ""}`}>
              {ranks.map(({ id: rank, name }) => {
                const rows = shown.filter((item) => item.rank === rank);
                if (!rows.length) return null;
                return (
                  <div key={rank} role="group" aria-label={name}>
                    <div className="military-rank-head">{name}</div>
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
                            {item.id} · {item.mediaId ? `photo ${item.mediaId}` : "no photo linked"}
                            {photoPartners(items, item.id).length > 0 ? " · shares a client photo" : ""}
                          </small>
                        </span>
                        {item.status === "retired" ? (
                          <span className="status-badge">Retired</span>
                        ) : item.mediaId && misused.has(item.mediaId) ? (
                          <span className="status-badge status-changes-requested">Check photo</span>
                        ) : item.mediaId ? (
                          <span className="status-badge status-approved">Photo linked</span>
                        ) : (
                          <span className="status-badge">No photo</span>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </section>

            {open && form ? (
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
                    {retired && <span className="status-badge">Retired</span>}
                  </div>
                  <span className="editor-version">
                    Version {open.version}
                    {open.source === "admin" ? " · changed by staff" : " · as imported"}
                  </span>
                </div>
                {retired && (
                  <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>Retired: kept, but not dealt to players. Restore it to deal it again.</MessageBarBody>
                  </MessageBar>
                )}
                {partners.length > 0 && (
                  <p className="field-hint">
                    Same client photo as {partners.map((item) => item.id).join(", ")}. Link the same photo to both; the two
                    can&apos;t be in one release.
                  </p>
                )}
                {misusedWith.length > 0 && (
                  <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>
                      {open.mediaId} is also linked to {misusedWith.join(", ")}, which is a different client photo. Check
                      which question it belongs to.
                    </MessageBarBody>
                  </MessageBar>
                )}

                <fieldset className="form-grid admin-fieldset" disabled={busy}>
                  <h3 className="military-legend full">Question</h3>
                  <label className="admin-field">
                    <span>Rank</span>
                    <select value={form.rank} onChange={(event) => setForm({ ...form, rank: event.target.value as RankId })}>
                      {ranks.map(({ id, name }) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="admin-field">
                    <span>Client photo file</span>
                    <Input value={open.data.sourceFile || "Not supplied"} readOnly />
                  </label>
                  <label className="admin-field full">
                    <span>Correct answer</span>
                    <Input value={form.answer} maxLength={500} onChange={(_, data) => setForm({ ...form, answer: data.value })} />
                  </label>
                  {form.wrong.map((value, i) => (
                    <label className="admin-field" key={i}>
                      <span>Wrong answer {i + 1}</span>
                      <Input
                        value={value}
                        maxLength={500}
                        onChange={(_, data) => setForm({ ...form, wrong: form.wrong.map((w, j) => (j === i ? data.value : w)) })}
                      />
                    </label>
                  ))}
                </fieldset>
                {dirty && errors.length > 0 && (
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
                <div className="admin-actions editor-actions">
                  <Button
                    appearance="primary"
                    disabled={busy || !dirty || errors.length > 0}
                    onClick={() => void send({ kind: "edit", rank: form.rank, answer: form.answer, wrong: form.wrong })}
                  >
                    {busy ? "Saving…" : "Save question"}
                  </Button>
                  <Button appearance="subtle" disabled={busy || !dirty} onClick={() => setForm(formOf(open))}>
                    Undo changes
                  </Button>
                </div>

                <h3 className="military-legend">Photo</h3>
                <div className="form-grid">
                  <label className="admin-field full">
                    <span>Linked photo</span>
                    <select value={photo ?? ""} disabled={busy} onChange={(event) => setPhoto(event.target.value || null)}>
                      <option value="">No photo linked</option>
                      {photos.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                      {photo && !photos.options.some((option) => option.id === photo) && (
                        <option value={photo}>
                          {photo} · {photos.complete ? "not published" : "not among the photos listed"}
                        </option>
                      )}
                    </select>
                    <small>
                      {photos.error
                        ? photos.error
                        : photos.loading
                          ? "Loading the published photos…"
                          : "Players only ever see a photo's published version."}
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
                  {photo && <LinkedPhoto mediaId={photo} sessionKey={sessionKey} onBlocked={onBlocked} use="players" />}
                </div>
                <div className="admin-actions editor-actions">
                  <Button disabled={busy || photo === open.mediaId} onClick={() => void send({ kind: "media", mediaId: photo })}>
                    {photo ? (open.mediaId ? "Change the linked photo" : "Link this photo") : "Unlink the photo"}
                  </Button>
                  {photo !== open.mediaId && (
                    <Button appearance="subtle" disabled={busy} onClick={() => setPhoto(open.mediaId)}>
                      Keep {open.mediaId ?? "no photo"}
                    </Button>
                  )}
                </div>

                <h3 className="military-legend">Status</h3>
                <div className="admin-actions editor-actions">
                  {retired ? (
                    <Button disabled={busy} onClick={() => void send({ kind: "restore" })}>
                      Restore question
                    </Button>
                  ) : (
                    <Button disabled={busy} onClick={() => void send({ kind: "retire" })}>
                      Retire question
                    </Button>
                  )}
                </div>
                <p className="admin-demo-note">
                  Each change is versioned by the game backend and recorded in its audit log with your account.
                </p>
              </section>
            ) : (
              <section className="admin-panel detail-placeholder">
                <Target size={28} />
                <b>Select a question</b>
                <p>Open a question to check its answers and link its photo.</p>
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}
