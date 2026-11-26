"use client";

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  MessageBar,
  MessageBarBody,
  Textarea,
} from "@fluentui/react-components";
import { ArrowClockwise, ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FaqAnswer } from "@/components/FaqAnswer";
import type { ReactNode } from "react";
import {
  canAddCategory,
  canAddEntry,
  faqChanges,
  faqHostKind,
  faqLimits,
  faqTextError,
  movedText,
  newFaqId,
  normaliseFaqText,
  allEntryIds,
  type FaqDoc,
  type FaqHost,
  type FaqOp,
  type FaqResult,
  type FaqSource,
  type FaqState,
} from "@/lib/faq-desk";

/**
 * The FAQ desk (website docs/briefs/faq-cms-plan.md, "Admin"): staff edit a draft of categories and questions, one
 * operation per change, preview the answers, and publish. Josh edits on the dev Admin; the published FAQ is then
 * downloaded there and loaded into the live Admin's draft. A 409 keeps what was typed and reloads; nothing is resent.
 * The demo admin sees an empty, explained desk with every control disabled. Waits on Backend 0.33.0 for its source.
 */

type Notice = { kind: "error" | "success"; text: string } | null;
/**
 * An edit in progress. `seen` is the item's text when the editor opened: if the draft's copy differs at save time,
 * someone else changed it, and the desk shows theirs and asks before replacing it (never a silent overwrite).
 */
type Editing =
  | { kind: "category"; id: string | null; title: string; seen: string | null; theirs?: string | null }
  | {
      kind: "entry";
      categoryId: string;
      id: string | null;
      question: string;
      answer: string;
      seen: { question: string; answer: string } | null;
      theirs?: { question: string; answer: string } | null;
    };
type Ask =
  | { kind: "removeCategory"; id: string; title: string; opener: string }
  | { kind: "removeEntry"; categoryId: string; id: string; question: string; opener: string }
  | { kind: "publish"; changes: string[]; opener: string }
  | { kind: "discard"; changes: string[]; opener: string }
  | { kind: "import"; text: string; changes: string[]; unpublished: number; opener: string };

const hostText: Record<FaqHost, string> = {
  dev: "Dev Admin: Josh edits and publishes here, then the FAQ is copied to live.",
  live: "Live Admin: publishing here changes the public website. Load the FAQ from dev rather than editing here.",
  local: "Local Admin (this computer): a test copy.",
};

/**
 * The answer as the website shows it: `FaqAnswer` and `lib/faq-answer.ts` are byte-identical copies of the website's
 * (website `4421f57`); change them only together with the website. Site-path links in this preview point at the
 * Admin's own host, so they don't open the website page.
 */
function AnswerPreview({ text }: { text: string }) {
  if (!normaliseFaqText(text)) return <p className="faq-desk-muted">Nothing to preview yet.</p>;
  return <FaqAnswer answer={text} />;
}

function Counter({ id, text, limit }: { id: string; text: string; limit: number }) {
  return (
    <small className="field-hint" id={id}>
      {[...normaliseFaqText(text)].length} of {limit} characters.
    </small>
  );
}

export function FaqDesk({
  source,
  readOnly,
  onBlocked,
}: {
  /** null until the Backend's FAQ routes are vendored (0.33.0): the desk explains and stays empty. */
  source: FaqSource | null;
  /** The shared demo account: an explained, empty desk; nothing is read or written. */
  readOnly: boolean;
  /** The workspace's account fence. */
  onBlocked: (status: number) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const [host, setHost] = useState<FaqHost | null>(null);
  const [state, setState] = useState<FaqState | null>(null);
  const [load, setLoad] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [view, setView] = useState<"draft" | "live">("draft");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [fieldError, setFieldError] = useState<Partial<Record<"title" | "question" | "answer", string>>>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const [announce, setAnnounce] = useState("");
  // Alternates an invisible mark, so the same announcement twice in a row is still a change the region reads.
  const announceTick = useRef(false);
  const say = (text: string) => {
    announceTick.current = !announceTick.current;
    setAnnounce(announceTick.current ? text : `${text}\u200b`);
  };
  const generation = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** After a render: focus this control (by `data-focus`), or the notice. */
  const focusNext = useRef<string | null>(null);

  // The host is read after mount, so the server render and the first client render match.
  useEffect(() => {
    const start = setTimeout(() => setHost(faqHostKind(window.location.hostname)), 0);
    return () => clearTimeout(start);
  }, []);

  const reload = useCallback(async () => {
    if (!source || readOnly) return;
    const mine = ++generation.current;
    setLoad("loading");
    const result = await source.load();
    if (mine !== generation.current || result.kind === "stale") return;
    if (result.kind === "blocked") return onBlocked(result.status);
    if (result.kind === "ok") {
      setState(result.value);
      setLoad("ready");
    } else {
      setLoad("error");
      setNotice({ kind: "error", text: result.kind === "conflict" ? result.message : result.message || "The FAQ couldn't be loaded." });
    }
  }, [source, readOnly, onBlocked]);

  useEffect(() => {
    const start = setTimeout(() => void reload(), 0);
    return () => {
      clearTimeout(start);
      generation.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === "notice") return noticeRef.current?.focus();
    const button = rootRef.current?.querySelector<HTMLElement>(`[data-focus="${CSS.escape(target)}"]`);
    if (button && !(button as HTMLButtonElement).disabled) button.focus();
    else if (target.endsWith(":up") || target.endsWith(":down")) {
      // The moved item's same button became disabled (it reached an end): use its other one.
      const other = target.endsWith(":up") ? target.replace(/:up$/, ":down") : target.replace(/:down$/, ":up");
      rootRef.current?.querySelector<HTMLElement>(`[data-focus="${CSS.escape(other)}"]`)?.focus();
    } else headingRef.current?.focus();
  });

  /** Handles a write's answer. On a conflict the typed text stays in the editor and the draft is reloaded. */
  async function settle<T>(result: FaqResult<T>, mine: number, onOk: (value: T) => void): Promise<boolean> {
    if (mine !== generation.current || result.kind === "stale") return false;
    if (result.kind === "blocked") {
      onBlocked(result.status);
      return false;
    }
    if (result.kind === "ok") {
      onOk(result.value);
      return true;
    }
    focusNext.current = "notice";
    if (result.kind === "conflict") {
      setNotice({
        kind: "error",
        text: "Someone changed the FAQ first. The latest draft is loaded below; anything you were typing is still in the editor. Check it, then save again or cancel.",
      });
      await reload();
    } else
      setNotice({
        kind: "error",
        text: result.kind === "inactive" ? result.message : [result.message, ...result.errors].filter(Boolean).join(" "),
      });
    return false;
  }

  async function send(op: FaqOp, after: { focus?: string; announce?: string; success?: string }) {
    if (!source || !state || busy) return false;
    const mine = ++generation.current;
    setBusy(true);
    let result: FaqResult<FaqState>;
    try {
      result = await source.change(op, state.draftVersion);
    } finally {
      setBusy(false);
    }
    return settle(result, mine, (next) => {
      setState(next);
      if (after.focus) focusNext.current = after.focus;
      if (after.announce) say(after.announce);
      if (after.success) setNotice({ kind: "success", text: after.success });
    });
  }

  const draft = state?.draft ?? null;
  const locked = readOnly || !source || !state || busy || editing !== null || ask !== null;

  function moveCategory(id: string, by: -1 | 1) {
    if (!draft) return;
    const from = draft.categories.findIndex((category) => category.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= draft.categories.length) return;
    setNotice(null);
    void send({ op: "moveCategory", id, to }, { focus: `cat:${id}:${by < 0 ? "up" : "down"}`, announce: movedText(to + 1, draft.categories.length) });
  }
  function moveEntry(categoryId: string, id: string, by: -1 | 1) {
    const category = draft?.categories.find((each) => each.id === categoryId);
    if (!category) return;
    const from = category.entries.findIndex((entry) => entry.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= category.entries.length) return;
    setNotice(null);
    void send(
      { op: "moveEntry", categoryId, id, to },
      { focus: `entry:${id}:${by < 0 ? "up" : "down"}`, announce: movedText(to + 1, category.entries.length) },
    );
  }

  async function saveEditing(replace = false) {
    if (!editing || !draft) return;
    if (editing.kind === "category") {
      const current = editing.id ? (draft.categories.find((category) => category.id === editing.id)?.title ?? null) : null;
      if (!replace && editing.id && current !== editing.seen) {
        focusNext.current = "theirs";
        return setEditing({ ...editing, theirs: current });
      }
      const problem = faqTextError(editing.title, "title");
      setFieldError({ title: problem });
      if (problem) return document.getElementById(`${uid}-title`)?.focus();
      const id = editing.id ?? newFaqId(editing.title, draft.categories.map((category) => category.id));
      const done = await send(
        { op: "upsertCategory", id, title: editing.title },
        { focus: `cat:${id}:edit`, success: editing.id ? "Category renamed in the draft." : "Category added to the draft." },
      );
      if (done) setEditing(null);
      return;
    }
    const category = draft.categories.find((each) => each.id === editing.categoryId);
    if (!category) {
      // Its category is gone too: a question can't be added back on its own.
      if (replace) {
        setFieldError({ question: "Its category was removed. Copy your text, cancel, and add it to another category." });
        return document.getElementById(`${uid}-question`)?.focus();
      }
      focusNext.current = "theirs";
      return setEditing({ ...editing, theirs: null });
    }
    const found = editing.id ? category.entries.find((entry) => entry.id === editing.id) : undefined;
    const current = found ? { question: found.question, answer: found.answer } : null;
    const changed = editing.id && (current?.question !== editing.seen?.question || current?.answer !== editing.seen?.answer);
    if (!replace && changed) {
      focusNext.current = "theirs";
      return setEditing({ ...editing, theirs: current });
    }
    const question = faqTextError(editing.question, "question");
    const answer = faqTextError(editing.answer, "answer");
    setFieldError({ question, answer });
    if (question || answer) return document.getElementById(`${uid}-${question ? "question" : "answer"}`)?.focus();
    const id = editing.id ?? newFaqId(editing.question, allEntryIds(draft));
    const done = await send(
      { op: "upsertEntry", categoryId: editing.categoryId, id, question: editing.question, answer: editing.answer },
      { focus: `entry:${id}:edit`, success: editing.id ? "Question saved in the draft." : "Question added to the draft." },
    );
    if (done) setEditing(null);
  }

  function cancelEditing() {
    if (!editing) return;
    focusNext.current = editing.id ? `${editing.kind === "category" ? "cat" : "entry"}:${editing.id}:edit` : editing.kind === "category" ? "add-category" : `add-entry:${editing.categoryId}`;
    setEditing(null);
    setFieldError({});
  }

  async function confirmAsk() {
    if (!ask || !source || !state) return;
    const opener = ask.opener;
    if (ask.kind === "removeCategory" || ask.kind === "removeEntry") {
      const op: FaqOp = ask.kind === "removeCategory" ? { op: "removeCategory", id: ask.id } : { op: "removeEntry", categoryId: ask.categoryId, id: ask.id };
      const success = ask.kind === "removeCategory" ? `"${ask.title}" was removed from the draft.` : "The question was removed from the draft.";
      setAsk(null);
      // The removed item's buttons are gone: the notice takes focus either way.
      await send(op, { focus: "notice", success });
      return;
    }
    const mine = ++generation.current;
    setBusy(true);
    let result: FaqResult<FaqState>;
    try {
      result =
        ask.kind === "publish"
          ? await source.publish(state.draftVersion)
          : ask.kind === "discard"
            ? await source.discard(state.draftVersion)
            : await source.importFromDev(ask.text, state.draftVersion);
    } finally {
      setBusy(false);
    }
    const kind = ask.kind;
    setAsk(null);
    const ok = await settle(result, mine, (next) => {
      setState(next);
      setNotice({
        kind: "success",
        text:
          kind === "publish"
            ? "The FAQ was published."
            : kind === "discard"
              ? "The draft was discarded; it matches what is live again."
              : "The FAQ from dev is in the draft. Check the changes, then publish.",
      });
      focusNext.current = "notice";
    });
    // A refusal or conflict leaves focus on its notice (the reload may have used the first request); a blocked or
    // stale answer goes back to the control that opened the dialog.
    if (!ok) focusNext.current = result.kind === "blocked" || result.kind === "stale" ? opener : "notice";
  }

  async function downloadForLive() {
    if (!source || busy) return;
    const mine = ++generation.current;
    setBusy(true);
    let result: FaqResult<{ fileName: string; text: string }>;
    try {
      result = await source.exportForLive();
    } finally {
      setBusy(false);
    }
    await settle(result, mine, ({ fileName, text }) => {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice({ kind: "success", text: `${fileName} was saved. Load it in the live Admin's FAQ desk.` });
    });
  }

  async function pickImport(file: File | undefined) {
    if (!file || !source || !state) return;
    if (file.size > 1024 * 1024) {
      focusNext.current = "notice";
      return setNotice({ kind: "error", text: "That file is too large to be an FAQ from dev." });
    }
    const text = await file.text();
    const incoming = source.readImport(text);
    if (!incoming) {
      focusNext.current = "notice";
      return setNotice({ kind: "error", text: "That file isn't an FAQ downloaded from the dev Admin." });
    }
    setAsk({
      kind: "import",
      text,
      changes: faqChanges(state.live, incoming),
      unpublished: faqChanges(state.live, state.draft).length,
      opener: "load-from-dev",
    });
  }

  // Focus goes back to the control that opened a dialog when it closes without a result.
  function closeAsk() {
    if (ask) focusNext.current = ask.opener;
    setAsk(null);
  }

  const changes = state ? faqChanges(state.live, state.draft) : [];
  // An edit whose item another editor removed: it has nowhere to show in the list, so it shows on its own.
  const orphan =
    !!editing &&
    !!draft &&
    editing.id !== null &&
    (editing.kind === "category"
      ? !draft.categories.some((category) => category.id === editing.id)
      : !draft.categories.find((category) => category.id === editing.categoryId)?.entries.some((entry) => entry.id === editing.id));
  const shown: FaqDoc | null = view === "draft" ? draft : (state?.live ?? null);

  let body: ReactNode;
  if (readOnly)
    body = (
      <div className="admin-empty">
        <b>The FAQ is edited by staff</b>
        <p>The demo account can&apos;t see or change the FAQ. Staff edit it here on the dev Admin, then copy it to live.</p>
      </div>
    );
  else if (!source)
    body = (
      <div className="admin-empty">
        <b>The FAQ desk isn&apos;t connected yet</b>
        <p>It needs the game backend&apos;s FAQ routes (API 0.33.0). Until then nothing can be read or saved here.</p>
      </div>
    );
  else if (load === "loading" && !state)
    body = (
      <div className="admin-empty">
        <b>Loading the FAQ…</b>
      </div>
    );
  else if (!state)
    body = (
      <div className="admin-actions">
        <Button appearance="primary" icon={<ArrowClockwise />} onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  else
    body = (
      <>
        <div className="media-desk-views" role="group" aria-label="Show">
          {(["draft", "live"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              className={`media-desk-view ${view === key ? "active" : ""}`}
              onClick={() => setView(key)}
            >
              {key === "draft" ? "Draft" : "Live now"}
            </button>
          ))}
        </div>
        <p className="faq-desk-muted">
          {view === "draft"
            ? changes.length
              ? `${changes.length} change${changes.length === 1 ? "" : "s"} not yet published.`
              : "The draft matches what is live."
            : state.liveVersion
              ? `Version ${state.liveVersion}${state.livePublishedAt ? `, published ${new Date(state.livePublishedAt).toLocaleString()}` : ""}.`
              : "Nothing is published yet; the website shows its “coming soon” page."}
        </p>

        {view === "draft" && orphan && (
          <section className="admin-panel faq-desk-category" aria-label="An edit whose item was removed">
            <p className="faq-desk-muted">
              {editing?.kind === "category"
                ? "Someone else removed this category. Your typing is kept below; save to add it back, or cancel."
                : "Someone else removed this question or its category. Your typing is kept below; save to add it back, or cancel."}
            </p>
            {editing?.kind === "category" ? renderCategoryEditor() : renderEntryEditor()}
          </section>
        )}

        {shown && shown.categories.length === 0 && (
          <div className="admin-empty">
            <b>{view === "draft" ? "No categories yet" : "Nothing is live"}</b>
            {view === "draft" && <p>Add a category, then its questions. Enter only the client&apos;s text.</p>}
          </div>
        )}

        {shown?.categories.map((category, ci) => {
          const editingThis = view === "draft" && editing?.kind === "category" && editing.id === category.id;
          return (
            <section key={category.id} className="admin-panel faq-desk-category" aria-labelledby={`${uid}-cat-${category.id}`}>
              <div className="admin-panel-header">
                <h2 id={`${uid}-cat-${category.id}`}>{category.title}</h2>
                {view === "draft" && !editingThis && (
                  <div className="admin-actions">
                    <Button size="small" data-focus={`cat:${category.id}:edit`} disabled={locked} onClick={() => setEditing({ kind: "category", id: category.id, title: category.title, seen: category.title })} aria-label={`Rename the category ${category.title}`}>
                      Rename
                    </Button>
                    <Button size="small" icon={<ArrowUp />} data-focus={`cat:${category.id}:up`} disabled={locked || ci === 0} onClick={() => moveCategory(category.id, -1)} aria-label={`Move the category ${category.title} up`} />
                    <Button size="small" icon={<ArrowDown />} data-focus={`cat:${category.id}:down`} disabled={locked || ci === shown.categories.length - 1} onClick={() => moveCategory(category.id, 1)} aria-label={`Move the category ${category.title} down`} />
                    <Button size="small" data-focus={`cat:${category.id}:remove`} disabled={locked} onClick={() => setAsk({ kind: "removeCategory", id: category.id, title: category.title, opener: `cat:${category.id}:remove` })} aria-label={`Remove the category ${category.title}`}>
                      Remove
                    </Button>
                  </div>
                )}
              </div>
              {editingThis && renderCategoryEditor()}

              <ol className="faq-desk-entries">
                {category.entries.map((entry, ei) => {
                  const editingEntry = view === "draft" && editing?.kind === "entry" && editing.id === entry.id;
                  return (
                    <li key={entry.id} className="faq-desk-entry">
                      {editingEntry ? (
                        renderEntryEditor()
                      ) : (
                        <>
                          <h3>{entry.question}</h3>
                          <div className="faq-desk-answer">
                            <AnswerPreview text={entry.answer} />
                          </div>
                          {view === "draft" && (
                            <div className="admin-actions">
                              <Button size="small" data-focus={`entry:${entry.id}:edit`} disabled={locked} onClick={() => setEditing({ kind: "entry", categoryId: category.id, id: entry.id, question: entry.question, answer: entry.answer, seen: { question: entry.question, answer: entry.answer } })} aria-label={`Edit: ${entry.question}`}>
                                Edit
                              </Button>
                              <Button size="small" icon={<ArrowUp />} data-focus={`entry:${entry.id}:up`} disabled={locked || ei === 0} onClick={() => moveEntry(category.id, entry.id, -1)} aria-label={`Move up: ${entry.question}`} />
                              <Button size="small" icon={<ArrowDown />} data-focus={`entry:${entry.id}:down`} disabled={locked || ei === category.entries.length - 1} onClick={() => moveEntry(category.id, entry.id, 1)} aria-label={`Move down: ${entry.question}`} />
                              <Button size="small" data-focus={`entry:${entry.id}:remove`} disabled={locked} onClick={() => setAsk({ kind: "removeEntry", categoryId: category.id, id: entry.id, question: entry.question, opener: `entry:${entry.id}:remove` })} aria-label={`Remove: ${entry.question}`}>
                                Remove
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
              {view === "draft" &&
                (editing?.kind === "entry" && editing.id === null && editing.categoryId === category.id ? (
                  renderEntryEditor()
                ) : (
                  <Button data-focus={`add-entry:${category.id}`} disabled={locked || !canAddEntry(shown)} onClick={() => setEditing({ kind: "entry", categoryId: category.id, id: null, question: "", answer: "", seen: null })} aria-label={`Add a question to ${category.title}`}>
                    Add a question
                  </Button>
                ))}
            </section>
          );
        })}

        {view === "draft" &&
          (editing?.kind === "category" && editing.id === null ? (
            <section className="admin-panel faq-desk-category">{renderCategoryEditor()}</section>
          ) : (
            <div className="admin-actions">
              <Button data-focus="add-category" disabled={locked || !canAddCategory(state.draft)} onClick={() => setEditing({ kind: "category", id: null, title: "", seen: null })}>
                Add a category
              </Button>
            </div>
          ))}
      </>
    );

  function renderCategoryEditor() {
    if (editing?.kind !== "category") return null;
    return (
      <div className="faq-desk-editor" role="group" aria-label={editing.id ? "Rename the category" : "New category"}>
        <div className="admin-field full">
          <label htmlFor={`${uid}-title`}>
            <span>Category title</span>
          </label>
          <Input
            id={`${uid}-title`}
            value={editing.title}
            autoFocus
            aria-invalid={!!fieldError.title}
            aria-describedby={[`${uid}-title-count`, fieldError.title ? `${uid}-title-error` : ""].filter(Boolean).join(" ")}
            onChange={(_, data) => setEditing({ ...editing, title: data.value })}
          />
          <Counter id={`${uid}-title-count`} text={editing.title} limit={faqLimits.title} />
          {fieldError.title && (
            <span className="media-desk-error" id={`${uid}-title-error`}>
              {fieldError.title}
            </span>
          )}
        </div>
        {renderTheirs()}
        <div className="admin-actions">
          <Button appearance="primary" disabled={busy} onClick={() => void saveEditing(editing.theirs !== undefined)}>
            {busy ? "Saving…" : editing.theirs !== undefined ? "Replace with mine" : "Save to the draft"}
          </Button>
          <Button disabled={busy} onClick={cancelEditing}>
            {editing.theirs !== undefined ? "Keep theirs" : "Cancel"}
          </Button>
        </div>
      </div>
    );
  }

  /** Another editor's copy of the item being edited, shown before anything replaces it. */
  function renderTheirs() {
    if (!editing || editing.theirs === undefined) return null;
    const theirs = editing.theirs;
    return (
      <div className="faq-desk-theirs" role="group" aria-labelledby={`${uid}-theirs`} tabIndex={-1} data-focus="theirs">
        <p id={`${uid}-theirs`}>
          <b>
            {theirs === null
              ? "Someone else removed this. Saving adds yours back."
              : "Someone else changed this while you were editing. Their version is below; saving replaces it with yours."}
          </b>
        </p>
        {theirs !== null && typeof theirs === "string" && <p>{theirs}</p>}
        {theirs !== null && typeof theirs === "object" && (
          <>
            <h3>{theirs.question}</h3>
            <AnswerPreview text={theirs.answer} />
          </>
        )}
      </div>
    );
  }

  function renderEntryEditor() {
    if (editing?.kind !== "entry") return null;
    return (
      <div className="faq-desk-editor" role="group" aria-label={editing.id ? "Edit the question" : "New question"}>
        <div className="admin-field full">
          <label htmlFor={`${uid}-question`}>
            <span>Question</span>
          </label>
          <Input
            id={`${uid}-question`}
            value={editing.question}
            autoFocus
            aria-invalid={!!fieldError.question}
            aria-describedby={[`${uid}-question-count`, fieldError.question ? `${uid}-question-error` : ""].filter(Boolean).join(" ")}
            onChange={(_, data) => setEditing({ ...editing, question: data.value })}
          />
          <Counter id={`${uid}-question-count`} text={editing.question} limit={faqLimits.question} />
          {fieldError.question && (
            <span className="media-desk-error" id={`${uid}-question-error`}>
              {fieldError.question}
            </span>
          )}
        </div>
        <div className="admin-field full">
          <label htmlFor={`${uid}-answer`}>
            <span>Answer</span>
          </label>
          <Textarea
            id={`${uid}-answer`}
            rows={6}
            value={editing.answer}
            aria-invalid={!!fieldError.answer}
            aria-describedby={[`${uid}-answer-hint`, fieldError.answer ? `${uid}-answer-error` : ""].filter(Boolean).join(" ")}
            onChange={(_, data) => setEditing({ ...editing, answer: data.value })}
          />
          <small className="field-hint" id={`${uid}-answer-hint`}>
            Plain text. A blank line starts a new paragraph; https:// links and site paths such as /privacy become links. {[...normaliseFaqText(editing.answer)].length} of {faqLimits.answer} characters.
          </small>
          {fieldError.answer && (
            <span className="media-desk-error" id={`${uid}-answer-error`}>
              {fieldError.answer}
            </span>
          )}
        </div>
        <div className="faq-desk-preview" aria-label="Preview of the answer">
          <p className="eyebrow">PREVIEW</p>
          <AnswerPreview text={editing.answer} />
        </div>
        {renderTheirs()}
        <div className="admin-actions">
          <Button appearance="primary" disabled={busy} onClick={() => void saveEditing(editing.theirs !== undefined)}>
            {busy ? "Saving…" : editing.theirs !== undefined ? "Replace with mine" : "Save to the draft"}
          </Button>
          <Button disabled={busy} onClick={cancelEditing}>
            {editing.theirs !== undefined ? "Keep theirs" : "Cancel"}
          </Button>
        </div>
      </div>
    );
  }

  const askTitle =
    ask?.kind === "removeCategory"
      ? `Remove "${ask.title}"?`
      : ask?.kind === "removeEntry"
        ? "Remove this question?"
        : ask?.kind === "publish"
          ? host === "live"
            ? "Publish the FAQ on the live website?"
            : "Publish the FAQ?"
          : ask?.kind === "discard"
            ? "Discard the draft?"
            : "Load the FAQ from dev into the draft?";

  return (
    <div ref={rootRef}>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">WEBSITE</p>
          <h1 ref={headingRef} tabIndex={-1} data-focus="heading">
            FAQ
          </h1>
          <p>Questions and answers on the website&apos;s FAQ page. Edit the draft, check the preview, then publish.</p>
        </div>
        <div className="admin-heading-actions">
          <Button icon={<ArrowClockwise />} disabled={locked} onClick={() => void reload()}>
            Reload
          </Button>
        </div>
      </div>

      {host && (
        <p className={`faq-desk-host faq-desk-host-${host}`} role="note">
          {hostText[host]}
        </p>
      )}

      <div ref={noticeRef} tabIndex={-1} role={notice?.kind === "error" ? "alert" : "status"}>
        {notice && (
          <MessageBar intent={notice.kind}>
            <MessageBarBody>{notice.text}</MessageBarBody>
          </MessageBar>
        )}
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>

      {!readOnly && source && state && (
        <div className="admin-actions faq-desk-toolbar">
          <Button appearance="primary" data-focus="publish" disabled={locked || changes.length === 0} onClick={() => setAsk({ kind: "publish", changes, opener: "publish" })}>
            Publish
          </Button>
          <Button data-focus="discard" disabled={locked || changes.length === 0} onClick={() => setAsk({ kind: "discard", changes, opener: "discard" })}>
            Discard the draft
          </Button>
          {(host === "dev" || host === "local") && (
            <Button data-focus="download-for-live" disabled={locked || !state.liveVersion} onClick={() => void downloadForLive()}>
              Download FAQ for live
            </Button>
          )}
          {(host === "live" || host === "local") && (
            <>
              <Button data-focus="load-from-dev" disabled={locked} onClick={() => fileRef.current?.click()}>
                Load FAQ from dev
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  void pickImport(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </>
          )}
        </div>
      )}

      {body}

      <Dialog open={ask !== null} modalType="alert" onOpenChange={(_, data) => (!data.open ? closeAsk() : undefined)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{askTitle}</DialogTitle>
            <DialogContent>
              {ask?.kind === "removeCategory" && <p>The category and all its questions leave the draft. The live FAQ changes only when you publish.</p>}
              {ask?.kind === "removeEntry" && (
                <p>
                  &ldquo;{ask.question}&rdquo; leaves the draft. The live FAQ changes only when you publish.
                </p>
              )}
              {(ask?.kind === "publish" || ask?.kind === "discard" || ask?.kind === "import") && (
                <>
                  <p>
                    {ask.kind === "publish"
                      ? "These changes go to the website:"
                      : ask.kind === "discard"
                        ? "These unpublished changes are thrown away:"
                        : ask.changes.length
                          ? "Compared with what is live, the file from dev:"
                          : "The file from dev matches what is live."}
                  </p>
                  <ul className="faq-desk-changes">
                    {ask.changes.map((line, n) => (
                      <li key={n}>{line}</li>
                    ))}
                  </ul>
                  {ask.kind === "import" && (
                    <p>
                      It replaces this Admin&apos;s draft; nothing is published until you publish.
                      {ask.unpublished > 0 &&
                        ` The draft here has ${ask.unpublished} unpublished change${ask.unpublished === 1 ? "" : "s"}, which will be thrown away.`}
                    </p>
                  )}
                </>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" disabled={busy} onClick={() => void confirmAsk()}>
                {busy
                  ? "Working…"
                  : ask?.kind === "publish"
                    ? "Publish"
                    : ask?.kind === "discard"
                      ? "Discard"
                      : ask?.kind === "import"
                        ? "Load into the draft"
                        : "Remove"}
              </Button>
              <Button disabled={busy} onClick={closeAsk}>
                Cancel
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
