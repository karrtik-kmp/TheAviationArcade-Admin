"use client";

import {
  Button,
  Checkbox,
  FluentProvider,
  Input,
  MessageBar,
  MessageBarBody,
  Textarea,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import {
  AirplaneInFlight,
  AirplaneTilt,
  ArrowClockwise,
  ArrowLeft,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  ImageSquare,
  Images,
  Newspaper,
  ShieldCheck,
  SquaresFour,
  Storefront,
  UsersThree,
} from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AccountControl } from "@/components/AccountControl";
import { useAccountSession } from "@/components/AccountSession";
import { useDevDemoWaiver } from "@/components/PublicSite";
import { Brand, ThemeToggle } from "@/components/AdminShell";
import { AccountActions } from "@/components/AccessGate";
import { MilitaryWorkspace, type ReleaseAction } from "@/components/MilitaryWorkspace";
import { IdentifierDesk, type IdentifierChange } from "@/components/IdentifierDesk";
import type { IdentifierItem } from "@/lib/identifier-desk";
import { MediaDesk } from "@/components/MediaDesk";
import { StoreDesk } from "@/components/StoreDesk";
import { UsersDesk } from "@/components/UsersDesk";
import { ActivityDesk } from "@/components/ActivityDesk";
import { PotdDesk } from "@/components/PotdDesk";
import { useReviewCounts, type ReviewCounts } from "@/components/useReviewCounts";
import { countText, type ReviewCountKey } from "@/lib/review-counts";
import { saveBody, type PotdForm, type PotdItem } from "@/lib/potd-desk";
import type { AuditEvent } from "@/lib/audit-desk";
import "@/components/admin.css";
import {
  accountHeaders,
  accountSignInPath,
} from "@/lib/account";
import type {
  EditorialData,
  EditorialRecord,
  ReviewChecks,
  Submission,
  SubmissionStatus,
} from "@/lib/types";
import {
  categoryNames,
  channelNames,
  editorialErrors,
  reviewError,
} from "@/lib/rules";
import { sampleEditorialRecords } from "@/lib/demo-samples";
import {
  rankName,
  stageNames as prepStageNames,
  type MilitaryDesk,
  type MilitaryItem,
  type PrepEvidence,
  type PrepStage,
} from "@/lib/military-prep";
import { WAIVED_SOURCE_TEXT, factualSourceText } from "@/lib/dev-waiver";
import { sitePath } from "@/lib/paths";
import { rankNames } from "@/lib/catalog";
import { createDraftSession, type Outcome } from "@/lib/editorial/draft-session";
import {
  allSources,
  blockingStatus,
  sectionView,
  sourceStates,
  sourceUrl,
  workspaceSources,
  type SourceResult,
  type SourceStates,
  type WorkspaceSource,
} from "@/lib/workspace-load";

type AdminUser = { sessionKey: string };
type Section =
  | "Overview"
  | "Submissions"
  | "Aircraft Identifier"
  | "Plane of the Day"
  | "Military readiness"
  | "Media"
  | "Store"
  | "Users"
  | "Activity";
type Notice = { kind: "error" | "success"; text: string } | null;

const navItems: { label: Section; icon: typeof SquaresFour }[] = [
  { label: "Overview", icon: SquaresFour },
  { label: "Submissions", icon: ClipboardText },
  { label: "Aircraft Identifier", icon: AirplaneInFlight },
  { label: "Plane of the Day", icon: ImageSquare },
  { label: "Military readiness", icon: AirplaneTilt },
  { label: "Media", icon: Images },
  { label: "Store", icon: Storefront },
  { label: "Users", icon: UsersThree },
  { label: "Activity", icon: ClockCounterClockwise },
];
const checkNames: { key: keyof ReviewChecks; label: string }[] = [
  { key: "identity", label: "Aircraft identity is supported" },
  { key: "quality", label: "Photo quality is suitable" },
  { key: "credit", label: "Photographer credit is correct" },
  { key: "rights", label: "Usage rights are documented" },
  { key: "category", label: "Submission category is accurate" },
];
const ranks = rankNames;

function prettyDate(value: string) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: value.includes("T") ? "short" : undefined,
      }).format(date);
}
function emptyChecks(): ReviewChecks {
  return {
    identity: false,
    quality: false,
    credit: false,
    rights: false,
    category: false,
  };
}
const emptyMilitary: MilitaryDesk = {
  items: [],
  pointer: { current: null, history: [], version: 0 },
  releases: [],
  ownRankCounts: { trainee: 0, "first-officer": 0, captain: 0, "check-airman": 0, "chief-pilot": 0 },
};

function seedData(record: EditorialRecord): EditorialData {
  return { ...record.data, distractors: [...record.data.distractors] };
}
function displayStatus(status: string) {
  return status.replaceAll("_", " ");
}

/** readOnly is the shared demo account's view of the sample drafts; it never calls admin APIs. */
export function AdminApp({
  user,
  readOnly = false,
  manageRoles = false,
}: {
  /** True when roles come from the game backend; mock roles have nothing to manage. */
  manageRoles?: boolean;
  user: AdminUser;
  readOnly?: boolean;
}) {
  const accountSession = useAccountSession();
  const accountRef = useRef(accountSession);
  // Dev Admin only: a Plane of the Day item may go live with no factual source (lib/dev-waiver.ts).
  const devDemoWaiver = useDevDemoWaiver();
  accountRef.current = accountSession;
  const [blockedAccess, setBlockedAccess] = useState<number | null>(null);
  const blockedAccessRef = useRef<number | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  // Base versions, the generation guard and refusal handling; see lib/editorial/draft-session.ts.
  const [drafts] = useState(() =>
    createDraftSession({
      isActive: () => currentAccessRef.current,
      async send(method, url, payload) {
        try {
          const response = await fetch(sitePath(url), {
            method,
            headers: {
              "Content-Type": "application/json",
              ...accountHeaders(userRef.current.sessionKey),
            },
            body: JSON.stringify(payload),
          });
          return {
            ok: response.ok,
            status: response.status,
            body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            body: {
              error: error instanceof Error ? error.message : "The request could not be saved.",
            },
          };
        }
      },
    }),
  );
  const currentAccountMatches =
    accountSession.state === "ready" &&
    !!accountSession.account?.user &&
    (readOnly || accountSession.account.isStaff) &&
    accountSession.account.sessionKey === user.sessionKey &&
    blockedAccess === null;
  const { resolvedTheme } = useTheme();
  const fluentTheme = resolvedTheme === "dark" ? webDarkTheme : webLightTheme;
  const brandBackground = resolvedTheme === "dark" ? "#c64731" : "#a93825";
  const [section, setSection] = useState<Section>("Overview");
  // A Plane of the Day draft just made from the Submissions desk, opened on arrival.
  const [potdArrival, setPotdArrival] = useState("");
  const navRef = useRef<HTMLElement>(null);
  // On phones the sections are a horizontal strip: keep the current one in view.
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [records, setRecords] = useState<EditorialRecord[]>([]);
  const [military, setMilitary] = useState<MilitaryDesk>(emptyMilitary);
  /** Counts Military reloads, so an older answer that lands late never replaces a newer one. */
  const militaryReloads = useRef(0);
  const [identifier, setIdentifier] = useState<IdentifierItem[]>([]);
  const identifierReloads = useRef(0);
  const [potd, setPotd] = useState<PotdItem[]>([]);
  const potdReloads = useRef(0);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [sources, setSources] = useState<SourceStates>(() =>
    allSources({ state: "loading" }),
  );
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [checks, setChecks] = useState<ReviewChecks>(emptyChecks());
  const [reviewNote, setReviewNote] = useState("");
  const [recordId, setRecordId] = useState("");
  const [recordData, setRecordData] = useState<EditorialData | null>(null);
  const [dateKey, setDateKey] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const clearPrivateData = useCallback(() => {
    drafts.reset();
    setSubmissions([]);
    setRecords([]);
    setMilitary(emptyMilitary);
    setIdentifier([]);
    setPotd([]);
    // A draft opened on arrival belongs to the account that made it.
    setPotdArrival("");
    setEvents([]);
    setSelectedId("");
    setRecordId("");
    setRecordData(null);
    setChecks(emptyChecks());
    setReviewNote("");
    setSources(allSources({ state: "loading" }));
    setBusy(false);
  }, [drafts]);

  const blockAccess = useCallback(
    (status: number) => {
      blockedAccessRef.current = status;
      setBlockedAccess(status);
      clearPrivateData();
      accountRef.current.reportAccess(status);
    },
    [clearPrivateData],
  );

  // The review lists live on the game backend: an admin on backend roles only, never the view-only demo.
  const reviewDesks = manageRoles && !readOnly;
  // Read only once the account is confirmed, like the other desks; read again whenever the Overview or Submissions opens.
  const reviews = useReviewCounts(
    user.sessionKey,
    reviewDesks && currentAccountMatches,
    blockAccess,
    section === "Overview" || section === "Submissions" ? section : "",
  );

  /** The Aircraft Identifier desk's read (A3.2). An item never goes back to an older version than one already shown. */
  function applyIdentifier(body: Record<string, unknown>) {
    const items = Array.isArray(body.items) ? (body.items as IdentifierItem[]) : [];
    setIdentifier((previous) =>
      items.map((item) => {
        const known = previous.find((each) => each.id === item.id);
        return known && known.version > item.version ? known : item;
      }),
    );
  }

  /** The Plane of the Day desk's read (A3.3). An item never goes back to an older version than one already shown. */
  function applyPotd(body: Record<string, unknown>) {
    const items = Array.isArray(body.items) ? (body.items as PotdItem[]) : [];
    setPotd((previous) =>
      items.map((item) => {
        const known = previous.find((each) => each.id === item.id);
        return known && known.version > item.version ? known : item;
      }),
    );
  }

  const fetchAll = useCallback(async () => {
    const session = accountRef.current;
    if (
      session.state !== "ready" ||
      !session.account?.user ||
      (!readOnly && !session.account.isStaff) ||
      session.account.sessionKey !== user.sessionKey ||
      blockedAccessRef.current !== null ||
      !currentAccessRef.current
    )
      return;
    const requestGeneration = drafts.invalidate();
    if (readOnly) {
      setRecords(sampleEditorialRecords());
      setSources(allSources({ state: "ready" }));
      return;
    }
    setSources(allSources({ state: "loading" }));
    // Each source loads on its own (A3.0): one that fails shows on its own desks, not the whole workspace.
    const headers = accountHeaders(user.sessionKey);
    const loaded = await Promise.all(
      workspaceSources.map(async (source): Promise<[WorkspaceSource, SourceResult]> => {
        try {
          const response = await fetch(sitePath(sourceUrl[source]), {
            cache: "no-store",
            headers,
          });
          return [
            source,
            { status: response.status, body: await response.json().catch(() => ({})) },
          ];
        } catch (error) {
          return [
            source,
            { status: 0, body: { error: error instanceof Error ? error.message : "" } },
          ];
        }
      }),
    );
    if (requestGeneration !== drafts.generation()) return;
    const results = Object.fromEntries(loaded) as Record<WorkspaceSource, SourceResult>;
    // An account mismatch from any source blocks everything; no source's private data is applied.
    const blocked = blockingStatus(results);
    if (blocked !== null) {
      blockAccess(blocked);
      return;
    }
    if (!drafts.isCurrent(requestGeneration)) return;
    const states = sourceStates(results);
    const body = (source: WorkspaceSource) =>
      states[source].state === "ready"
        ? ((results[source].body ?? {}) as Record<string, unknown>)
        : {};
    const submissionBody = body("submissions");
    const contentBody = body("content");
    const auditBody = body("audit");
    setSubmissions(
      Array.isArray(submissionBody.submissions)
        ? (submissionBody.submissions as Submission[])
        : [],
    );
    setRecords(
      Array.isArray(contentBody.records)
        ? (contentBody.records as EditorialRecord[])
        : [],
    );
    applyMilitary(body("military"));
    applyIdentifier(body("identifier"));
    applyPotd(body("potd"));
    setEvents(
      Array.isArray(auditBody.events)
        ? (auditBody.events as AuditEvent[])
        : [],
    );
    setSources(states);
  }, [blockAccess, drafts, readOnly, user.sessionKey]);

  const currentAccessRef = useRef(currentAccountMatches);
  currentAccessRef.current = currentAccountMatches;

  useEffect(() => {
    if (currentAccountMatches) void fetchAll();
    else if (accountSession.state === "ready" || blockedAccess !== null)
      clearPrivateData();
    else drafts.invalidate();
  }, [
    currentAccountMatches,
    accountSession.state,
    blockedAccess,
    fetchAll,
    clearPrivateData,
    drafts,
  ]);

  const selected =
    submissions.find((submission) => submission.id === selectedId) ?? null;
  const selectedRecord =
    records.find((record) => record.id === recordId) ?? null;
  const pending = submissions.filter(
    (item) => item.status === "pending",
  ).length;
  const returned = submissions.filter(
    (item) => item.status === "changes_requested",
  ).length;
  const filteredSubmissions = useMemo(
    () =>
      submissions.filter((item) => {
        const query = search.trim().toLowerCase();
        return (
          (filterStatus === "all" || item.status === filterStatus) &&
          (filterCategory === "all" || item.data.category === filterCategory) &&
          (!query ||
            [
              item.data.title,
              item.data.photographer,
              item.data.aircraft,
              item.data.registration,
              item.data.location,
            ]
              .join(" ")
              .toLowerCase()
              .includes(query))
        );
      }),
    [submissions, filterStatus, filterCategory, search],
  );

  /** Reports a request that did not succeed. A stale response is dropped silently. */
  function failed(outcome: Outcome, refreshOnConflict = false) {
    switch (outcome.kind) {
      case "ok":
      case "stale":
        return;
      case "blocked":
        blockAccess(outcome.status);
        return;
      case "conflict":
        setNotice({
          kind: "error",
          text: `${outcome.message} Your form has been kept. Select the item again to load its latest version; that replaces your unsaved changes.`,
        });
        if (refreshOnConflict) void fetchAll();
        return;
      case "refused":
        setNotice({
          kind: "error",
          text: outcome.errors.length
            ? `${outcome.message} ${outcome.errors.join(" ")}`
            : outcome.message,
        });
        return;
      case "inactive":
        setNotice({ kind: "error", text: outcome.message });
    }
  }
  function openSubmission(item: Submission) {
    setSelectedId(item.id);
    drafts.open(`submission:${item.id}`, item.version);
    setChecks({ ...emptyChecks(), ...item.checks });
    setReviewNote(item.reviewNote ?? "");
    setNotice(null);
  }
  function openRecord(record: EditorialRecord) {
    setRecordId(record.id);
    drafts.open(`content:${record.id}`, record.version);
    setRecordData(seedData(record));
    setDateKey(record.dateKey ?? new Date().toLocaleDateString("en-CA"));
    setNotice(null);
  }
  async function review(next: SubmissionStatus) {
    if (!selected) return;
    const localError = reviewError(
      selected.data,
      selected.status,
      next,
      checks,
      reviewNote,
    );
    if (localError) {
      setNotice({ kind: "error", text: localError });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await drafts.save(
        `submission:${selected.id}`,
        "PATCH",
        `/api/admin/submissions/${selected.id}`,
        { status: next, checks, note: reviewNote },
        (body) => (body.submission as Submission | undefined)?.version,
      );
      if (outcome.kind !== "ok") return failed(outcome, true);
      const updated = outcome.body.submission as Submission;
      setSubmissions((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice({
        kind: "success",
        text:
          next === "approved"
            ? "Submission approved for editorial use. No game content was published."
            : next === "rejected"
              ? "Submission rejected."
              : "Changes requested from the contributor.",
      });
      if (next !== "approved") setSelectedId("");
      await fetchAll();
    } finally {
      setBusy(false);
    }
  }
  async function createContent(
    payload:
      | { kind: "identifier" | "potd"; sourceId: string }
      | { kind: "identifier" | "potd"; sample: true },
  ) {
    const outcome = await drafts.request("POST", "/api/admin/content", payload);
    if (outcome.kind !== "ok") {
      failed(outcome);
      return null;
    }
    const created = outcome.body.record as EditorialRecord;
    setRecords((previous) => [
      created,
      ...previous.filter((item) => item.id !== created.id),
    ]);
    openRecord(created);
    return created;
  }
  async function createFromSubmission(kind: "identifier" | "potd") {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    try {
      if (await createContent({ kind, sourceId: selected.id }))
        setSection(
          kind === "identifier" ? "Aircraft Identifier" : "Plane of the Day",
        );
    } finally {
      setBusy(false);
    }
  }
  async function createSample(kind: "identifier" | "potd") {
    setBusy(true);
    setNotice(null);
    try {
      await createContent({ kind, sample: true });
    } finally {
      setBusy(false);
    }
  }
  async function loadDemoData() {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await drafts.request("POST", "/api/admin/demo", {});
      if (outcome.kind !== "ok") return failed(outcome);
      await fetchAll();
      setNotice({
        kind: "success",
        text: "Demo records loaded; these cannot be published.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function saveRecord(status: EditorialRecord["status"]) {
    if (!selectedRecord || !recordData) return;
    if (status === "scheduled" || status === "published") {
      const errors = editorialErrors(selectedRecord.kind, recordData, { devDemoWaiver });
      if (errors.length) {
        setNotice({ kind: "error", text: errors.join(" ") });
        return;
      }
      if (!selectedRecord.sourceId) {
        setNotice({
          kind: "error",
          text: "This sample is preview-only. Create content from an approved submission with the required rights to publish.",
        });
        return;
      }
    }
    const effectiveStatus =
      status === "published" && selectedRecord.kind === "potd"
        ? "scheduled"
        : status;
    const effectiveDate =
      selectedRecord.kind === "potd" && status === "published"
        ? new Date().toLocaleDateString("en-CA")
        : dateKey;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await drafts.save(
        `content:${selectedRecord.id}`,
        "PUT",
        `/api/admin/content/${selectedRecord.id}`,
        {
          data: recordData,
          status: effectiveStatus,
          dateKey: effectiveStatus === "scheduled" ? effectiveDate : dateKey,
        },
        (body) => (body.record as EditorialRecord | undefined)?.version,
      );
      if (outcome.kind !== "ok") return failed(outcome, true);
      const updated = outcome.body.record as EditorialRecord;
      setRecords((previous) =>
        previous.map((record) => (record.id === updated.id ? updated : record)),
      );
      setRecordData(seedData(updated));
      setDateKey(updated.dateKey ?? effectiveDate);
      setNotice({
        kind: "success",
        text:
          selectedRecord.kind === "identifier" && status === "published"
            ? "Marked prototype-ready. This does not connect to the game backend."
            : status === "published"
              ? "Plane of the Day is scheduled for today in your local calendar."
              : status === "archived"
                ? "Content archived."
                : "Draft saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  /** The Military desk's read (A3.1): the backend items with the release state. */
  function applyMilitary(body: Record<string, unknown>) {
    const pointer =
      body.pointer && typeof body.pointer === "object"
        ? (body.pointer as MilitaryDesk["pointer"])
        : emptyMilitary.pointer;
    const items = Array.isArray(body.items) ? (body.items as MilitaryItem[]) : [];
    setMilitary((previous) => ({
      // A reload that started before a save can land after it: never replace an item with an older version.
      items: items.map((item) => {
        const known = previous.items.find((each) => each.id === item.id);
        return known && known.version > item.version ? known : item;
      }),
      pointer,
      releases: Array.isArray(body.releases)
        ? (body.releases as MilitaryDesk["releases"])
        : [],
      ownRankCounts:
        body.ownRankCounts && typeof body.ownRankCounts === "object"
          ? (body.ownRankCounts as MilitaryDesk["ownRankCounts"])
          : emptyMilitary.ownRankCounts,
    }));
    // Making a release live or restoring one is based on the pointer the desk last showed.
    drafts.open("military-live", pointer.version);
  }

  /**
   * Reloads only the Military desk, in place: the desk stays mounted, so an open question keeps its typed form. Used
   * after a conflict, an approval and a release step. Returns "" when the desk was reloaded (or a newer reload took
   * over), else why not.
   */
  function reloadMilitary(): Promise<string> {
    return reloadDesk("/api/admin/military", "Military", militaryReloads, applyMilitary);
  }

  /**
   * Reloads one backend desk in place. Answers that belong to an earlier account check, or that a newer reload of the
   * same desk overtook, are dropped. Returns "" when the desk was reloaded (or a newer reload took over), else why not.
   */
  async function reloadDesk(
    url: string,
    name: string,
    reloads: { current: number },
    apply: (body: Record<string, unknown>) => void,
  ): Promise<string> {
    const generation = drafts.generation();
    const sequence = ++reloads.current;
    let status = 0;
    let body: Record<string, unknown> = {};
    try {
      const response = await fetch(sitePath(url), {
        cache: "no-store",
        headers: accountHeaders(user.sessionKey),
      });
      status = response.status;
      body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      status = 0;
    }
    if (!drafts.isCurrent(generation)) return "";
    if (status === 401 || status === 403 || body.code === "ACCOUNT_CHANGED") {
      blockAccess(status || 409);
      return "";
    }
    // A newer reload was started after this one: its answer is the one to show.
    if (sequence !== reloads.current) return "";
    if (status < 200 || status >= 300)
      return `The ${name} desk could not reload, so it may not show the latest state. ${typeof body.error === "string" ? body.error : "Reload the page."}`;
    apply(body);
    return "";
  }

  /** The editor opened a question: later writes are based on this version. */
  function openIdentifier(id: string, version: number) {
    drafts.open(`identifier:${id}`, version);
  }

  /** Edits, retires, restores or relinks one question. A conflict reloads the desk in place and keeps the form. */
  async function changeIdentifier(item: IdentifierItem, change: IdentifierChange): Promise<IdentifierItem | null> {
    setBusy(true);
    setNotice(null);
    try {
      const path = `/api/admin/identifier/${encodeURIComponent(item.id)}`;
      const adopt = (body: Record<string, unknown>) => (body.item as IdentifierItem | undefined)?.version;
      const key = `identifier:${item.id}`;
      const outcome =
        change.kind === "edit"
          ? await drafts.save(key, "PATCH", path, {
              rank: change.rank,
              data: { answer: change.answer, wrong: change.wrong, sourceFile: item.data.sourceFile },
            }, adopt)
          : change.kind === "media"
            ? await drafts.save(key, "PUT", `${path}/media`, { mediaId: change.mediaId }, adopt, "expectedVersion")
            : await drafts.save(key, "POST", `${path}/${change.kind}`, {}, adopt);
      if (outcome.kind !== "ok") {
        if (outcome.kind !== "conflict") {
          failed(outcome);
          return null;
        }
        setNotice({
          kind: "error",
          text: `${outcome.message} Your form has been kept and the list reloaded. Select the question again to load its latest version; that replaces your unsaved changes.`,
        });
        void reloadDesk("/api/admin/identifier", "Aircraft Identifier", identifierReloads, applyIdentifier).then(
          (problem) => problem && setNotice({ kind: "error", text: `${outcome.message} ${problem}` }),
        );
        return null;
      }
      const updated = outcome.body.item as IdentifierItem;
      setIdentifier((previous) => previous.map((each) => (each.id === updated.id ? updated : each)));
      setNotice({
        kind: "success",
        text:
          outcome.body.changed === false
            ? "Nothing changed, so nothing was saved."
            : change.kind === "edit"
              ? `${updated.id} saved.`
              : change.kind === "media"
                ? updated.mediaId
                  ? `${updated.id} now shows photo ${updated.mediaId}.`
                  : `${updated.id} has no photo linked now.`
                : change.kind === "retire"
                  ? `${updated.id} retired. It is kept but no longer dealt.`
                  : `${updated.id} restored.`,
      });
      return updated;
    } finally {
      setBusy(false);
    }
  }

  /** The editor opened a Plane of the Day item: its save is based on this version. */
  function openPotd(id: string, version: number) {
    drafts.open(`potd:${id}`, version);
  }

  /** Saves an item's whole editable state. A conflict reloads the desk in place and keeps the form. */
  async function savePotd(item: PotdItem, form: PotdForm): Promise<PotdItem | null> {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await drafts.save(
        `potd:${item.id}`,
        "PUT",
        `/api/admin/plane-of-the-day/${encodeURIComponent(item.id)}`,
        saveBody(form),
        (body) => (body.item as PotdItem | undefined)?.version,
      );
      if (outcome.kind !== "ok") {
        if (outcome.kind !== "conflict") {
          failed(outcome);
          return null;
        }
        setNotice({
          kind: "error",
          text: `${outcome.message} Your form has been kept and the list reloaded. Select the item again to load its latest version; that replaces your unsaved changes.`,
        });
        void reloadDesk("/api/admin/plane-of-the-day", "Plane of the Day", potdReloads, applyPotd).then(
          (problem) => problem && setNotice({ kind: "error", text: `${outcome.message} ${problem}` }),
        );
        return null;
      }
      const updated = outcome.body.item as PotdItem;
      setPotd((previous) => previous.map((each) => (each.id === updated.id ? updated : each)));
      setNotice({
        kind: "success",
        text:
          outcome.body.changed === false
            ? "Nothing changed, so nothing was saved."
            : updated.status === "scheduled"
              ? `${updated.id} is scheduled for ${updated.dateKey}.`
              : updated.status === "published"
                ? `${updated.id} is published for ${updated.dateKey}.`
                : `${updated.id} saved as ${updated.status}.`,
      });
      return updated;
    } finally {
      setBusy(false);
    }
  }

  /** What the Submissions desk offers once a photo is published there. */
  function photoActions(item: { id: string }) {
    return (
      <>
        <Button
          appearance="primary"
          disabled={busy}
          onClick={async () => {
            const created = await createPotd(item.id);
            if (!created) return;
            // Record the version saves are based on now, as opening it by hand would, then open it on arrival.
            openPotd(created.id, created.version);
            setPotdArrival(created.id);
            setSection("Plane of the Day");
          }}
        >
          Start a Plane of the Day draft
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setNotice({ kind: "success", text: `Photo ${item.id} is ready to link: open a question and choose it.` });
            setSection("Aircraft Identifier");
          }}
        >
          Link to an Aircraft Identifier question
        </Button>
      </>
    );
  }

  /** Creates a draft for a published photo. Nothing is prefilled; the backend checks the photo. */
  async function createPotd(mediaId: string): Promise<PotdItem | null> {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await drafts.request("POST", "/api/admin/plane-of-the-day", { mediaId });
      if (outcome.kind !== "ok") {
        failed(outcome);
        return null;
      }
      const created = outcome.body.item as PotdItem;
      setPotd((previous) => [created, ...previous.filter((each) => each.id !== created.id)]);
      setNotice({ kind: "success", text: `Draft ${created.id} created for photo ${created.mediaId}.` });
      return created;
    } finally {
      setBusy(false);
    }
  }

  /** A Military request that did not succeed. A conflict reloads the desk; an open question keeps its form. */
  function militaryFailed(outcome: Outcome, what: "question" | "release") {
    if (outcome.kind !== "conflict") return failed(outcome);
    setNotice({
      kind: "error",
      text:
        what === "question"
          ? `${outcome.message} Your form has been kept and the list reloaded. Select the question again to load its latest version; that replaces your unsaved changes.`
          : `${outcome.message} The desk has been reloaded.`,
    });
    void reloadMilitary().then((problem) => {
      if (problem) setNotice({ kind: "error", text: `${outcome.message} ${problem}` });
    });
  }

  /** Uploads a release, makes an uploaded one live, or restores the previous one. Recorded, never delivered. */
  async function changeRelease(step: ReleaseAction) {
    setBusy(true);
    setNotice(null);
    try {
      const outcome =
        step.action === "upload"
          ? await drafts.request("POST", "/api/admin/military/releases", {
              itemIds: step.itemIds,
              basis: step.basis,
              previewed: true,
            })
          : await drafts.save(
              "military-live",
              "POST",
              step.action === "activate"
                ? `/api/admin/military/releases/${step.release}/activate`
                : "/api/admin/military/releases/restore",
              {},
              (body) => (body.pointer as { version?: number } | undefined)?.version,
              "expectedPointerVersion",
            );
      if (outcome.kind !== "ok") {
        militaryFailed(outcome, "release");
        return false;
      }
      const number =
        step.action === "upload"
          ? (outcome.body.number as number | undefined)
          : (outcome.body.pointer as { current?: number | null } | undefined)?.current;
      const problem = await reloadMilitary();
      const done =
        step.action === "upload"
          ? `Release ${number} uploaded. It is not live yet; make it live when you are ready. Nothing reaches a player.`
          : step.action === "activate"
            ? `Release ${number} is now the current release. It is recorded, not delivered; Military stays Coming Soon.`
            : `Release ${number} is current again.`;
      // The step happened; if the desk could not show it, say so rather than invite a second upload.
      setNotice(problem ? { kind: "error", text: `${done} ${problem}` } : { kind: "success", text: done });
      return true;
    } finally {
      setBusy(false);
    }
  }

  /** The editor opened a question: later saves are based on this version. */
  function openMilitary(id: string, version: number) {
    drafts.open(`military:${id}`, version);
  }
  async function saveMilitary(
    item: MilitaryItem,
    stage: PrepStage,
    evidence: PrepEvidence,
    mediaId: string | null,
  ): Promise<MilitaryItem | null> {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await drafts.save(
        `military:${item.id}`,
        "PUT",
        `/api/admin/military/${encodeURIComponent(item.id)}/preparation`,
        { stage, evidence, mediaId },
        (body) => (body.item as MilitaryItem | undefined)?.version,
      );
      if (outcome.kind !== "ok") {
        militaryFailed(outcome, "question");
        return null;
      }
      const updated = outcome.body.item as MilitaryItem;
      setMilitary((previous) => ({
        ...previous,
        items: previous.items.map((each) => (each.id === updated.id ? updated : each)),
      }));
      // The own-rank counts move with approvals; refresh them without touching the open form.
      if (stage === "approved" || item.preparation?.stage === "approved")
        void reloadMilitary().then((problem) => problem && setNotice({ kind: "error", text: problem }));
      setNotice({
        kind: "success",
        text:
          outcome.body.changed === false
            ? "Nothing changed, so nothing was saved."
            : stage === "approved"
              ? `${updated.data.answer} (${rankName(updated.rank)}) approved. Nothing was published; Military stays Coming Soon.`
              : `${updated.data.answer} saved as ${prepStageNames[stage]}.`,
      });
      return updated;
    } finally {
      setBusy(false);
    }
  }

  const view = sectionView(section, sources);
  // The demo preview keeps the sample Aircraft Identifier drafts; staff use the backend desk (A3.2).
  const contentKind = section === "Aircraft Identifier" ? "identifier" : "potd";
  const contentRecords = records.filter(
    (record) =>
      record.kind === contentKind &&
      (showArchived || record.status !== "archived"),
  );

  if (!currentAccountMatches) {
    const sessionError = accountSession.state === "error";
    const signedOut =
      accountSession.state === "ready" && !accountSession.account?.user;
    const permissionDenied =
      blockedAccess === 403 ||
      (accountSession.state === "ready" &&
        !!accountSession.account?.user &&
        !accountSession.account.isStaff);
    const changed =
      accountSession.state === "ready" &&
      !!accountSession.account?.user &&
      accountSession.account.sessionKey !== user.sessionKey;
    return (
      <main className="admin-gate" id="main">
        <section
          className="admin-gate-card"
          role={sessionError || permissionDenied ? "alert" : undefined}
        >
          <p className="eyebrow">EDITORIAL WORKSPACE</p>
          <h1>
            {sessionError
              ? "Account check unavailable"
              : permissionDenied
                ? "Staff access required"
                : signedOut
                  ? "Sign in to continue"
                  : changed || blockedAccess
                    ? "Account session changed"
                    : "Checking account…"}
          </h1>
          <p>
            {sessionError
              ? "We could not confirm this account. Retry the check before continuing."
              : permissionDenied
                ? "This account no longer has staff access to the editorial workspace."
                : signedOut
                  ? "Your sign-in expired. Sign in again to reopen the workspace."
                  : changed || blockedAccess
                    ? "Private editorial data was cleared and pending writes were stopped. Sign in again or reload after choosing the account you want to use."
                    : "Confirming your staff session before loading private editorial data."}
          </p>
          <AccountActions
            onRetry={
              sessionError ? () => void accountSession.refresh() : undefined
            }
            signInHref={
              signedOut || changed || blockedAccess === 401
                ? accountSignInPath("/admin")
                : null
            }
            reloadLabel="Reload workspace"
          />
        </section>
      </main>
    );
  }

  return (
    <FluentProvider
      theme={{
        ...fluentTheme,
        colorNeutralBackground1: "var(--surface)",
        colorNeutralBackground2: "var(--panel)",
        colorNeutralForeground1: "var(--ink)",
        colorNeutralForeground2: "var(--muted)",
        colorNeutralForeground4: "var(--muted)",
        colorNeutralStroke1: "var(--line)",
        colorNeutralForegroundOnBrand: "#fff9ee",
        colorBrandBackground: brandBackground,
        colorBrandBackgroundHover: "#92301f",
        colorBrandForeground1: "var(--brass)",
        colorStatusSuccessBackground1: "var(--panel)",
        colorStatusSuccessForeground1: "var(--success)",
        colorStatusDangerBackground1: "var(--panel)",
        colorStatusDangerForeground1: "var(--error)",
        fontFamilyBase: "Poppins, sans-serif",
        fontFamilyNumeric: "Poppins, sans-serif",
      }}
      className="admin-fluent"
    >
      <div className="admin-app">
        <div className="admin-layout">
          <aside className="admin-sidebar">
            <div className="admin-brand">
              <Brand />
              <span className="admin-brand-caption">
                {readOnly ? "Demo preview · view only" : "Editorial workspace"}
              </span>
            </div>
            <nav ref={navRef} aria-label="Admin sections" className="admin-nav">
              <span className="admin-nav-caption">WORKSPACE</span>
              {(readOnly
                ? navItems.filter(
                    ({ label }) =>
                      label !== "Submissions" &&
                      label !== "Military readiness" &&
                      label !== "Media" &&
                      label !== "Store" &&
                      label !== "Users" &&
                      label !== "Activity",
                  )
                : navItems.filter(
                    ({ label }) =>
                      manageRoles ||
                      (label !== "Users" && label !== "Media" && label !== "Store" && label !== "Submissions"),
                  )
              ).map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  onClick={() => {
                    setSection(label);
                    setPotdArrival("");
                    setSelectedId("");
                    setRecordId("");
                    setNotice(null);
                  }}
                  className={`admin-nav-item ${section === label ? "active" : ""}`}
                  aria-current={section === label ? "page" : undefined}
                >
                  <Icon
                    size={19}
                    weight={section === label ? "fill" : "regular"}
                  />
                  {label}
                  {label === "Submissions" && reviewDesks && !!reviews.counts.toReview?.n && (
                    <span className="admin-nav-count">
                      {countText(reviews.counts.toReview)}
                      <span className="sr-only"> to review</span>
                    </span>
                  )}
                </button>
              ))}
            </nav>
            <div className="admin-side-bottom">
              <ShieldCheck size={17} />
              <span>
                {readOnly ? "Sample drafts" : "Private editorial tools"}
                <br />
                <small>
                  {readOnly
                    ? "Viewing only; nothing can be changed"
                    : "Changes are recorded in Activity"}
                </small>
              </span>
            </div>
          </aside>
          <main className="admin-main">
            <header className="admin-topbar">
              <div className="admin-topbar-title">
                <span className="admin-breadcrumb">Editorial /</span>
                <b>{section}</b>
              </div>
              <div className="admin-topbar-tools">
                <ThemeToggle />
                <AccountControl />
              </div>
            </header>
            <div className="admin-content">
              {notice && (
                <div
                  className={`admin-message ${notice.kind}`}
                  role={notice.kind === "error" ? "alert" : "status"}
                >
                  <MessageBar
                    intent={notice.kind === "error" ? "error" : "success"}
                  >
                    <MessageBarBody>{notice.text}</MessageBarBody>
                  </MessageBar>
                  <button
                    className="admin-message-close"
                    aria-label="Dismiss"
                    onClick={() => setNotice(null)}
                  >
                    ×
                  </button>
                </div>
              )}
              {view.view === "loading" && (
                <div className="admin-loading" aria-label={`Loading ${section}`}>
                  {[0, 1, 2].map((item) => (
                    <div className="skeleton" key={item} />
                  ))}
                </div>
              )}
              {view.view === "error" && (
                <section className="admin-panel admin-load-error" role="alert">
                  <h2>Could not load {section}</h2>
                  <DeskErrors errors={view.errors} />
                  <Button
                    appearance="primary"
                    icon={<ArrowClockwise size={17} />}
                    onClick={() => void fetchAll()}
                  >
                    Retry
                  </Button>
                </section>
              )}
              {view.view === "ready" && (
                <>
                  {section === "Overview" && view.unavailable.length > 0 && (
                    <section className="admin-panel admin-load-error" role="status">
                      <h2>Some desks could not load</h2>
                      <p>
                        The counts below leave out what could not load. Other
                        desks keep working.
                      </p>
                      <DeskErrors errors={view.unavailable} />
                      <Button
                        icon={<ArrowClockwise size={17} />}
                        onClick={() => void fetchAll()}
                      >
                        Retry
                      </Button>
                    </section>
                  )}
                  {section === "Overview" && (
                    <Overview
                      records={records}
                      events={events}
                      onNavigate={setSection}
                      readOnly={readOnly}
                      reviews={reviewDesks ? reviews : null}
                      unavailable={view.unavailable.map(({ source }) => source)}
                      identifierCount={
                        readOnly
                          ? records.filter((item) => item.kind === "identifier" && item.status !== "archived").length
                          : identifier.filter((item) => item.status !== "retired").length
                      }
                      potdCount={
                        readOnly
                          ? records.filter((item) => item.kind === "potd" && item.status !== "archived").length
                          : potd.filter((item) => item.status !== "archived").length
                      }
                    />
                  )}
                  {section === "Submissions" && !readOnly && manageRoles && (
                    <MediaDesk
                      key={user.sessionKey}
                      sessionKey={user.sessionKey}
                      onBlocked={blockAccess}
                      only={["unverified", "changes"]}
                      eyebrow="REVIEW"
                      title="Submissions"
                      intro="Photos waiting for review, from photographers and from staff. Check each one, correct its licence, and publish it."
                      footnote="Only the photographer can state a photo's rights. Publishing freezes a version's licence and credit; the photo reaches a game once it is used for Plane of the Day or linked to a question."
                      onWritten={reviews.refresh}
                      review={{
                        afterPublish: photoActions,
                        confirmNote:
                          "Once it is published you can start a Plane of the Day draft from it or link it to an Aircraft Identifier question.",
                      }}
                    >
                      <section className="admin-panel review-photographers" aria-labelledby="review-photographers-title">
                        <div>
                          <h2 id="review-photographers-title">New photographers</h2>
                          <p>
                            {reviews.counts.photographers
                              ? `${countText(reviews.counts.photographers)} waiting for approval.`
                              : reviews.loading
                                ? "Checking…"
                                : "The photographer requests could not be read."}{" "}
                            Approve them in Users so they can send photos.
                          </p>
                        </div>
                        <div className="admin-actions">
                          <Button onClick={() => setSection("Users")}>Open photographer requests</Button>
                          <Button icon={<ArrowClockwise size={16} />} onClick={reviews.refresh}>
                            Reload
                          </Button>
                        </div>
                      </section>
                    </MediaDesk>
                  )}
                  {section === "Aircraft Identifier" && !readOnly && (
                    <IdentifierDesk
                      items={identifier}
                      sessionKey={user.sessionKey}
                      busy={busy}
                      onOpen={openIdentifier}
                      onChange={changeIdentifier}
                      onBlocked={blockAccess}
                      onOpenMedia={manageRoles ? () => setSection("Media") : undefined}
                    />
                  )}
                  {section === "Plane of the Day" && !readOnly && (
                    <PotdDesk
                      key={user.sessionKey}
                      items={potd}
                      sessionKey={user.sessionKey}
                      busy={busy}
                      devDemoWaiver={devDemoWaiver}
                      onOpen={openPotd}
                      onSave={savePotd}
                      onCreate={createPotd}
                      onBlocked={blockAccess}
                      onOpenMedia={manageRoles ? () => setSection("Media") : undefined}
                      initialOpenId={potdArrival}
                    />
                  )}
                  {(section === "Aircraft Identifier" || section === "Plane of the Day") && readOnly && (
                    <ContentWorkspace
                      kind={contentKind}
                      records={contentRecords}
                      selected={selectedRecord}
                      data={recordData}
                      dateKey={dateKey}
                      setDateKey={setDateKey}
                      onOpen={openRecord}
                      onChange={setRecordData}
                      onSave={saveRecord}
                      onCreateSample={() => void createSample(contentKind)}
                      busy={busy}
                      showArchived={showArchived}
                      setShowArchived={setShowArchived}
                      readOnly={readOnly}
                    />
                  )}
                  {section === "Military readiness" && !readOnly && (
                    <MilitaryWorkspace
                      desk={military}
                      sessionKey={user.sessionKey}
                      busy={busy}
                      onOpen={openMilitary}
                      onSave={saveMilitary}
                      onRelease={changeRelease}
                      onBlocked={blockAccess}
                      onOpenMedia={manageRoles ? () => setSection("Media") : undefined}
                    />
                  )}
                  {section === "Media" && !readOnly && manageRoles && (
                    <MediaDesk
                      key={user.sessionKey}
                      sessionKey={user.sessionKey}
                      onBlocked={blockAccess}
                      only={["published", "withdrawn", "all"]}
                      onWritten={reviews.refresh}
                      intro="Every photo the game backend holds. New photos and waiting changes are reviewed in Submissions."
                    />
                  )}
                  {section === "Store" && !readOnly && manageRoles && (
                    <StoreDesk sessionKey={user.sessionKey} onBlocked={blockAccess} />
                  )}
                  {section === "Users" && !readOnly && manageRoles && (
                    <UsersDesk sessionKey={user.sessionKey} onBlocked={blockAccess} />
                  )}
                  {section === "Activity" && <ActivityDesk events={events} />}
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </FluentProvider>
  );
}

function Overview({
  records,
  events,
  onNavigate,
  readOnly,
  reviews,
  unavailable,
  identifierCount,
  potdCount,
}: {
  /** The view-only demo's sample drafts; staff never see this count. */
  records: EditorialRecord[];
  events: AuditEvent[];
  onNavigate: (section: Section) => void;
  readOnly: boolean;
  /** The game backend's review lists (an admin on backend roles); null otherwise, and the review parts are left out. */
  reviews: ReviewCounts | null;
  unavailable: WorkspaceSource[];
  /** Aircraft Identifier questions (the backend desk), or the demo's sample drafts in the view-only preview. */
  identifierCount: number;
  /** Plane of the Day items that are not archived (the backend desk), or the demo's sample drafts. */
  potdCount: number;
}) {
  const missing = (source: WorkspaceSource) => unavailable.includes(source);
  const count = (source: WorkspaceSource, value: number) => (missing(source) ? "—" : value);
  const reviewText = (key: ReviewCountKey) => {
    const found = reviews?.counts[key];
    return found ? countText(found) : "—";
  };
  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">EDITORIAL OPERATIONS</p>
          <h1>{readOnly ? "Demo preview" : "Good to have you back."}</h1>
          <p>
            {readOnly
              ? "Browse the sample editorial drafts. This demo account can view content but cannot edit, review or publish."
              : "Review photos and prepare game content on the game backend."}
          </p>
        </div>
        {reviews && (
          <div className="admin-heading-actions">
            <Button appearance="primary" onClick={() => onNavigate("Submissions")} icon={<ClipboardText size={17} />}>
              Review photos
            </Button>
          </div>
        )}
      </div>
      <div className="admin-stats">
        {reviews && (
          <>
            <Stat
              label="Photos to review"
              value={reviewText("toReview")}
              detail="New photos waiting for a first review"
              icon={<ClipboardText size={20} />}
              onClick={() => onNavigate("Submissions")}
            />
            <Stat
              label="Changes waiting"
              value={reviewText("changes")}
              detail="Published photos with a newer draft"
              icon={<ArrowClockwise size={20} />}
              onClick={() => onNavigate("Submissions")}
            />
          </>
        )}
        {readOnly && (
          <Stat
            label="Content records"
            value={records.length}
            detail="Sample drafts, scheduled and published"
            icon={<Newspaper size={20} />}
            onClick={() => onNavigate("Aircraft Identifier")}
          />
        )}
        {!readOnly && (
          <Stat
            label="Recent activity"
            value={count("audit", events.length)}
            detail="The newest audit events, up to 50"
            icon={<ClockCounterClockwise size={20} />}
            onClick={() => onNavigate("Activity")}
          />
        )}
      </div>
      <div className="admin-split">
        {reviews && (
          <section className="admin-panel">
            <div className="admin-panel-header">
              <div>
                <h2>Photos to review</h2>
                <p>The newest photos waiting for a first review</p>
              </div>
              <button className="admin-text-button" onClick={() => onNavigate("Submissions")}>
                View all <span>→</span>
              </button>
            </div>
            {reviews.failed.includes("toReview") ? (
              <div className="admin-empty">
                <b>The photo list could not load</b>
                <span>It shows again once it loads.</span>
              </div>
            ) : reviews.queue.length ? (
              <div className="admin-queue">
                {reviews.queue.map((id) => (
                  <button className="admin-queue-row" key={id} onClick={() => onNavigate("Submissions")}>
                    <span className="queue-copy">
                      <b>{id}</b>
                      <small>Waiting for review</small>
                    </span>
                    <span className="queue-arrow">→</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="admin-empty">
                <CheckCircle size={25} />
                <b>{reviews.loading ? "Loading…" : "Nothing needs attention"}</b>
                {!reviews.loading && <span>New photos will appear here.</span>}
              </div>
            )}
          </section>
        )}
        <section className="admin-panel overview-shortcuts">
          <div className="admin-panel-header">
            <div>
              <h2>Editorial desks</h2>
              <p>{readOnly ? "View the sample content for each desk" : "Continue preparing approved material"}</p>
            </div>
          </div>
          <button onClick={() => onNavigate("Aircraft Identifier")}>
            <span className="shortcut-icon">
              <AirplaneInFlight size={19} />
            </span>
            <span>
              <b>Aircraft Identifier</b>
              <small>
                {!readOnly && missing("identifier")
                  ? "Could not load"
                  : `${identifierCount} ${readOnly ? "records" : "questions"}`}
              </small>
            </span>
            <span>→</span>
          </button>
          <button onClick={() => onNavigate("Plane of the Day")}>
            <span className="shortcut-icon">
              <ImageSquare size={19} />
            </span>
            <span>
              <b>Plane of the Day</b>
              <small>
                {!readOnly && missing("potd") ? "Could not load" : `${potdCount} ${readOnly ? "records" : "items"}`}
              </small>
            </span>
            <span>→</span>
          </button>
        </section>
      </div>
      {readOnly && (
        <p className="admin-demo-note">
          These are sample drafts for the demo preview. They do not publish into the game backend.
        </p>
      )}
    </>
  );
}

function DeskErrors({
  errors,
}: {
  errors: { source: string; label: string; error: string }[];
}) {
  return (
    <ul className="admin-desk-errors">
      {errors.map(({ source, label, error }) => (
        <li key={source}>
          <b>{label}:</b> <span className="error">{error}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({
  label,
  value,
  detail,
  icon,
  onClick,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="admin-stat" onClick={onClick}>
      <span className="stat-icon">{icon}</span>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  );
}

function Submissions({
  submissions,
  selected,
  status,
  category,
  search,
  setStatus,
  setCategory,
  setSearch,
  onOpen,
  checks,
  setChecks,
  note,
  setNote,
  onReview,
  onCreate,
  busy,
}: {
  submissions: Submission[];
  selected: Submission | null;
  status: string;
  category: string;
  search: string;
  setStatus: (value: string) => void;
  setCategory: (value: string) => void;
  setSearch: (value: string) => void;
  onOpen: (item: Submission) => void;
  checks: ReviewChecks;
  setChecks: (value: ReviewChecks) => void;
  note: string;
  setNote: (value: string) => void;
  onReview: (value: SubmissionStatus) => void;
  onCreate: (kind: "identifier" | "potd") => void;
  busy: boolean;
}) {
  const [compactDetail, setCompactDetail] = useState(Boolean(selected));
  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">COMMUNITY PHOTOGRAPHY</p>
          <h1>Submissions</h1>
          <p>
            Verify the photo, its facts and each proposed use before approving.
          </p>
        </div>
        <span className="admin-total">{submissions.length} shown</span>
      </div>
      <div className="admin-toolbar">
        <Input
          aria-label="Search submissions"
          placeholder="Search title, aircraft, photographer…"
          value={search}
          onChange={(_, data) => setSearch(data.value)}
          contentBefore={<span aria-hidden="true">⌕</span>}
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          {["pending", "changes_requested", "approved", "rejected"].map(
            (item) => (
              <option key={item} value={item}>
                {displayStatus(item)}
              </option>
            ),
          )}
        </select>
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">All categories</option>
          {Object.entries(categoryNames).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div
        className={`admin-split submissions-split ${selected ? "has-selection" : ""}`}
      >
        <section
          className={`admin-panel admin-table-wrap ${selected && compactDetail ? "mobile-hidden" : ""}`}
        >
          <div className="admin-panel-header">
            <div>
              <h2>Photo proposals</h2>
              <p>Most recent submissions first</p>
            </div>
          </div>
          {submissions.length ? (
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Photo</th>
                    <th>Submission</th>
                    <th>Category</th>
                    <th>Received</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((item) => (
                    <tr
                      key={item.id}
                      className={selected?.id === item.id ? "selected" : ""}
                      onClick={() => {
                        onOpen(item);
                        setCompactDetail(true);
                      }}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpen(item);
                          setCompactDetail(true);
                        }
                      }}
                    >
                      <td>
                        <img
                          className="admin-row-photo"
                          src={sitePath(item.photoUrl)}
                          alt=""
                        />
                      </td>
                      <td>
                        <b>{item.data.title}</b>
                        <small>{item.data.photographer}</small>
                      </td>
                      <td>{categoryNames[item.data.category]}</td>
                      <td>{prettyDate(item.createdAt)}</td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-empty">
              <ImageSquare size={26} />
              <b>No matching submissions</b>
              <span>Try a different filter, or check again later.</span>
            </div>
          )}
        </section>
        {selected && (
          <SubmissionDetail
            submission={selected}
            checks={checks}
            setChecks={setChecks}
            note={note}
            setNote={setNote}
            onReview={onReview}
            onCreate={onCreate}
            busy={busy}
            onBack={() => setCompactDetail(false)}
          />
        )}
        {!selected && (
          <section className="admin-panel detail-placeholder">
            <ImageSquare size={28} />
            <b>Select a submission</b>
            <p>Review its photo, facts, consent and proposed use here.</p>
          </section>
        )}
      </div>
    </>
  );
}

function SubmissionDetail({
  submission,
  checks,
  setChecks,
  note,
  setNote,
  onReview,
  onCreate,
  busy,
  onBack,
}: {
  submission: Submission;
  checks: ReviewChecks;
  setChecks: (value: ReviewChecks) => void;
  note: string;
  setNote: (value: string) => void;
  onReview: (value: SubmissionStatus) => void;
  onCreate: (kind: "identifier" | "potd") => void;
  busy: boolean;
  onBack: () => void;
}) {
  const data = submission.data;
  const canReview =
    submission.status === "pending" ||
    submission.status === "changes_requested";
  return (
    <section className="admin-panel review-panel">
      <button className="admin-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to submissions
      </button>
      <div className="review-panel-title">
        <div>
          <p className="eyebrow">SUBMISSION DETAIL</p>
          <h2>{data.title}</h2>
          <StatusBadge status={submission.status} />
        </div>
      </div>
      <a
        className="admin-photo-link"
        href={sitePath(submission.photoUrl)}
        target="_blank"
        rel="noreferrer"
      >
        <img
          className="admin-photo"
          src={sitePath(submission.photoUrl)}
          alt={`Submitted photo: ${data.title}`}
        />
        <span>Open full photo ↗</span>
      </a>
      <div className="admin-metadata">
        <div>
          <span>Photographer</span>
          <b>{data.photographer}</b>
        </div>
        <div>
          <span>Category</span>
          <b>
            {categoryNames[data.category]}
            {data.customCategory ? ` · ${data.customCategory}` : ""}
          </b>
        </div>
        <div>
          <span>Image dimensions</span>
          <b>
            {submission.width} × {submission.height} px ·{" "}
            {(submission.imageBytes / 1048576).toFixed(1)} MB
          </b>
        </div>
        <div>
          <span>Captured</span>
          <b>{data.capturedOn || "Not provided"}</b>
        </div>
        <div>
          <span>Aircraft / subject</span>
          <b>{data.aircraft || "Not provided"}</b>
        </div>
        <div>
          <span>Registration</span>
          <b>{data.registration || "Not provided"}</b>
        </div>
        <div>
          <span>Airline</span>
          <b>{data.airline || "Not provided"}</b>
        </div>
        <div>
          <span>Location / airport</span>
          <b>
            {[data.location, data.airportCode].filter(Boolean).join(" · ") ||
              "Not provided"}
          </b>
        </div>
      </div>
      <div className="admin-detail-copy">
        <h3>Description</h3>
        <p>{data.description}</p>
      </div>
      <div className="admin-detail-copy">
        <h3>Evidence & consent</h3>
        <p>
          <b>Credit:</b> {data.credit}
        </p>
        <p>
          <b>Rights basis:</b>{" "}
          {data.rightsBasis === "owner"
            ? "Photographer owns the image"
            : "Permission / license provided"}
        </p>
        <p>
          <b>Rights evidence:</b> {data.rightsEvidence || "No details provided"}
        </p>
        <p>
          <b>Factual source:</b>{" "}
          {data.factualSource ? (
            <a href={data.factualSource} target="_blank" rel="noreferrer">
              {data.factualSource} ↗
            </a>
          ) : (
            "No source provided"
          )}
        </p>
        <p>
          <b>Contact:</b> <a href={`mailto:${data.email}`}>{data.email}</a>
          {data.portfolio && (
            <>
              {" "}
              ·{" "}
              <a href={data.portfolio} target="_blank" rel="noreferrer">
                Portfolio ↗
              </a>
            </>
          )}
        </p>
        <p>
          <b>Image origin:</b> {data.imageOrigin} · Private review consent{" "}
          {data.consent ? "recorded" : "not recorded"}
        </p>
      </div>
      <div className="admin-detail-copy">
        <h3>Proposed channels</h3>
        <div className="channel-chips">
          {data.channels.map((channel) => (
            <span key={channel}>{channelNames[channel]}</span>
          ))}
        </div>
        {data.targetGames.length > 0 && (
          <p>
            <b>Requested games:</b> {data.targetGames.join(", ")}
          </p>
        )}
      </div>
      {canReview ? (
        <div className="review-form">
          <div className="review-divider">
            <span>EDITOR REVIEW</span>
          </div>
          <fieldset className="review-checks">
            <legend>Verification checks</legend>
            {checkNames.map(({ key, label }) => (
              <Checkbox
                key={key}
                checked={checks[key] === true}
                label={label}
                onChange={(_, data) =>
                  setChecks({ ...checks, [key]: data.checked === true })
                }
              />
            ))}
          </fieldset>
          <label className="admin-field">
            <span>
              Review note{" "}
              <small>
                Required for a change request or rejection (10 characters
                minimum)
              </small>
            </span>
            <Textarea
              value={note}
              onChange={(_, data) => setNote(data.value)}
              rows={3}
              maxLength={2400}
              placeholder="Explain what needs attention, or leave a private note for the review record."
            />
          </label>
          <div className="admin-actions review-actions">
            <Button
              disabled={busy}
              onClick={() => onReview("changes_requested")}
            >
              Request changes
            </Button>
            <Button disabled={busy} onClick={() => onReview("rejected")}>
              Reject
            </Button>
            <Button
              appearance="primary"
              disabled={busy}
              onClick={() => onReview("approved")}
              icon={<CheckCircle size={17} />}
            >
              {busy ? "Saving…" : "Approve submission"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="review-form">
          <p className="admin-demo-note">
            This review is closed. Approval permits editorial use only; it does
            not publish content.
          </p>
          {submission.status === "approved" && (
            <div className="admin-actions">
              <Button
                disabled={!data.channels.includes("games")}
                onClick={() => onCreate("identifier")}
              >
                Use in Aircraft Identifier
              </Button>
              <Button
                disabled={!data.channels.includes("plane-of-the-day")}
                onClick={() => onCreate("potd")}
              >
                Use for Plane of the Day
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ContentWorkspace({
  kind,
  records,
  selected,
  data,
  dateKey,
  setDateKey,
  onOpen,
  onChange,
  onSave,
  onCreateSample,
  busy,
  showArchived,
  setShowArchived,
  readOnly,
}: {
  kind: "identifier" | "potd";
  records: EditorialRecord[];
  selected: EditorialRecord | null;
  data: EditorialData | null;
  dateKey: string;
  setDateKey: (value: string) => void;
  onOpen: (record: EditorialRecord) => void;
  onChange: (data: EditorialData | null) => void;
  onSave: (status: EditorialRecord["status"]) => void;
  onCreateSample: () => void;
  busy: boolean;
  showArchived: boolean;
  setShowArchived: (value: boolean) => void;
  readOnly: boolean;
}) {
  const title =
    kind === "identifier" ? "Aircraft Identifier" : "Plane of the Day";
  const setField = (key: keyof EditorialData, value: string) => {
    if (data) onChange({ ...data, [key]: value });
  };
  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">PROTOTYPE CONTENT</p>
          <h1>{title}</h1>
          <p>
            {kind === "identifier"
              ? "Prepare photo questions and rank-specific content."
              : "Schedule a featured aircraft photo by your local calendar date."}
          </p>
        </div>
        {!readOnly && (
        <Button
          appearance="primary"
          onClick={onCreateSample}
          disabled={busy}
          icon={<ImageSquare size={17} />}
        >
          Load sample content
        </Button>
        )}
      </div>
      <div className="admin-toolbar content-toolbar">
        <label className="admin-check-inline">
          <Checkbox
            checked={showArchived}
            onChange={(_, item) => setShowArchived(item.checked === true)}
            label="Show archived"
          />
        </label>
        <span>
          {records.length} {records.length === 1 ? "record" : "records"}
        </span>
      </div>
      {records.length === 0 && !selected ? (
        <section className="admin-panel admin-content-empty">
          <Newspaper size={32} />
          <h2>No {title} content yet</h2>
          {readOnly ? (
            <p>There is no sample content for this desk.</p>
          ) : (
            <>
          <p>
            Approved submissions with the matching channel permission can be
            added from the submission review. Load a sample to preview the
            editor; sample content cannot be published.
          </p>
          <Button onClick={onCreateSample} disabled={busy}>
            Load sample content
          </Button>
            </>
          )}
        </section>
      ) : (
        <div className="admin-split content-split">
          <section className="admin-panel admin-record-list">
            <div className="admin-panel-header">
              <div>
                <h2>Content records</h2>
                <p>
                  {readOnly
                    ? "Sample drafts · view only"
                    : "Saved in the prototype editorial store"}
                </p>
              </div>
            </div>
            {records.length ? (
              records.map((record) => (
                <button
                  key={record.id}
                  className={`admin-record ${record.id === selected?.id ? "selected" : ""}`}
                  onClick={() => onOpen(record)}
                >
                  <img src={sitePath(record.data.imageUrl)} alt="" />
                  <span>
                    <b>{record.data.title}</b>
                    <small>
                      {record.dateKey
                        ? prettyDate(record.dateKey)
                        : record.data.aircraft}
                    </small>
                  </span>
                  <StatusBadge status={record.status} />
                </button>
              ))
            ) : (
              <div className="admin-empty">
                <b>No visible records</b>
                <span>Try showing archived content.</span>
              </div>
            )}
          </section>
          {selected && data ? (
            <section className="admin-panel content-editor">
              <div className="content-editor-head">
                <div>
                  <button
                    className="admin-back"
                    onClick={() => {
                      onChange(null);
                    }}
                  >
                    <ArrowLeft size={16} /> {readOnly ? "Close" : "Close editor"}
                  </button>
                  <p className="eyebrow">
                    {selected.sourceId
                      ? "APPROVED COMMUNITY PHOTO"
                      : "SAMPLE PREVIEW"}
                  </p>
                  <h2>{readOnly ? "View content" : "Edit content"}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <span className="editor-version">
                  Version {selected.version}
                </span>
              </div>
              {!selected.sourceId && (
                <MessageBar intent="warning" layout="multiline">
                  <MessageBarBody>
                    {readOnly
                      ? "Sample preview only. The demo account can view this draft but cannot change it."
                      : "Sample preview only. Add content from an approved, rights-verified submission to publish."}
                  </MessageBarBody>
                </MessageBar>
              )}
              <div className="editor-preview">
                <img src={sitePath(data.imageUrl)} alt="" />
                <span className="photo-preview-label">
                  PHOTO PREVIEW ·{" "}
                  {selected.sourceId ? "APPROVED SOURCE" : "SAMPLE"}
                </span>
              </div>
              <fieldset className="form-grid admin-fieldset" disabled={readOnly}>
                <TextField
                  label="Editorial title"
                  value={data.title}
                  onChange={(value) => setField("title", value)}
                />
                <TextField
                  label="Aircraft / subject"
                  value={data.aircraft}
                  onChange={(value) => setField("aircraft", value)}
                />
                <TextField
                  label="Photographer"
                  value={data.photographer}
                  onChange={(value) => setField("photographer", value)}
                />
                <TextField
                  label="Credit line"
                  value={data.credit}
                  onChange={(value) => setField("credit", value)}
                />
                <TextField
                  label="Factual source (https://)"
                  value={data.factualSource}
                  onChange={(value) => setField("factualSource", value)}
                  full
                />
                {kind === "potd" &&
                  selected &&
                  factualSourceText({ status: selected.status, factualSource: selected.data.factualSource }) ===
                    WAIVED_SOURCE_TEXT && <p className="admin-field full">{WAIVED_SOURCE_TEXT}</p>}
                {kind === "potd" ? (
                  <label className="admin-field full">
                    <span>Photo context</span>
                    <Textarea
                      rows={4}
                      value={data.description}
                      onChange={(_, item) =>
                        setField("description", item.value)
                      }
                    />
                  </label>
                ) : (
                  <>
                    <TextField
                      label="Correct answer"
                      value={data.correctAnswer}
                      onChange={(value) => setField("correctAnswer", value)}
                      full
                    />
                    <div className="admin-field full">
                      <span>Answer options</span>
                      <p className="field-hint">
                        Preview shows choices without identifying the correct
                        answer.
                      </p>
                      <div className="form-grid answer-grid">
                        {data.distractors.map((option, index) => (
                          <TextField
                            key={index}
                            label={`Distractor ${index + 1}`}
                            value={option}
                            onChange={(value) => {
                              const distractors = [...data.distractors];
                              distractors[index] = value;
                              onChange({ ...data, distractors });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    <label className="admin-field">
                      <span>Minimum rank</span>
                      <select
                        value={data.difficulty}
                        onChange={(event) =>
                          setField("difficulty", event.target.value)
                        }
                      >
                        {ranks.map((rank) => (
                          <option key={rank}>{rank}</option>
                        ))}
                      </select>
                    </label>
                    <div className="answer-preview">
                      <span>PLAYER PREVIEW · OPTIONS SHOWN IN MIXED ORDER</span>
                      {[
                        data.distractors[1],
                        data.correctAnswer,
                        data.distractors[0],
                        data.distractors[2],
                      ].map((option, index) => (
                        <div key={index}>
                          <b>{String.fromCharCode(65 + index)}</b>
                          {option || "Answer choice"}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {kind === "potd" && (
                  <label className="admin-field">
                    <span>
                      Feature date <small>Visitor local calendar date</small>
                    </span>
                    <input
                      type="date"
                      value={dateKey}
                      onChange={(event) => setDateKey(event.target.value)}
                    />
                  </label>
                )}
              </fieldset>
              {!readOnly && (
              <div className="admin-actions editor-actions">
                <Button disabled={busy} onClick={() => onSave("draft")}>
                  Save draft
                </Button>
                {kind === "identifier" ? (
                  <Button
                    appearance="primary"
                    disabled={busy || !selected.sourceId}
                    onClick={() => onSave("published")}
                  >
                    {busy ? "Saving…" : "Mark prototype-ready"}
                  </Button>
                ) : (
                  <>
                    <Button
                      appearance="primary"
                      disabled={busy || !selected.sourceId}
                      onClick={() => onSave("scheduled")}
                    >
                      {busy ? "Saving…" : "Schedule feature"}
                    </Button>
                    <Button
                      disabled={busy || !selected.sourceId}
                      onClick={() => onSave("published")}
                    >
                      Publish for today
                    </Button>
                  </>
                )}
                {selected.status !== "archived" && (
                  <Button
                    appearance="subtle"
                    disabled={busy}
                    onClick={() => onSave("archived")}
                  >
                    Archive
                  </Button>
                )}
              </div>
              )}
              {kind === "identifier" && (
                <p className="admin-demo-note">
                  Prototype-ready marks this website record for review. The game
                  backend is not connected.
                </p>
              )}
              {kind === "potd" && (
                <p className="admin-demo-note">
                  The photo appears on the public prototype for its scheduled
                  date and following days, based on each visitor’s local day.
                </p>
              )}
            </section>
          ) : (
            <section className="admin-panel detail-placeholder">
              <Newspaper size={28} />
              <b>Select a record</b>
              <p>
                {readOnly
                  ? "Choose a sample draft to view it."
                  : "Load a sample or create a record from an approved submission."}
              </p>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function TextField({
  label,
  value,
  onChange,
  full = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  full?: boolean;
}) {
  return (
    <label className={`admin-field ${full ? "full" : ""}`}>
      <span>{label}</span>
      <Input
        value={value}
        maxLength={2400}
        onChange={(_, data) => onChange(data.value)}
      />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status.replaceAll("_", "-")}`}>
      {displayStatus(status)}
    </span>
  );
}
