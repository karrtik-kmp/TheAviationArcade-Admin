import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parsePublicSiteUrl, publicWebsitePage, publicWebsiteUrl } from "../lib/website-url.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("the public website link: PUBLIC_SITE_URL first, then the admin host, else none", () => {
  assert.equal(publicWebsiteUrl("dev.admin.playairplanegames.com", "https://dev.playairplanegames.com"), "https://dev.playairplanegames.com/");
  assert.equal(publicWebsiteUrl("127.0.0.1:5173", "http://127.0.0.1:5174/"), "http://127.0.0.1:5174/");
  assert.equal(publicWebsiteUrl("admin.playairplanegames.com"), "https://playairplanegames.com/");
  assert.equal(publicWebsiteUrl("dev.admin.playairplanegames.com", ""), "https://dev.playairplanegames.com/");
  assert.equal(publicWebsiteUrl("dev.admin.playairplanegames.com", "not a url"), "https://dev.playairplanegames.com/");
  assert.equal(publicWebsiteUrl("127.0.0.1:5173"), null);
  for (const bad of ["ftp://x.test", "https://u:p@x.test", "https://x.test/path", "https://x.test/?q=1", "https://x.test/#h", "javascript:alert(1)"])
    assert.equal(parsePublicSiteUrl(bad), null, bad);
  assert.equal(publicWebsitePage("https://dev.playairplanegames.com/", "account"), "https://dev.playairplanegames.com/account");
  assert.equal(publicWebsitePage("https://playairplanegames.com/", "contribute"), "https://playairplanegames.com/contribute");
});

test("the account menu links Account and Contribute to the public website, not admin-host paths", () => {
  const menu = read("components/AccountControl.tsx");
  assert.match(menu, /publicWebsitePage\(publicSite, "account"\)/);
  assert.match(menu, /publicWebsitePage\(publicSite, "contribute"\)/);
  assert.doesNotMatch(menu, /href="\/(account|contribute)"/);
});
