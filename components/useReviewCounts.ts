"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { accountHeaders } from "@/lib/account";
import { sitePath } from "@/lib/paths";
import {
  countOf,
  firstIds,
  reviewBlock,
  reviewCountUrls,
  type PageCount,
  type ReviewCountKey,
  type ReviewReply,
} from "@/lib/review-counts";

export type ReviewCounts = {
  /** null while loading or when that list could not be read. */
  counts: Record<ReviewCountKey, PageCount | null>;
  /** The first photos waiting for review, newest first. */
  queue: string[];
  loading: boolean;
  /** The lists that could not be read (shown as "could not load", never as zero). */
  failed: ReviewCountKey[];
  refresh: () => void;
};

type Shown = { key: string; counts: Record<ReviewCountKey, PageCount | null>; queue: string[]; failed: ReviewCountKey[] };
const empty: Record<ReviewCountKey, PageCount | null> = { toReview: null, changes: null, photographers: null };

/**
 * Reads the first page of each review list for the Overview, the nav badge and the photographers panel. Only for an
 * admin on backend roles whose account is confirmed (`enabled`); otherwise nothing is requested. A 401, 403 or
 * ACCOUNT_CHANGED from any list is the account fence: it goes to `onBlocked` and no count is applied. Only the newest
 * load may change the screen (session generation), and what is shown is tied to the account it was read for, so
 * another account never sees it, not even for one render. `watch` reloads the counts whenever it changes to a
 * non-empty value (the workspace passes the section, so opening the Overview or Submissions reads them again).
 */
export function useReviewCounts(
  sessionKey: string,
  enabled: boolean,
  onBlocked: (status: number) => void,
  watch = "",
): ReviewCounts {
  const [shown, setShown] = useState<Shown>({ key: "", counts: empty, queue: [], failed: [] });
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    if (!enabled) {
      setShown({ key: "", counts: empty, queue: [], failed: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    const keys = Object.keys(reviewCountUrls) as ReviewCountKey[];
    const replies: ReviewReply[] = await Promise.all(
      keys.map(async (key) => {
        try {
          const response = await fetch(sitePath(reviewCountUrls[key]), { cache: "no-store", headers: accountHeaders(sessionKey) });
          return { key, status: response.status, body: (await response.json().catch(() => null)) as unknown };
        } catch {
          return { key, status: 0, body: null as unknown };
        }
      }),
    );
    if (mine !== generation.current) return;
    const blocked = reviewBlock(replies);
    if (blocked !== null) return onBlocked(blocked);
    const counts = { ...empty };
    const failed: ReviewCountKey[] = [];
    for (const { key, status, body } of replies) {
      const count = status === 200 ? countOf(body, key === "photographers" ? "requests" : "items") : null;
      counts[key] = count;
      if (!count) failed.push(key);
    }
    setShown({ key: sessionKey, counts, queue: firstIds(replies.find((reply) => reply.key === "toReview")?.body), failed });
    setLoading(false);
  }, [enabled, sessionKey, onBlocked]);

  useEffect(() => {
    if (enabled && watch === "") return;
    // Started on the next task, not inside the effect body: the load sets state once its answers arrive.
    const start = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(start);
      generation.current += 1;
    };
  }, [load, enabled, watch]);

  const refresh = useCallback(() => void load(), [load]);
  // Decided at render time: counts read for another account are never shown.
  const mine = enabled && shown.key === sessionKey;
  return {
    counts: mine ? shown.counts : empty,
    queue: mine ? shown.queue : [],
    failed: mine ? shown.failed : [],
    loading: enabled && (loading || !mine),
    refresh,
  };
}
