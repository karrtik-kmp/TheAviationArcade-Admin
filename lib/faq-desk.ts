/**
 * The FAQ desk's rules, with no React (plan: website docs/briefs/faq-cms-plan.md, "Admin"). The FAQ is a website
 * document the Backend stores as a draft and publishes (API 0.33.0, not yet vendored). Every change is one small
 * operation, so the desk never sends the whole FAQ.
 *
 * PROVISIONAL until Backend 0.33.0 is vendored: the document shape, the operation names and the limits below follow
 * the plan's Backend section, not a contract. When the contract lands, check each against `contracts/openapi.yaml`
 * and change them here; the desk only uses what this module exports. No zod: the browser imports this.
 */

export type FaqEntry = { id: string; question: string; answer: string };
export type FaqCategory = { id: string; title: string; entries: FaqEntry[] };
export type FaqDoc = { categories: FaqCategory[] };

/** The plan's caps (Backend item 3), in code points. */
export const faqLimits = { title: 80, question: 200, answer: 2000, categories: 30, entries: 300 } as const;
export const faqIdPattern = /^[a-z0-9-]{1,64}$/;

/** One change, sent alone with the draft's base version. */
export type FaqOp =
  | { op: "upsertCategory"; id: string; title: string }
  | { op: "removeCategory"; id: string }
  | { op: "moveCategory"; id: string; to: number }
  | { op: "upsertEntry"; categoryId: string; id: string; question: string; answer: string }
  | { op: "removeEntry"; categoryId: string; id: string }
  | { op: "moveEntry"; categoryId: string; id: string; to: number };

export const emptyFaq = (): FaqDoc => ({ categories: [] });
const codePoints = (text: string) => [...text].length;

/** As the Backend stores text: CRLF becomes LF, then trimmed. */
export function normaliseFaqText(raw: string) {
  return raw.replace(/\r\n?/g, "\n").trim();
}

/** The field's problem, or undefined. Newlines only in answers; no other control character; no lone surrogate. */
export function faqTextError(raw: string, field: "title" | "question" | "answer"): string | undefined {
  const label = field === "title" ? "The category title" : field === "question" ? "The question" : "The answer";
  const text = raw.replace(/\r\n?/g, "\n");
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a && field !== "answer") return `${label} must be one line.`;
    const control = code < 0x20 ? code !== 0x0a : (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    if (control) return `${label} can't contain control characters.`;
    if (code >= 0xd800 && code <= 0xdfff) return `${label} contains a broken character. Retype it.`;
  }
  const length = codePoints(normaliseFaqText(text));
  if (length < 1) return `${label} is required.`;
  if (length > faqLimits[field]) return `${label} is ${length} characters; the limit is ${faqLimits[field]}.`;
  return undefined;
}

/** A new id from the text: lowercase letters, digits and hyphens, unique among `taken`. */
export function newFaqId(text: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const base =
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56)
      .replace(/-+$/g, "") || "item";
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export const allEntryIds = (doc: FaqDoc) => doc.categories.flatMap((category) => category.entries.map((entry) => entry.id));
export const entryCount = (doc: FaqDoc) => doc.categories.reduce((n, category) => n + category.entries.length, 0);

function move<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** The document after one operation, as the Backend applies it. Unknown ids leave it unchanged. */
export function applyFaqOp(doc: FaqDoc, op: FaqOp): FaqDoc {
  const categories = doc.categories;
  const at = (id: string) => categories.findIndex((category) => category.id === id);
  switch (op.op) {
    case "upsertCategory": {
      const i = at(op.id);
      const title = normaliseFaqText(op.title);
      if (i < 0) return { categories: [...categories, { id: op.id, title, entries: [] }] };
      return { categories: categories.map((category, n) => (n === i ? { ...category, title } : category)) };
    }
    case "removeCategory":
      return { categories: categories.filter((category) => category.id !== op.id) };
    case "moveCategory": {
      const i = at(op.id);
      return i < 0 ? doc : { categories: move(categories, i, op.to) };
    }
    default: {
      const i = at(op.categoryId);
      if (i < 0) return doc;
      const entries = categories[i].entries;
      const j = entries.findIndex((entry) => entry.id === op.id);
      let next = entries;
      if (op.op === "upsertEntry") {
        const entry = { id: op.id, question: normaliseFaqText(op.question), answer: normaliseFaqText(op.answer) };
        next = j < 0 ? [...entries, entry] : entries.map((old, n) => (n === j ? entry : old));
      } else if (op.op === "removeEntry") next = entries.filter((entry) => entry.id !== op.id);
      else if (j >= 0) next = move(entries, j, op.to);
      return { categories: categories.map((category, n) => (n === i ? { ...category, entries: next } : category)) };
    }
  }
}

/** Whether one more category or entry still fits the caps. */
export const canAddCategory = (doc: FaqDoc) => doc.categories.length < faqLimits.categories;
export const canAddEntry = (doc: FaqDoc) => entryCount(doc) < faqLimits.entries;

/** "Moved to position 3 of 8", for the polite live region after a reorder. */
export const movedText = (position: number, total: number) => `Moved to position ${position} of ${total}.`;

/**
 * What publishing `draft` would change against `live`, one line each, for the Publish and "Load FAQ from dev"
 * dialogs. Compared by id, so a rename or an edited answer is one line, not a removal and an addition.
 */
export function faqChanges(live: FaqDoc | null, draft: FaqDoc): string[] {
  const before = live ?? emptyFaq();
  const lines: string[] = [];
  const oldCats = new Map(before.categories.map((category, i) => [category.id, { category, i }]));
  const newIds = new Set(draft.categories.map((category) => category.id));
  // A move is a change of order among the items both sides have, so removing or adding one doesn't "move" the rest.
  const keptOld = before.categories.filter((category) => newIds.has(category.id)).map((category) => category.id);
  const keptNew = draft.categories.filter((category) => oldCats.has(category.id)).map((category) => category.id);
  draft.categories.forEach((category, i) => {
    const old = oldCats.get(category.id);
    if (!old) {
      lines.push(`New category "${category.title}" with ${category.entries.length} question${category.entries.length === 1 ? "" : "s"}.`);
      return;
    }
    if (old.category.title !== category.title) lines.push(`Category "${old.category.title}" renamed to "${category.title}".`);
    if (keptOld.indexOf(category.id) !== keptNew.indexOf(category.id)) lines.push(`Category "${category.title}" moved to position ${i + 1}.`);
    const oldEntries = new Map(old.category.entries.map((entry) => [entry.id, entry]));
    const keep = new Set(category.entries.map((entry) => entry.id));
    const keptOldEntries = old.category.entries.filter((entry) => keep.has(entry.id)).map((entry) => entry.id);
    const keptNewEntries = category.entries.filter((entry) => oldEntries.has(entry.id)).map((entry) => entry.id);
    const reordered = keptOldEntries.some((id, n) => keptNewEntries[n] !== id);
    category.entries.forEach((entry) => {
      const was = oldEntries.get(entry.id);
      if (!was) lines.push(`New question in "${category.title}": "${entry.question}".`);
      else {
        if (was.question !== entry.question) lines.push(`Question reworded: "${entry.question}".`);
        if (was.answer !== entry.answer) lines.push(`Answer changed: "${entry.question}".`);
      }
    });
    for (const entry of oldEntries.values())
      if (!keep.has(entry.id)) lines.push(`Question removed from "${category.title}": "${entry.question}".`);
    if (reordered) lines.push(`Questions reordered in "${category.title}".`);
  });
  for (const { category } of oldCats.values()) if (!newIds.has(category.id)) lines.push(`Category "${category.title}" removed.`);
  return lines;
}

/** The draft and what is live, as one load or write answers. */
export type FaqState = {
  draft: FaqDoc;
  /** The draft's version: every write sends it and a stale one is 409. */
  draftVersion: number;
  live: FaqDoc | null;
  liveVersion: number | null;
  livePublishedAt: string | null;
};
/** One request's outcome, in the shape of `lib/editorial/draft-session.ts`. */
export type FaqResult<T> =
  | { kind: "ok"; value: T }
  /** Someone changed the draft first: the desk keeps the typed text and reloads. Nothing is resent. */
  | { kind: "conflict"; message: string }
  /** Signed out, not allowed, or the account changed: the workspace's fence. */
  | { kind: "blocked"; status: number }
  | { kind: "refused"; message: string; errors: string[] }
  /** Answered for an earlier account check: dropped. */
  | { kind: "stale" }
  /** Nothing was sent: the account is no longer active (draft-session `inactive`). */
  | { kind: "inactive"; message: string };

/**
 * Where the desk reads and writes. The Backend adapter is written against the vendored 0.33.0 contract and uses the
 * workspace's draft session (`drafts.open("faq", version)`, `drafts.isCurrent(generation)`); until then the desk has
 * no source and says so. Every method resolves, never rejects: a network failure is `refused`.
 */
export type FaqSource = {
  load(): Promise<FaqResult<FaqState>>;
  change(op: FaqOp, base: number): Promise<FaqResult<FaqState>>;
  discard(base: number): Promise<FaqResult<FaqState>>;
  publish(base: number): Promise<FaqResult<FaqState>>;
  /** The published FAQ as the file the live Admin loads (dev Admin). */
  exportForLive(): Promise<FaqResult<{ fileName: string; text: string }>>;
  /** The FAQ inside a file from dev, for the change list only; null when it isn't one. The Backend checks it again. */
  readImport(text: string): FaqDoc | null;
  /** Loads the file into the draft, never straight to live (live Admin). */
  importFromDev(text: string, base: number): Promise<FaqResult<FaqState>>;
};

/** Which Admin this is, from its host: the dev Admin downloads the FAQ for live, the live Admin loads it. */
export type FaqHost = "dev" | "live" | "local";
export function faqHostKind(hostname: string): FaqHost {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")) return "local";
  return host.startsWith("dev.") ? "dev" : "live";
}
