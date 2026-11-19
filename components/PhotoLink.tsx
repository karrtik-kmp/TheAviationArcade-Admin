"use client";

import { useEffect, useState } from "react";
import { accountHeaders } from "@/lib/account";
import { sitePath } from "@/lib/paths";
import type { MediaItem } from "@/lib/request/media";

/**
 * Linking a content question to a backend photo (the Military and Aircraft Identifier desks): the published photos to
 * choose from, and a preview of the linked one. Both read the Media routes with the signed-in account; a refusal for
 * the account stops the workspace through `onBlocked`.
 */

export type PhotoOption = { id: string; label: string };

/** The published photos a question can link, read through the Media routes, every page (at most 2,000). */
export function usePublishedPhotos(sessionKey: string, onBlocked: (status: number) => void) {
  const [state, setState] = useState<{ options: PhotoOption[]; loading: boolean; error: string; complete: boolean }>({
    options: [],
    loading: true,
    error: "",
    complete: false,
  });
  useEffect(() => {
    let active = true;
    (async () => {
      const options: PhotoOption[] = [];
      let cursor: string | null = null;
      let complete = false;
      for (let page = 0; page < 40; page++) {
        const query: string = `state=published${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        let response: Response;
        let body: Record<string, unknown>;
        try {
          response = await fetch(sitePath(`/api/media?${query}`), { cache: "no-store", headers: accountHeaders(sessionKey) });
          body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        } catch {
          if (active) setState({ options, loading: false, error: "The published photos could not load. Reload the desk.", complete: false });
          return;
        }
        if (!active) return;
        if (response.status === 401 || response.status === 403 || body.code === "ACCOUNT_CHANGED") {
          onBlocked(response.status || 409);
          return;
        }
        if (!response.ok || !Array.isArray(body.items)) {
          setState({
            options,
            loading: false,
            error: typeof body.error === "string" ? `The published photos could not load: ${body.error}` : "The published photos could not load.",
            complete: false,
          });
          return;
        }
        for (const item of body.items as MediaItem[]) {
          // The list carries the draft only. A draft that differs from the published version is not what a release
          // freezes, so its credit and description are not shown as the photo's.
          const pending = item.draftVersion !== item.publishedVersion;
          const credit = item.draft.licence.credit;
          const description = item.draft.description ?? "";
          options.push({
            id: item.id,
            label: pending
              ? `${item.id} · published version ${item.publishedVersion} · has unpublished changes`
              : `${item.id} · ${credit ?? "no credit"}${description ? ` · ${description.length > 60 ? `${description.slice(0, 59)}…` : description}` : ""}`,
          });
        }
        cursor = typeof body.nextCursor === "string" ? body.nextCursor : null;
        if (!cursor) {
          complete = true;
          break;
        }
      }
      if (active) setState({ options, loading: false, error: "", complete });
    })();
    return () => {
      active = false;
    };
  }, [sessionKey, onBlocked]);
  return state;
}

/** The linked photo's current draft, from the Media routes, to check what the question shows. The link is short-lived. */
export function LinkedPhoto({
  mediaId,
  sessionKey,
  onBlocked,
  use,
}: {
  mediaId: string;
  sessionKey: string;
  onBlocked: (status: number) => void;
  /** What the published version is for on this desk: a Military release (with its crop check) or what players see. */
  use: "release" | "players";
}) {
  const [preview, setPreview] = useState<{ id: string; url: string; text: string; warning: string } | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(sitePath(`/api/media/${encodeURIComponent(mediaId)}`), {
          cache: "no-store",
          headers: accountHeaders(sessionKey),
        });
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!active) return;
        if (response.status === 401 || response.status === 403 || body.code === "ACCOUNT_CHANGED") {
          onBlocked(response.status || 409);
          return;
        }
        const shown = body.preview as { url?: unknown; version?: unknown } | undefined;
        const item = body.item as { state?: unknown; publishedVersion?: unknown } | undefined;
        const published =
          item?.state === "published" && typeof item.publishedVersion === "number" ? item.publishedVersion : null;
        // The preview is the photo's DRAFT (any state). A release freezes the PUBLISHED version, so a differing draft
        // is not shown as the photo to check.
        const warning =
          published === null
            ? use === "release"
              ? "This photo is not published. A release needs a published photo."
              : "This photo is not published, so players see no photo for this question."
            : shown?.version !== published
              ? use === "release"
                ? `This preview is unpublished draft version ${String(shown?.version)}; a release uses published version ${published}, which this desk cannot show. Check that version in the Media desk before ticking the crop check.`
                : `This preview is unpublished draft version ${String(shown?.version)}; players see published version ${published}, which this desk cannot show. Check that version in the Media desk.`
              : "";
        setPreview(
          response.ok && shown && typeof shown.url === "string"
            ? { id: mediaId, url: shown.url, text: "", warning }
            : { id: mediaId, url: "", text: typeof body.error === "string" ? body.error : "The photo preview is not available.", warning: "" },
        );
      } catch {
        if (active) setPreview({ id: mediaId, url: "", text: "The photo preview could not load.", warning: "" });
      }
    })();
    return () => {
      active = false;
    };
  }, [mediaId, sessionKey, onBlocked, use]);
  const current = preview?.id === mediaId ? preview : null;
  return (
    <div className="admin-field full military-photo">
      <span>Photo {mediaId}</span>
      {current?.warning && <small className="error">{current.warning}</small>}
      {!current ? (
        <small>Loading the preview…</small>
      ) : current.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link from the backend, not a site asset
        <img src={current.url} alt={`Photo ${mediaId}`} referrerPolicy="no-referrer" />
      ) : (
        <small>{current.text}</small>
      )}
    </div>
  );
}
