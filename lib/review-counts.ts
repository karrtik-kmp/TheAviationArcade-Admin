/**
 * The Overview's review counts (A3 fix wave, B1b): photos to review and changes waiting. (Photographer requests left with
 * API 0.32.0: a verified account turns photo submission on itself.)
 * The backend's lists are paged with no total (openapi `MediaList`, `AdminRoleList`), so a count reads ONE page and
 * says "50+" when the page has a next one, rather than paging through everything on every visit. No zod: the
 * browser imports this.
 */

/** A count from one page: how many it held, and whether there were more. */
export type PageCount = { n: number; more: boolean };

/** The count one page of a list gives. Anything that isn't a page (an error body) is not a count. */
export function countOf(body: unknown, key: "items" | "requests"): PageCount | null {
  if (!body || typeof body !== "object") return null;
  const list = (body as Record<string, unknown>)[key];
  const next = (body as Record<string, unknown>).nextCursor;
  if (!Array.isArray(list) || (next !== null && typeof next !== "string")) return null;
  return { n: list.length, more: typeof next === "string" };
}

/** "7", or "50+" when the list had another page. */
export function countText(count: PageCount): string {
  return count.more ? `${count.n}+` : String(count.n);
}

/** The ids at the head of a page of photos, for the Overview's queue (newest first, as the backend lists them). */
export function firstIds(body: unknown, limit = 5): string[] {
  if (!body || typeof body !== "object") return [];
  const list = (body as Record<string, unknown>).items;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).id : null))
    .filter((id): id is string => typeof id === "string")
    .slice(0, limit);
}

/** One list's answer: its HTTP status (0 for a network failure) and parsed body. */
export type ReviewReply = { key: ReviewCountKey; status: number; body: unknown };

/**
 * The account fence over all three answers: a 401 or 403, or ACCOUNT_CHANGED, from ANY list blocks the workspace and
 * no count is applied. Returns the status to block with (ACCOUNT_CHANGED as 409), or null.
 */
export function reviewBlock(replies: readonly ReviewReply[]): 401 | 403 | 409 | null {
  for (const { status, body } of replies) {
    if (status === 401 || status === 403) return status;
    const code = body && typeof body === "object" ? (body as Record<string, unknown>).code : undefined;
    if (code === "ACCOUNT_CHANGED") return 409;
  }
  return null;
}

/** The three lists, as the Admin's own routes serve them. */
export const reviewCountUrls = {
  toReview: "/api/media?state=unverified&review=none",
  changes: "/api/media?pending=true&review=none",
} as const;
export type ReviewCountKey = keyof typeof reviewCountUrls;
