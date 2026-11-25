"use client";

import { Button, Checkbox, Input, MessageBar, MessageBarBody, Textarea } from "@fluentui/react-components";
import { ArrowClockwise, ArrowLeft, Images } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
import { useDevDemoWaiver } from "@/components/PublicSite";
import { accountHeaders } from "@/lib/account";
import { licenceNameText } from "@/lib/dev-waiver";
import {
  DESCRIPTION_MAX,
  descriptionErrors,
  descriptionOf,
  licenceDiff,
  licenceErrors,
  licenceFields,
  licenceToValues,
  normaliseDescription,
  mediaOutcome,
  publishBlockers,
  rebaseLicence,
  agreementVersion,
  isV2,
  reviewChecks,
  reviewKey,
  reviewReady,
  ticksFor,
  rightsOf,
  rightsOwnerOnly,
  REVIEW_REASON_MAX,
  reasonErrors,
  reasonLength,
  reviewActions,
  reviewDecisionText,
  type ReviewDecision,
  splitEdit,
  type ReviewTicks,
  type RightsState,
  type LicenceField,
  type LicenceValues,
} from "@/lib/media-form";
import { sitePath } from "@/lib/paths";
import type { MediaDetail, MediaItem, MediaLicence, MediaList, MediaVersion } from "@/lib/request/media";

/**
 * The admin Media section (MEDIA_PLAN.md, M3): every photo the backend holds, with its licence,
 * versions and a preview. Admins edit the draft licence (including whether a credit is required),
 * publish a draft and withdraw a published photo. Every write sends the revision the admin saw;
 * when someone else changed the photo first, it reloads and nothing is overwritten. Publishing here
 * does not put a photo in any game: linking to content is not done in this section.
 */

export type ViewKey = "unverified" | "changes" | "sentBack" | "declined" | "published" | "withdrawn" | "all";

/** The Submissions desk's review mode: a checklist that must be complete to publish, and what to offer afterwards. */
export type ReviewMode = {
  /** Shown once a photo is published from this desk, next to the success notice. */
  afterPublish?: (item: MediaItem) => ReactNode;
  /** Replaces the confirmation's closing sentence. */
  confirmNote?: string;
};
const views: { key: ViewKey; label: string; hint: string; query: string }[] = [
  // 0.30.0: the two review queues leave out photos already sent back or declined (`review=none`).
  { key: "unverified", label: "To review", hint: "New photos waiting for a first review", query: "state=unverified&review=none" },
  {
    key: "changes",
    label: "Changes waiting",
    hint: "Published photos whose draft is ahead of the live version",
    query: "pending=true&review=none",
  },
  { key: "sentBack", label: "Changes requested", hint: "Photos sent back to their photographer, with a reason", query: "review=changes_requested" },
  { key: "declined", label: "Declined", hint: "Photos turned down; reopen one to send it back instead", query: "review=declined" },
  { key: "published", label: "Published", hint: "Photos that are live", query: "state=published" },
  { key: "withdrawn", label: "Withdrawn", hint: "Photos taken down; they can be published again", query: "state=withdrawn" },
  { key: "all", label: "All", hint: "Every photo", query: "" },
];
const stateText = { unverified: "Unverified", published: "Published", withdrawn: "Withdrawn" } as const;
const fieldLabels: Record<LicenceField, string> = {
  credit: "Credit",
  licenceName: "Licence name",
  licenceUrl: "Licence link",
  sourceUrl: "Source link",
  attributionText: "Attribution text",
};

type Notice = { kind: "error" | "success"; text: string } | null;
type Reply = {
  status: number;
  code: string;
  error: string;
  body: Record<string, unknown>;
};

async function callMedia(sessionKey: string, path: string, json?: unknown, method = "GET"): Promise<Reply> {
  try {
    const response = await fetch(sitePath(path), {
      method,
      cache: "no-store",
      headers: { ...(json === undefined ? {} : { "Content-Type": "application/json" }), ...accountHeaders(sessionKey) },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const parsed: unknown = await response.json().catch(() => ({}));
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return {
      status: response.status,
      code: typeof body.code === "string" ? body.code : "",
      error: typeof body.error === "string" ? body.error : "",
      body,
    };
  } catch {
    return { status: 0, code: "", error: "", body: {} };
  }
}

/** 401 / 403 / 409 when this browser's account no longer matches the session or the role; otherwise null. */
function blockStatus(reply: Reply): 401 | 403 | 409 | null {
  const outcome = mediaOutcome(reply.status, reply.code);
  if (outcome === "roleLost" || (reply.status === 403 && reply.code === "DEMO_ACCOUNT")) return 403;
  if (outcome !== "fenced") return null;
  if (reply.status === 401 || reply.code === "SIGNED_OUT") return 401;
  return reply.status === 403 ? 403 : 409;
}
function isItem(value: unknown): value is MediaItem {
  return !!value && typeof value === "object" && typeof (value as MediaItem).id === "string" && "draft" in value;
}
function detailOf(body: Record<string, unknown>): MediaDetail | null {
  return isItem(body.item) && Array.isArray(body.versions) && body.preview && typeof body.preview === "object"
    ? (body as unknown as MediaDetail)
    : null;
}

function fmtBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
function fileSummary(version: MediaVersion) {
  return `v${version.version} · ${version.width}×${version.height} · ${fmtBytes(version.byteSize)}`;
}
function when(value: string | null, mounted: boolean) {
  if (!value || !mounted) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
/** The Firebase UID part of an owner principal. */
function accountOf(owner: string | undefined) {
  return owner ? (owner.split(":").at(-1) ?? owner) : "—";
}
const changesWaiting = (item: MediaItem) => item.state === "published" && item.draftVersion !== item.publishedVersion;
/** The saved licence and description of one version, as the form's base. */
function baseOf(version: MediaVersion): MediaLicence & { description: string | null } {
  return { ...version.licence, description: descriptionOf(version) };
}
/** The rights line an admin sees; `statedBy` shows the account id only. */
function rightsLine(rights: RightsState, mounted: boolean) {
  if (!rights) return "None";
  if (rights.statement === "d1_private_review") return "Imported: private review only";
  const agreement = agreementVersion(rights);
  const date = mounted ? new Date(rights.statedAt) : null;
  const on = date && !Number.isNaN(date.valueOf()) ? ` · stated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}` : "";
  const by = rights.statedBy ? ` by ${accountOf(rights.statedBy)}` : "";
  const kind = agreement
    ? `Photo Submission Agreement of ${agreement}`
    : rights.statement === "v1_own"
      ? "Own work"
      : "Authorised by the rights holder";
  return `${kind}${on}${by}`;
}
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
function failureText(reply: Reply, fallback: string) {
  const outcome = mediaOutcome(reply.status, reply.code);
  if (outcome === "retryable") return "The service is busy or couldn't be reached. Check your connection and try again in a moment.";
  if (reply.code === "LICENCE_INCOMPLETE")
    return "The saved draft licence is missing a licence name or a required credit, so it can't be published yet.";
  return reply.error || fallback;
}

function NoticeBar({ notice, onClose, noticeRef }: { notice: Notice; onClose: () => void; noticeRef: RefObject<HTMLDivElement | null> }) {
  if (!notice) return null;
  return (
    <div
      key={`${notice.kind}:${notice.text}`}
      ref={noticeRef}
      tabIndex={-1}
      className={`admin-message ${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      <MessageBar intent={notice.kind === "error" ? "error" : "success"}>
        <MessageBarBody>{notice.text}</MessageBarBody>
      </MessageBar>
      <button className="admin-message-close" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- detail

function DeskDetail({
  sessionKey,
  id,
  onBlocked,
  onBack,
  onChanged,
  onWritten,
  review,
}: {
  sessionKey: string;
  id: string;
  onBlocked: (status: number) => void;
  onBack: () => void;
  onChanged: (item: MediaItem) => void;
  /** After a save, publish or withdraw succeeded (the workspace refreshes its counts). */
  onWritten?: () => void;
  review?: ReviewMode;
}) {
  const mounted = useMounted();
  // Dev Admin only: a missing licence name no longer blocks publishing here (lib/dev-waiver.ts).
  const devDemoWaiver = useDevDemoWaiver();
  const uid = useId().replace(/:/g, "");
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<Notice>(null);
  const [values, setValues] = useState<LicenceValues>({
    credit: "",
    licenceName: "",
    licenceUrl: "",
    sourceUrl: "",
    attributionText: "",
    creditRequired: true,
  });
  const [errors, setErrors] = useState<Partial<Record<LicenceField | "description", string>>>({});
  const [auditNote, setAuditNote] = useState("");
  const [confirm, setConfirm] = useState<"publish" | "withdraw" | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  // Review mode: what the reviewer ticked, for one revision of this photo only.
  const [checked, setChecked] = useState<ReviewTicks>({ key: "", ids: [] });
  const [justPublished, setJustPublished] = useState<MediaItem | null>(null);
  // A removal of the photographer's private data waiting for its confirmation (privacy request, agreement section 8).
  const [clearAsk, setClearAsk] = useState<"name" | "handle" | "display" | null>(null);
  // A review decision being written (0.30.0): null withdraws the current decision. The reason as typed.
  const [reviewAsk, setReviewAsk] = useState<{ decision: ReviewDecision | null; label: string } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const reviewAskRef = useRef<HTMLDivElement>(null);
  const reviewButtonsRef = useRef<HTMLDivElement>(null);
  // Only the newest load or write may change the screen.
  const generation = useRef(0);
  // Writes have their own generation, so a reload never swallows a save or publish answer.
  const writeGeneration = useRef(0);
  /** The saved draft licence the form was last loaded or rebased from. */
  const loadedBase = useRef<(MediaLicence & { description: string | null }) | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const withdrawRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<"notice" | "heading" | null>("heading");

  const reload = useCallback(
    async (resetForm: boolean) => {
      const mine = ++generation.current;
      const reply = await callMedia(sessionKey, `/api/media/${id}`);
      if (mine !== generation.current) return;
      const blocked = blockStatus(reply);
      if (blocked !== null) return onBlocked(blocked);
      const next = reply.status === 200 ? detailOf(reply.body) : null;
      if (!next) {
        setLoad("error");
        setNotice({
          kind: "error",
          text: reply.status === 404 ? `${id} wasn't found.` : failureText(reply, "This photo couldn't be loaded."),
        });
        return;
      }
      setDetail(next);
      setExpired(false);
      setLoad("ready");
      onChanged(next.item);
      const newBase = baseOf(next.item.draft);
      const oldBase = loadedBase.current;
      loadedBase.current = newBase;
      if (resetForm || !oldBase) {
        setValues(licenceToValues(newBase));
        setErrors({});
      } else {
        // Untouched fields follow the new saved licence; typed text stays, so another editor's change isn't reverted.
        const agreement = isV2(rightsOf(next.item.draft));
        setValues((typed) => {
          const rebased = rebaseLicence(oldBase, newBase, typed);
          // On a v2 draft these are the agreement's and locked: a value typed before the move can't stay in them.
          return agreement
            ? {
                ...rebased,
                licenceName: newBase.licenceName ?? "",
                licenceUrl: newBase.licenceUrl ?? "",
                creditRequired: newBase.creditRequired,
              }
            : rebased;
        });
        setErrors({});
      }
    },
    [sessionKey, id, onBlocked, onChanged],
  );

  useEffect(() => {
    void reload(true);
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    if (load === "loading" || !focusAfter.current) return;
    const target = focusAfter.current === "notice" && noticeRef.current ? noticeRef.current : headingRef.current;
    focusAfter.current = null;
    target?.focus();
  }, [load, notice, detail]);

  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  useEffect(() => {
    if (reviewAsk) reviewAskRef.current?.focus();
  }, [reviewAsk]);

  const item = detail?.item ?? null;
  const base = item ? baseOf(item.draft) : null;
  // The checks belong to what the reviewer saw: a new revision (an owner's edit, another admin's save) starts them again.
  const checkKey = item ? reviewKey(item) : "";
  const ticked = ticksFor(checked, checkKey);
  const checklistDone = !review || reviewReady(checked, checkKey);

  function cancelConfirm() {
    const which = confirm;
    setConfirm(null);
    requestAnimationFrame(() => (which === "withdraw" ? withdrawRef : publishRef).current?.focus());
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!item || !base || busy) return;
    const found: Partial<Record<LicenceField | "description", string>> = licenceErrors(values);
    if (isV2(rightsOf(item.draft)) && !values.credit.trim()) found.credit = "A photo under the agreement needs a credit.";
    const descriptionProblem = descriptionErrors(values.description ?? "");
    if (descriptionProblem) found.description = descriptionProblem;
    setErrors(found);
    const firstBad = [...licenceFields, "description" as const].find((field) => found[field]);
    if (firstBad) return void requestAnimationFrame(() => document.getElementById(`${uid}-${firstBad}`)?.focus());
    const diff = licenceDiff(base, values, true);
    if ("none" in diff) {
      focusAfter.current = "notice";
      setNotice({ kind: "success", text: "No changes to save." });
      return;
    }
    const mine = ++writeGeneration.current;
    setBusy(true);
    setNotice(null);
    const note = auditNote.trim();
    const reply = await callMedia(
      sessionKey,
      `/api/media/${item.id}`,
      { revision: item.revision, ...splitEdit(diff.changes), ...(note ? { note } : {}) },
      "PATCH",
    );
    setBusy(false);
    if (mine !== writeGeneration.current) return;
    const blocked = blockStatus(reply);
    if (blocked !== null) return onBlocked(blocked);
    focusAfter.current = "notice";
    if (mediaOutcome(reply.status, reply.code) === "ok") {
      setAuditNote("");
      setNotice({ kind: "success", text: "Licence details saved." });
      onWritten?.();
      await reload(true);
    } else if (mediaOutcome(reply.status, reply.code) === "conflict") {
      // Someone changed it first: show the current licence and keep what was typed.
      setNotice({ kind: "error", text: "Someone changed this photo first. The latest details are loaded; your typed text is kept. Check it and save again." });
      await reload(false);
    } else {
      setNotice({ kind: "error", text: failureText(reply, "The licence details couldn't be saved.") });
    }
  }

  /**
   * Removes the photographer's private data on a privacy request. A non-owner admin may only remove (the backend
   * answers 403 to anything else), so the Admin never sends a new value. Fenced by the revision like every write.
   */
  async function removeDetail(what: "name" | "handle" | "display") {
    if (!item || busy) return;
    const change =
      what === "name"
        ? { fullName: null }
        : what === "handle"
          ? { instagram: { handle: null, displayConsent: false } }
          : { instagram: { handle: item.submission?.instagramHandle ?? null, displayConsent: false } };
    const mine = ++writeGeneration.current;
    setBusy(true);
    setNotice(null);
    const reply = await callMedia(sessionKey, `/api/media/${item.id}`, { revision: item.revision, ...change }, "PATCH");
    setBusy(false);
    if (mine !== writeGeneration.current) return;
    const blocked = blockStatus(reply);
    if (blocked !== null) return onBlocked(blocked);
    setClearAsk(null);
    focusAfter.current = "notice";
    const outcome = mediaOutcome(reply.status, reply.code);
    if (outcome === "ok") {
      setNotice({ kind: "success", text: what === "display" ? "The handle is no longer shown." : "Removed." });
      onWritten?.();
      await reload(false);
    } else if (outcome === "conflict") {
      setNotice({ kind: "error", text: "Someone changed this photo first. The latest details are loaded; check them and try again." });
      await reload(false);
    } else {
      setNotice({ kind: "error", text: failureText(reply, "That couldn't be removed.") });
    }
  }

  /**
   * Sends a review decision (0.30.0), fenced by the revision like every write and never retried. The reason is written
   * for the photographer, who sees it word for word; it is not logged or copied anywhere else.
   */
  async function decideReview() {
    if (!item || busy || !reviewAsk) return;
    const decision = reviewAsk.decision;
    if (decision !== null) {
      const problem = reasonErrors(reason);
      setReasonError(problem);
      if (problem) {
        // The field takes focus, so its error (in its description) is read out.
        document.getElementById(`${uid}-reason`)?.focus();
        return;
      }
    }
    const before = item.revision;
    const body = decision === null ? { revision: before, decision } : { revision: before, decision, reason: reason.replace(/\r\n/g, "\n").trim() };
    const mine = ++writeGeneration.current;
    setBusy(true);
    setNotice(null);
    const reply = await callMedia(sessionKey, `/api/media/${item.id}/review`, body, "POST");
    setBusy(false);
    if (mine !== writeGeneration.current) return;
    const blocked = blockStatus(reply);
    if (blocked !== null) return onBlocked(blocked);
    focusAfter.current = "notice";
    const outcome = mediaOutcome(reply.status, reply.code);
    if (outcome === "ok") {
      setReviewAsk(null);
      setReason("");
      const after = isItem(reply.body) ? reply.body.revision : null;
      // The backend answers an identical decision (same reason, same version) with the item unchanged.
      setNotice({
        kind: "success",
        text:
          after === before
            ? "Nothing changed: that decision was already in place."
            : decision === null
              ? "The decision was withdrawn and its reason erased."
              : decision === "declined"
                ? `${item.id} was declined. The photographer sees the reason.`
                : `Changes were requested on ${item.id}. The photographer sees the reason.`,
      });
      onWritten?.();
      await reload(false);
    } else if (outcome === "conflict") {
      // A stale revision, or a decision this photo can't take in its state now: both are 409 version_conflict. The
      // form and the typed reason stay; the next Send is a new, deliberate write with the reloaded revision.
      setNotice({
        kind: "error",
        text: "This photo changed, or can't take that decision in its current state. The latest details are loaded; check them and decide again.",
      });
      await reload(false);
    } else {
      setNotice({ kind: "error", text: failureText(reply, "The decision couldn't be saved.") });
    }
  }

  async function act(action: "publish" | "withdraw") {
    if (!item || busy) return;
    // Re-check at the moment of confirming: the saved licence must still allow it and nothing may be unsaved.
    if (action === "publish") {
      const stopped = publishBlockers(item.draft.licence, rightsOf(item.draft), {
        devDemoWaiver,
        fullName: item.submission?.fullName ?? null,
      });
      const unsaved = "changes" in licenceDiff(baseOf(item.draft), values, true);
      if (unsaved || stopped.length > 0 || !checklistDone) {
        setConfirm(null);
        focusAfter.current = "notice";
        setNotice({
          kind: "error",
          text: !checklistDone
            ? "Finish the review checks before publishing."
            : !unsaved && stopped.length > 0 && stopped.every((b) => b.field === "rights" || b.field === "fullName")
              ? stopped.map((b) => b.message).join(" ")
              : "Publishing was stopped: the saved licence changed or has unsaved edits. Check it and try again.",
        });
        return;
      }
    }
    const mine = ++writeGeneration.current;
    setBusy(true);
    setNotice(null);
    const reply = await callMedia(sessionKey, `/api/media/${item.id}/${action}`, { revision: item.revision }, "POST");
    setBusy(false);
    if (mine !== writeGeneration.current) return;
    const blocked = blockStatus(reply);
    if (blocked !== null) return onBlocked(blocked);
    setConfirm(null);
    focusAfter.current = "notice";
    const outcome = mediaOutcome(reply.status, reply.code);
    if (outcome === "ok") {
      if (action === "publish") setJustPublished(item);
      onWritten?.();
      setNotice({
        kind: "success",
        text:
          action === "publish"
            ? `Version ${item.draftVersion} of ${item.id} was published.`
            : `${item.id} was withdrawn. It can be published again.`,
      });
      await reload(true);
    } else if (outcome === "conflict") {
      setNotice({
        kind: "error",
        text:
          reply.code === "NOTHING_TO_PUBLISH"
            ? "There is nothing new to publish: the draft is already live. The latest details are loaded."
            : "Someone changed this photo first. The latest details are loaded; check them and try again.",
      });
      await reload(false);
    } else {
      setNotice({ kind: "error", text: failureText(reply, `The photo couldn't be ${action === "publish" ? "published" : "withdrawn"}.`) });
      if (reply.code === "LICENCE_INCOMPLETE") await reload(false);
    }
  }

  const heading = (
    <div className="admin-panel-header media-desk-head">
      <Button icon={<ArrowLeft size={16} />} onClick={onBack}>
        Back to the list
      </Button>
      <div>
        <h2 id={`${uid}-title`} ref={headingRef} tabIndex={-1}>
          {id}
          {item && ` · ${stateText[item.state]}`}
          {item && changesWaiting(item) && <span className="status-badge media-desk-badge">Changes waiting</span>}
          {item?.review && <span className="status-badge media-desk-badge">{reviewDecisionText[item.review.decision]}</span>}
        </h2>
      </div>
    </div>
  );

  if (!item || !base || !detail)
    return (
      <section className="admin-panel media-desk-detail" aria-labelledby={`${uid}-title`} aria-busy={load === "loading"}>
        {heading}
        <NoticeBar notice={notice} onClose={() => setNotice(null)} noticeRef={noticeRef} />
        {load === "loading" ? (
          <div className="admin-empty">
            <b>Loading this photo…</b>
          </div>
        ) : (
          <div className="admin-actions">
            <Button appearance="primary" icon={<ArrowClockwise />} onClick={() => void reload(true)}>
              Try again
            </Button>
          </div>
        )}
      </section>
    );

  const preview = detail.preview;
  const rights = rightsOf(item.draft);
  const blockers = publishBlockers(base, rights, { devDemoWaiver, fullName: item.submission?.fullName ?? null });
  // A v2 version's licence is the agreement: its name, link and credit requirement can't be changed (the backend refuses).
  const agreementLicence = isV2(rights);
  const submission = item.submission;
  const dirty = "changes" in licenceDiff(base, values, true);
  const canPublish = item.draftVersion !== item.publishedVersion;
  const publishBlocked = dirty || blockers.length > 0 || !checklistDone;
  const hasLink = !!preview.url;
  const versions = [...detail.versions].reverse();
  const frozenCredit = base.credit ? `credit ('${base.credit}')` : "no credit required";

  return (
    <section className="admin-panel media-desk-detail" aria-labelledby={`${uid}-title`}>
      {heading}
      <NoticeBar notice={notice} onClose={() => setNotice(null)} noticeRef={noticeRef} />
      {review?.afterPublish && justPublished && item?.id === justPublished.id && item.state === "published" && (
        <div className="media-desk-after admin-actions" role="group" aria-label={`Use ${justPublished.id}`}>
          {review.afterPublish(justPublished)}
        </div>
      )}

      <div className="media-desk-preview">
        {preview.url && !expired ? (
          <img
            src={preview.url}
            alt={`Draft version ${preview.version} of ${item.id}`}
            width={preview.width}
            height={preview.height}
            referrerPolicy="no-referrer"
            onError={() => setExpired(true)}
          />
        ) : preview.url ? (
          <div className="media-desk-placeholder" role="alert">
            <p>The preview link has expired. Reload this photo.</p>
            <Button
              onClick={() => {
                focusAfter.current = null;
                void reload(false);
              }}
            >
              Reload this photo
            </Button>
          </div>
        ) : (
          <div className="media-desk-placeholder">
            <p>Preview isn&apos;t available on this server (CDN not configured). The photo was received and checked.</p>
          </div>
        )}
        <dl className="media-desk-facts">
          <div>
            <dt>Draft version</dt>
            <dd>{fileSummary(item.draft)}</dd>
          </div>
          <div>
            <dt>Live version</dt>
            <dd>{item.publishedVersion ? `v${item.publishedVersion}` : "None"}</dd>
          </div>
          <div>
            <dt>Rights</dt>
            <dd>{rightsLine(rights, mounted)}</dd>
          </div>
          <div>
            <dt>Title</dt>
            <dd>{item.draft.title ?? "None"}</dd>
          </div>
          <div>
            <dt>Uploaded by</dt>
            <dd>{accountOf(item.owner)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{when(item.updatedAt, mounted)}</dd>
          </div>
        </dl>
      </div>

      <form className="media-desk-licence" onSubmit={(event) => void save(event)} noValidate>
        <h3>Draft licence (version {item.draftVersion})</h3>
        <fieldset className="admin-fieldset" disabled={busy || confirm !== null}>
          <div className="form-grid">
            {licenceFields.map((field) => (
              <div className={`admin-field ${field === "attributionText" ? "full" : ""}`} key={field}>
                <label htmlFor={`${uid}-${field}`}>
                  <span>
                    {fieldLabels[field]}
                    {(field === "licenceName" || (field === "credit" && base.creditRequired)) && (
                      <small> · Needed before publishing</small>
                    )}
                  </span>
                </label>
                <Input
                  id={`${uid}-${field}`}
                  value={values[field]}
                  readOnly={agreementLicence && (field === "licenceName" || field === "licenceUrl")}
                  maxLength={field === "attributionText" ? 1000 : field.endsWith("Url") ? 2048 : 200}
                  aria-invalid={!!errors[field]}
                  aria-describedby={errors[field] ? `${uid}-${field}-error` : undefined}
                  onChange={(_, data) => setValues((old) => ({ ...old, [field]: data.value }))}
                />
                {errors[field] && (
                  <span className="media-desk-error" id={`${uid}-${field}-error`}>
                    {errors[field]}
                  </span>
                )}
              </div>
            ))}
            <div className="admin-field full">
              <label htmlFor={`${uid}-description`}>
                <span>Description</span>
              </label>
              <Textarea
                id={`${uid}-description`}
                rows={5}
                value={values.description ?? ""}
                aria-invalid={!!errors.description}
                aria-describedby={[`${uid}-description-hint`, errors.description ? `${uid}-description-error` : ""].filter(Boolean).join(" ")}
                onChange={(_, data) => setValues((old) => ({ ...old, description: data.value }))}
              />
              <small className="field-hint" id={`${uid}-description-hint`}>
                Optional. Line breaks are fine. {[...normaliseDescription(values.description ?? "")].length} of {DESCRIPTION_MAX} characters.
              </small>
              {errors.description && (
                <span className="media-desk-error" id={`${uid}-description-error`}>
                  {errors.description}
                </span>
              )}
            </div>
            <div className="admin-field full">
              <Checkbox
                checked={!!values.creditRequired}
                disabled={agreementLicence}
                label={
                  agreementLicence
                    ? "A credit is required to publish this photo (set by the agreement)"
                    : "A credit is required to publish this photo"
                }
                onChange={(_, data) => setValues((old) => ({ ...old, creditRequired: !!data.checked }))}
              />
            </div>
            <div className="admin-field full">
              <label htmlFor={`${uid}-note`}>
                <span>
                  Note <small>Optional, kept in the audit record</small>
                </span>
              </label>
              <Input id={`${uid}-note`} value={auditNote} maxLength={500} onChange={(_, data) => setAuditNote(data.value)} />
            </div>
          </div>
        </fieldset>
        <div className="admin-actions">
          <Button type="submit" appearance="primary" disabled={busy || confirm !== null}>
            {busy ? "Working…" : "Save licence details"}
          </Button>
          <Button
            disabled={busy || confirm !== null || (!dirty && !auditNote)}
            onClick={() => {
              setValues(licenceToValues(base));
              setErrors({});
              setAuditNote("");
            }}
          >
            Discard edits
          </Button>
          {dirty && <span className="media-desk-dirty">Unsaved edits</span>}
        </div>
      </form>

      <section className="media-desk-submission media-desk-review" aria-labelledby={`${uid}-review`}>
        <h3 id={`${uid}-review`}>Review decision</h3>
        <p className="media-desk-note">
          Send a photo back with what to change, or decline it. The photographer sees the reason word for word on the website;
          no email is sent. Only the latest reason is kept.
        </p>
        {item.review ? (
          <>
            <dl className="media-desk-facts">
              <div>
                <dt>Decision</dt>
                <dd>{reviewDecisionText[item.review.decision]}</dd>
              </div>
              <div>
                <dt>Decided</dt>
                <dd>
                  {when(item.review.decidedAt, mounted)}
                  {item.review.decidedBy ? ` by ${accountOf(item.review.decidedBy)}` : ""}
                </dd>
              </div>
              <div>
                <dt>Made on</dt>
                <dd>
                  Version {item.review.version}
                  {item.review.version < item.draftVersion ? ` (the draft is now version ${item.draftVersion})` : ""}
                </dd>
              </div>
            </dl>
            <p className="media-desk-reason" aria-label="Reason">
              {item.review.reason}
            </p>
          </>
        ) : (
          <p>No decision on this photo.</p>
        )}
        {reviewAsk ? (
          <div
            className="media-desk-confirm"
            role="group"
            aria-labelledby={`${uid}-review-ask`}
            ref={reviewAskRef}
            tabIndex={-1}
          >
            <p id={`${uid}-review-ask`}>
              <b>
                {reviewAsk.decision === null
                  ? "Withdraw the decision?"
                  : reviewAsk.decision === "declined"
                    ? "Decline this photo?"
                    : "Request changes from the photographer?"}
              </b>{" "}
              {reviewAsk.decision === null
                ? reviewActions(item).some((action) => action.decision !== null)
                  ? "Its reason is erased and the photo goes back to the review queue."
                  : "Its reason is erased."
                : reviewAsk.decision === "declined"
                  ? "The photographer can't change it until it is reopened."
                  : "A change they make clears the request and brings it back to review."}
            </p>
            {reviewAsk.decision !== null && (
              <div className="admin-field full">
                <label htmlFor={`${uid}-reason`}>
                  <span>Reason for the photographer</span>
                </label>
                <Textarea
                  id={`${uid}-reason`}
                  rows={4}
                  value={reason}
                  aria-invalid={!!reasonError}
                  aria-describedby={[`${uid}-reason-hint`, reasonError ? `${uid}-reason-error` : ""].filter(Boolean).join(" ")}
                  onChange={(_, data) => {
                    setReason(data.value);
                    setReasonError(undefined);
                  }}
                />
                <small className="field-hint" id={`${uid}-reason-hint`}>
                  Line breaks are fine. {reasonLength(reason)} of {REVIEW_REASON_MAX} characters.
                </small>
                {reasonError && (
                  <span className="media-desk-error" id={`${uid}-reason-error`}>
                    {reasonError}
                  </span>
                )}
              </div>
            )}
            <div className="admin-actions">
              <Button appearance="primary" disabled={busy} onClick={() => void decideReview()}>
                {busy ? "Working…" : reviewAsk.decision === null ? "Withdraw the decision" : "Send the decision"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  const opener = reviewAsk.decision;
                  setReviewAsk(null);
                  setReasonError(undefined);
                  requestAnimationFrame(() =>
                    reviewButtonsRef.current?.querySelector<HTMLElement>(`[data-review="${opener}"]`)?.focus(),
                  );
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="admin-actions" ref={reviewButtonsRef}>
            {reviewActions(item).map((action) => (
              <Button
                key={`${action.decision}`}
                data-review={`${action.decision}`}
                disabled={busy || confirm !== null || clearAsk !== null}
                onClick={() => {
                  setReviewAsk(action);
                  // A decision of the same kind starts from the current reason.
                  setReason(action.decision !== null && item.review?.decision === action.decision ? item.review.reason : "");
                  setReasonError(undefined);
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </section>

      {submission && (
        <section className="media-desk-submission" aria-labelledby={`${uid}-submission`}>
          <h3 id={`${uid}-submission`}>Photographer&apos;s details</h3>
          <p className="media-desk-note">
            Private: only the photographer and admins see these. Only the photographer can set or change them; an admin
            can only remove them, on a privacy request.
          </p>
          <dl className="media-desk-facts">
            <div>
              <dt>Full name</dt>
              <dd>{submission.fullName ?? "Removed"}</dd>
            </div>
            <div>
              <dt>Instagram</dt>
              <dd>{submission.instagramHandle ? `@${submission.instagramHandle}` : "None"}</dd>
            </div>
            <div>
              <dt>Show the handle publicly</dt>
              <dd>{submission.instagramDisplayConsent ? "Yes" : "No"}</dd>
            </div>
          </dl>
          {clearAsk ? (
            <div className="media-desk-confirm" role="group" aria-label="Confirm removal">
              <p>
                <b>
                  {clearAsk === "name"
                    ? "Remove the photographer's full name?"
                    : clearAsk === "handle"
                      ? "Remove the Instagram handle?"
                      : "Stop showing the Instagram handle?"}
                </b>{" "}
                {clearAsk === "name"
                  ? "Only the photographer can add it again, and a new agreement version can't be published without it."
                  : "Only the photographer can turn this back on."}
              </p>
              <div className="admin-actions">
                <Button appearance="primary" disabled={busy} onClick={() => void removeDetail(clearAsk)}>
                  {busy ? "Working…" : "Confirm removal"}
                </Button>
                <Button disabled={busy} onClick={() => setClearAsk(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="admin-actions">
              {submission.fullName && (
                <Button disabled={busy || confirm !== null} onClick={() => setClearAsk("name")}>
                  Remove full name
                </Button>
              )}
              {submission.instagramHandle && (
                <Button disabled={busy || confirm !== null} onClick={() => setClearAsk("handle")}>
                  Remove Instagram handle
                </Button>
              )}
              {submission.instagramDisplayConsent && (
                <Button disabled={busy || confirm !== null} onClick={() => setClearAsk("display")}>
                  Stop showing the handle
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <div className="media-desk-versions">
        <h3>Versions</h3>
        <div className="admin-table-scroll">
          <table className="admin-table media-desk-vtable">
            <thead>
              <tr>
                <th>Version</th>
                <th>File</th>
                <th>Licence</th>
                <th>Checksum (SHA-256)</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.version}>
                  <td data-label="Version">
                    <b>v{version.version}</b>
                    {version.version === item.publishedVersion && <small> Live</small>}
                    {version.version === item.draftVersion && <small> Draft</small>}
                  </td>
                  <td data-label="File">
                    {version.width}×{version.height} · {fmtBytes(version.byteSize)} · {version.contentType === "image/png" ? "PNG" : "JPEG"}
                  </td>
                  <td data-label="Licence">
                    {licenceNameText(version) ?? "No licence name"}
                    <small>{version.licence.credit ? `Credit: ${version.licence.credit}` : version.licence.creditRequired ? "Credit needed" : "No credit required"}</small>
                  </td>
                  <td data-label="Checksum">
                    <details className="media-desk-hash">
                      <summary>{version.sha256.slice(0, 12)}…</summary>
                      <code>{version.sha256}</code>
                    </details>
                  </td>
                  <td data-label="Added">{when(version.createdAt, mounted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="media-desk-decide">
        <h3>Publishing</h3>
        {canPublish ? (
          <>
            {dirty && (
              <p className="media-desk-blocker" id={`${uid}-dirty`}>
                Save or discard your licence edits before publishing. Publishing uses the saved licence.
              </p>
            )}
            {review && (
              <fieldset className="admin-fieldset media-desk-checks" disabled={busy || confirm !== null}>
                <legend>Review checks</legend>
                {reviewChecks.map((check) => (
                  <Checkbox
                    key={check.id}
                    checked={ticked.includes(check.id)}
                    label={check.id === "credit" && agreementLicence ? "The credit and title match the submission." : check.label}
                    onChange={(_, data) =>
                      setChecked({
                        key: checkKey,
                        ids: data.checked ? [...ticked, check.id] : ticked.filter((one) => one !== check.id),
                      })
                    }
                  />
                ))}
              </fieldset>
            )}
            {(blockers.length > 0 || !checklistDone) && (
              <ul className="media-desk-blockers" id={`${uid}-blockers`} aria-label="What stops publishing">
                {!checklistDone && <li>Finish the review checks above.</li>}
                {blockers.map((blocker) => (
                  <li key={blocker.field}>
                    {blocker.message}{" "}
                    {blocker.field !== "rights" && blocker.field !== "fullName" && (
                      <a
                        href={`#${uid}-${blocker.field}`}
                        onClick={(event) => {
                          event.preventDefault();
                          document.getElementById(`${uid}-${blocker.field}`)?.focus();
                        }}
                      >
                        Go to {fieldLabels[blocker.field].toLowerCase()}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="admin-actions">
              <Button
                ref={publishRef}
                appearance="primary"
                disabled={busy || confirm !== null}
                disabledFocusable={publishBlocked}
                aria-describedby={
                  [dirty ? `${uid}-dirty` : "", blockers.length > 0 || !checklistDone ? `${uid}-blockers` : ""].filter(Boolean).join(" ") ||
                  undefined
                }
                onClick={() => {
                  if (!publishBlocked) setConfirm("publish");
                }}
              >
                Publish version {item.draftVersion}
              </Button>
            </div>
          </>
        ) : (
          <p className="media-desk-note">
            {item.state === "published" ? "The live version is the latest draft. There is nothing new to publish." : "Nothing to publish."}
          </p>
        )}
        {item.state === "published" && (
          <div className="admin-actions">
            <Button ref={withdrawRef} disabled={busy || confirm !== null} onClick={() => setConfirm("withdraw")}>
              Withdraw
            </Button>
          </div>
        )}
        {confirm && (
          <div
            className="media-desk-confirm"
            role="group"
            tabIndex={-1}
            ref={confirmRef}
            aria-label={confirm === "publish" ? `Publish ${item.id}` : `Withdraw ${item.id}`}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) cancelConfirm();
            }}
          >
            <p>
              {confirm === "publish" ? (
                <>
                  <b>
                    Publish version {item.draftVersion} of {item.id}?
                  </b>{" "}
                  {base.licenceName ? (
                    <>
                      Its licence (&apos;{base.licenceName}&apos;) and {frozenCredit} are frozen with this version.
                    </>
                  ) : (
                    <>It has no licence, so it is published without one (dev demo); {frozenCredit} is frozen with this version.</>
                  )}{" "}
                  {review?.confirmNote ?? "Nothing appears in a game until the image is linked to content, which isn't done here."}
                  {!hasLink && " This image can't be previewed on this server, so you haven't seen it."}
                </>
              ) : (
                <>
                  <b>Withdraw {item.id}?</b> The game and the website stop receiving it. Its history is kept and it can
                  be published again.
                </>
              )}
            </p>
            <div className="admin-actions">
              <Button appearance="primary" disabled={busy} onClick={() => void act(confirm)}>
                {busy ? "Working…" : confirm === "publish" ? "Confirm publish" : "Confirm withdraw"}
              </Button>
              <Button disabled={busy} onClick={cancelConfirm}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- list

export function MediaDesk({
  sessionKey,
  onBlocked,
  only,
  eyebrow = "PHOTOS",
  title = "Media",
  intro = "Photos sent by photographers, with their licences. Review, edit the licence, publish or withdraw.",
  footnote = "Publishing freezes a version's licence and credit. A photo reaches a game only once it is linked to content, which isn't done in this section.",
  review,
  onWritten,
  children,
}: {
  sessionKey: string;
  /** The workspace's account fence: clears private data and reports the access change. */
  onBlocked: (status: number) => void;
  /** The lists this desk offers, in order; the first opens. Every list when absent. */
  only?: readonly ViewKey[];
  eyebrow?: string;
  title?: string;
  intro?: string;
  footnote?: string;
  /** The Submissions desk: review checks before publishing, and what to offer once published. */
  review?: ReviewMode;
  /** After a save, publish or withdraw succeeded. */
  onWritten?: () => void;
  /** Shown between the heading and the lists (the Submissions desk's photographer panel). */
  children?: ReactNode;
}) {
  const mounted = useMounted();
  // Dev Admin only: a missing licence name no longer blocks publishing here (lib/dev-waiver.ts).
  const devDemoWaiver = useDevDemoWaiver();
  const shownViews = only ? views.filter((v) => only.includes(v.key)) : views;
  const [view, setView] = useState<ViewKey>(shownViews[0]?.key ?? "unverified");
  const viewRef = useRef(view);
  viewRef.current = view;
  const [rows, setRows] = useState<MediaItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const generation = useRef(0);
  const stale = useRef(false);
  const opener = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const queryFor = (key: ViewKey, after: string | null) => {
    const parts = [views.find((v) => v.key === key)!.query, after ? `cursor=${encodeURIComponent(after)}` : ""].filter(Boolean);
    return `/api/media${parts.length ? `?${parts.join("&")}` : ""}`;
  };

  const reload = useCallback(async () => {
    const forView = viewRef.current;
    const mine = ++generation.current;
    setLoad("loading");
    setNotice(null);
    const reply = await callMedia(sessionKey, queryFor(forView, null));
    if (mine !== generation.current) return;
    const blocked = blockStatus(reply);
    if (blocked !== null) return onBlocked(blocked);
    const page = reply.status === 200 ? (reply.body as unknown as MediaList) : null;
    if (!page || !Array.isArray(page.items)) {
      setRows([]);
      setCursor(null);
      setLoad("error");
      setNotice({ kind: "error", text: failureText(reply, "The photo list could not be loaded.") });
      return;
    }
    stale.current = false;
    setRows(page.items);
    setCursor(page.nextCursor);
    setLoad("ready");
  }, [sessionKey, onBlocked]);

  useEffect(() => {
    void reload();
  }, [view, reload]);

  async function more() {
    if (!cursor) return;
    const mine = generation.current;
    setBusy(true);
    const reply = await callMedia(sessionKey, queryFor(viewRef.current, cursor));
    setBusy(false);
    if (mine !== generation.current) return;
    const blocked = blockStatus(reply);
    if (blocked !== null) return onBlocked(blocked);
    const page = reply.status === 200 ? (reply.body as unknown as MediaList) : null;
    if (!page || !Array.isArray(page.items)) {
      // A stale cursor is refused; start the list again.
      if (reply.status === 400) return void reload();
      setNotice({ kind: "error", text: failureText(reply, "More photos could not be loaded.") });
      return;
    }
    setRows((old) => [...old, ...page.items.filter((n) => !old.some((o) => o.id === n.id))]);
    setCursor(page.nextCursor);
  }

  const patchRow = useCallback((next: MediaItem) => {
    stale.current = true;
    setRows((old) => old.map((o) => (o.id === next.id ? next : o)));
  }, []);

  function back() {
    const id = opener.current;
    setOpenId(null);
    const refresh = stale.current ? reload() : Promise.resolve();
    void refresh.then(() =>
      requestAnimationFrame(() =>
        (id ? tableRef.current?.querySelector<HTMLElement>(`[data-opener="${CSS.escape(id)}"]`) : null)?.focus?.() ??
        headingRef.current?.focus(),
      ),
    );
  }

  const current = views.find((v) => v.key === view)!;
  if (openId)
    return (
      <DeskDetail
        sessionKey={sessionKey}
        id={openId}
        onBlocked={onBlocked}
        onBack={back}
        onChanged={patchRow}
        onWritten={onWritten}
        review={review}
      />
    );

  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{intro}</p>
        </div>
        <div className="admin-heading-actions">
          <Button icon={<ArrowClockwise />} disabled={load === "loading" || busy} onClick={() => void reload()}>
            Reload
          </Button>
        </div>
      </div>

      <NoticeBar notice={notice} onClose={() => setNotice(null)} noticeRef={noticeRef} />

      {children}

      <div className="media-desk-views" role="group" aria-label="Show photos">
        {shownViews.map((v) => (
          <button
            key={v.key}
            type="button"
            aria-pressed={view === v.key}
            disabled={busy}
            className={`media-desk-view ${view === v.key ? "active" : ""}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <section className="admin-panel admin-table-wrap" aria-labelledby="media-desk-title" aria-busy={load === "loading"}>
        <div className="admin-panel-header">
          <div>
            <h2 id="media-desk-title" ref={headingRef} tabIndex={-1}>
              {current.label}
            </h2>
            <p>{current.hint} · newest first</p>
          </div>
        </div>
        {load === "loading" ? (
          <div className="admin-empty">
            <b>Loading photos…</b>
          </div>
        ) : rows.length ? (
          <div className="admin-table-scroll" ref={tableRef}>
            <table className="admin-table media-desk-table">
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>State</th>
                  <th>Draft file</th>
                  <th>Licence</th>
                  <th>Uploaded by</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Photo">
                      <Button
                        appearance="transparent"
                        className="media-desk-open"
                        data-opener={item.id}
                        onClick={() => {
                          opener.current = item.id;
                          setOpenId(item.id);
                        }}
                      >
                        {item.id}
                      </Button>
                      {changesWaiting(item) && <span className="status-badge media-desk-badge">Changes waiting</span>}
                      {item.review && <span className="status-badge media-desk-badge">{reviewDecisionText[item.review.decision]}</span>}
                    </td>
                    <td data-label="State">{stateText[item.state]}</td>
                    <td data-label="Draft file">{fileSummary(item.draft)}</td>
                    <td data-label="Licence">{licenceNameText(item.draft) ?? (devDemoWaiver ? "No licence name (dev demo)" : "Licence needed")}</td>
                    <td data-label="Uploaded by">{accountOf(item.owner)}</td>
                    <td data-label="Updated">{when(item.updatedAt, mounted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cursor && (
              <div className="users-more">
                <Button disabled={busy} onClick={() => void more()}>
                  Show more
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="admin-empty">
            <Images size={25} />
            <b>{load === "error" ? "The photo list is unavailable" : "No photos in this list"}</b>
          </div>
        )}
      </section>
      <p className="users-footnote">{footnote}</p>
    </>
  );
}
