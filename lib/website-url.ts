/**
 * The public website that belongs to an Admin host: `admin.<domain>` → `https://<domain>`,
 * `dev.admin.<domain>` → `https://dev.<domain>`. Any other host (localhost, a preview) has no
 * known website, so the answer is null and callers leave the link out.
 */
export function publicWebsiteUrl(host: string | null | undefined): string | null {
  const name = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  const match = /^(dev\.)?admin\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(name);
  return match ? `https://${match[1] ?? ""}${match[2]}/` : null;
}
