/**
 * The FAQ desk's source on the Admin's own routes (`/api/admin/faq…`, lib/request/faq-routes.ts, API 0.33.0). Every
 * request goes through the workspace's draft session, so an answer that arrives for an earlier account check is
 * `stale` and a signed-out or changed account is `blocked`, as on the other desks. Each write sends the draft version
 * the desk read and is never retried; the routes answer with a fresh read. No zod: the browser imports this.
 */
import type { Outcome } from "./editorial/draft-session.ts";
import type { FaqDoc, FaqOp, FaqResult, FaqSource, FaqState } from "./faq-desk.ts";

type Request = (method: string, url: string, payload: unknown) => Promise<Outcome>;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isDoc = (value: unknown): value is FaqDoc => isRecord(value) && Array.isArray(value.categories);
const isCount = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** The routes' answer as the desk's state; null when it isn't one (the route already checked the backend's answer). */
export function faqStateOf(body: unknown): FaqState | null {
  if (!isRecord(body) || !isDoc(body.draft) || !isCount(body.draftVersion)) return null;
  const live = body.live === null ? null : isDoc(body.live) ? body.live : undefined;
  if (live === undefined) return null;
  return {
    draft: { categories: body.draft.categories },
    draftVersion: body.draftVersion as number,
    live: live && { categories: live.categories },
    liveVersion: isCount(body.liveVersion) ? (body.liveVersion as number) : null,
    livePublishedAt: typeof body.livePublishedAt === "string" ? body.livePublishedAt : null,
  };
}

/** A file exported on dev (openapi `FaqExport`), read for the change list; the backend checks it again on import. */
export function readFaqExport(text: string): { file: Record<string, unknown>; doc: FaqDoc } | null {
  try {
    const file: unknown = JSON.parse(text);
    if (!isRecord(file) || file.kind !== "faq-export" || file.format !== "faq.v1" || !Array.isArray(file.categories)) return null;
    return { file, doc: { categories: file.categories as FaqDoc["categories"] } };
  } catch {
    return null;
  }
}

function result<T>(outcome: Outcome, read: (body: Record<string, unknown>) => T | null): FaqResult<T> {
  switch (outcome.kind) {
    case "ok": {
      const value = read(outcome.body);
      return value === null ? { kind: "refused", message: "The answer couldn't be read. Reload the FAQ.", errors: [] } : { kind: "ok", value };
    }
    case "conflict":
      return { kind: "conflict", message: outcome.message };
    case "blocked":
      return { kind: "blocked", status: outcome.status };
    case "refused":
      return { kind: "refused", message: outcome.message, errors: outcome.errors };
    case "stale":
      return { kind: "stale" };
    case "inactive":
      return { kind: "inactive", message: outcome.message };
  }
}

/** The desk's source over a draft-session `request`. Every method resolves; the session turns a network failure into `refused`. */
export function createFaqSource(request: Request): FaqSource {
  const load = async () => result(await request("GET", "/api/admin/faq", undefined), faqStateOf);
  /** A write's answer. `{ saved: true }` means it was done but the read after it failed: read again, never resend. */
  const state = async (outcome: Outcome): Promise<FaqResult<FaqState>> => {
    if (outcome.kind === "ok" && outcome.body.saved === true) {
      const again = await load();
      return again.kind === "refused"
        ? { kind: "refused", message: "Saved. The FAQ couldn't be reloaded; press Reload before the next change.", errors: [] }
        : again;
    }
    return result(outcome, faqStateOf);
  };
  return {
    load,
    change: async (op: FaqOp, base: number) => state(await request("PATCH", "/api/admin/faq", { draftVersion: base, operations: [op] })),
    discard: async (base: number) => state(await request("POST", "/api/admin/faq/discard", { draftVersion: base })),
    publish: async (base: number) => state(await request("POST", "/api/admin/faq/publish", { draftVersion: base })),
    exportForLive: async () =>
      result(await request("GET", "/api/admin/faq/export", undefined), (body) =>
        typeof body.sourceVersion === "number"
          ? { fileName: `faq-v${body.sourceVersion}.json`, text: `${JSON.stringify(body, null, 2)}\n` }
          : null,
      ),
    readImport: (text: string) => readFaqExport(text)?.doc ?? null,
    importFromDev: async (text: string, base: number) => {
      const read = readFaqExport(text);
      if (!read) return { kind: "refused", message: "That file isn't an FAQ downloaded from the dev Admin.", errors: [] };
      return state(await request("POST", "/api/admin/faq/import", { draftVersion: base, file: read.file }));
    },
  };
}
