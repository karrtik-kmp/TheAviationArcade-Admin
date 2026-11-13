/**
 * The public website that belongs to this Admin, as an origin ending in `/`.
 *
 * `PUBLIC_SITE_URL` (server setting, e.g. `https://dev.playairplanegames.com`) wins when it is a valid http(s)
 * origin. Without it the host decides: `admin.<domain>` → `https://<domain>/`, `dev.admin.<domain>` →
 * `https://dev.<domain>/`. Any other host (localhost, a preview) has no known website, so the answer is null
 * and callers leave the link out. Links only: nothing here authorizes anything.
 */
export function publicWebsiteUrl(
  host: string | null | undefined,
  configured?: string | null,
): string | null {
  const fromSetting = parsePublicSiteUrl(configured);
  if (fromSetting) return fromSetting;
  const name = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  const match = /^(dev\.)?admin\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(name);
  return match ? `https://${match[1] ?? ""}${match[2]}/` : null;
}

/** An http(s) origin with no path, query, fragment or credentials, as `<origin>/`; otherwise null. */
export function parsePublicSiteUrl(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return `${url.origin}/`;
  } catch {
    return null;
  }
}

/** A page on the public website, e.g. `account` → `https://playairplanegames.com/account`. */
export function publicWebsitePage(site: string, page: "account" | "contribute"): string {
  return new URL(page, site).toString();
}
