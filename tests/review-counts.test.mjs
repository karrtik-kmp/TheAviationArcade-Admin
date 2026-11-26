// The Overview's review counts (A3 fix wave, B1b): one page per list, "50+" when there is another page.
import assert from "node:assert/strict";
import { test } from "node:test";
import { countOf, countText, firstIds, reviewBlock, reviewCountUrls } from "../lib/review-counts.ts";

const page = (n, next = null) => ({ items: Array.from({ length: n }, (_, i) => ({ id: `med-${i + 1}` })), nextCursor: next });

test("a page gives its own count, and 50+ when the backend has another page", () => {
  assert.deepEqual(countOf(page(3), "items"), { n: 3, more: false });
  assert.equal(countText(countOf(page(3), "items")), "3");
  assert.equal(countText(countOf(page(50, "c2"), "items")), "50+");
  assert.equal(countText(countOf(page(0), "items")), "0");
  assert.equal(countText(countOf({ requests: [{}, {}], nextCursor: null }, "requests")), "2");
});

test("an error body or a malformed page is not a count (never shown as zero)", () => {
  for (const body of [null, {}, { error: "x", code: "MEDIA_UNAVAILABLE" }, { items: "x", nextCursor: null }, { items: [], nextCursor: 4 }])
    assert.equal(countOf(body, "items"), null, JSON.stringify(body));
  assert.equal(countOf(page(2), "requests"), null, "the wrong list key");
});

test("the queue shows the first five ids as listed", () => {
  assert.deepEqual(firstIds(page(7)), ["med-1", "med-2", "med-3", "med-4", "med-5"]);
  assert.deepEqual(firstIds({ items: [{ id: "med-9" }, { nope: 1 }, null], nextCursor: null }), ["med-9"]);
  assert.deepEqual(firstIds(null), []);
});

test("the counts read the Admin's own routes, with only filters those routes accept", () => {
  assert.deepEqual(reviewCountUrls, {
    toReview: "/api/media?state=unverified&review=none",
    changes: "/api/media?pending=true&review=none",
  });
});

test("any one list's 401, 403 or ACCOUNT_CHANGED blocks, so no count is applied", () => {
  const ok = (key) => ({ key, status: 200, body: page(2) });
  assert.equal(reviewBlock([ok("toReview"), ok("changes")]), null);
  assert.equal(reviewBlock([ok("toReview"), { key: "changes", status: 403, body: { code: "FORBIDDEN" } }]), 403);
  assert.equal(reviewBlock([{ key: "toReview", status: 401, body: null }, ok("changes")]), 401);
  assert.equal(reviewBlock([ok("toReview"), { key: "changes", status: 409, body: { code: "ACCOUNT_CHANGED" } }]), 409);
  // An outage or a mock deployment is not the account changing: those lists show as "could not load" instead.
  assert.equal(reviewBlock([{ key: "toReview", status: 503, body: { code: "BACKEND_UNAVAILABLE" } }, { key: "changes", status: 404, body: { code: "MEDIA_UNAVAILABLE" } }]), null);
});
