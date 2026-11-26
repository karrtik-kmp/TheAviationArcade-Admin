// The FAQ desk's rules (website docs/briefs/faq-cms-plan.md, "Admin"). Provisional until Backend 0.33.0.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyFaqOp,
  emptyFaq,
  faqChanges,
  faqHostKind,
  faqLimits,
  faqTextError,
  movedText,
  newFaqId,
  normaliseFaqText,
} from "../lib/faq-desk.ts";

const doc = {
  categories: [
    {
      id: "account",
      title: "Account",
      entries: [
        { id: "sign-in", question: "How do I sign in?", answer: "Use email or Google." },
        { id: "delete", question: "How do I delete my account?", answer: "Write to us." },
      ],
    },
    { id: "pass", title: "First Class Pass", entries: [] },
  ],
};

test("text is stored as the Backend does: CRLF to LF, trimmed, counted in code points", () => {
  assert.equal(normaliseFaqText("  a\r\n\r\nb \r"), "a\n\nb");
  assert.equal(faqTextError("Line one\r\n\r\nLine two", "answer"), undefined);
  assert.match(faqTextError("two\nlines", "question"), /one line/);
  assert.match(faqTextError("   ", "title"), /required/);
  assert.match(faqTextError("a\tb", "answer"), /control/);
  assert.match(faqTextError("a b", "answer"), /control/);
  assert.match(faqTextError("a\uD800b", "answer"), /broken/);
  assert.equal(faqTextError("\u{1F600}".repeat(faqLimits.question), "question"), undefined, "emoji count once");
  assert.match(faqTextError("x".repeat(faqLimits.title + 1), "title"), /limit is 80/);
  assert.equal(faqTextError(`${"x".repeat(faqLimits.answer)}  `, "answer"), undefined, "trimmed before counting");
});

test("new ids are slugs, unique among the ones taken", () => {
  assert.equal(newFaqId("How do I sign in?", []), "how-do-i-sign-in");
  assert.equal(newFaqId("Café crème", []), "cafe-creme");
  assert.equal(newFaqId("Sign in", ["sign-in", "sign-in-2"]), "sign-in-3");
  assert.equal(newFaqId("???", []), "item");
  assert.ok(newFaqId("x".repeat(200), []).length <= 64);
});

test("operations change one thing each", () => {
  const renamed = applyFaqOp(doc, { op: "upsertCategory", id: "pass", title: " Pass " });
  assert.equal(renamed.categories[1].title, "Pass");
  assert.equal(applyFaqOp(doc, { op: "upsertCategory", id: "new", title: "New" }).categories.length, 3);
  assert.deepEqual(applyFaqOp(doc, { op: "moveCategory", id: "pass", to: 0 }).categories.map((c) => c.id), ["pass", "account"]);
  assert.deepEqual(applyFaqOp(doc, { op: "removeCategory", id: "account" }).categories.map((c) => c.id), ["pass"]);
  const moved = applyFaqOp(doc, { op: "moveEntry", categoryId: "account", id: "delete", to: 0 });
  assert.deepEqual(moved.categories[0].entries.map((e) => e.id), ["delete", "sign-in"]);
  const edited = applyFaqOp(doc, { op: "upsertEntry", categoryId: "account", id: "sign-in", question: "Q", answer: "A\r\nB" });
  assert.deepEqual(edited.categories[0].entries[0], { id: "sign-in", question: "Q", answer: "A\nB" });
  assert.equal(applyFaqOp(doc, { op: "removeEntry", categoryId: "account", id: "delete" }).categories[0].entries.length, 1);
  assert.equal(applyFaqOp(doc, { op: "moveEntry", categoryId: "nope", id: "x", to: 0 }), doc, "unknown ids change nothing");
  assert.equal(doc.categories[0].entries[0].id, "sign-in", "the input is never mutated");
});

test("the change list compares by id", () => {
  assert.deepEqual(faqChanges(doc, doc), []);
  assert.deepEqual(faqChanges(null, emptyFaq()), []);
  assert.deepEqual(faqChanges(null, doc), ['New category "Account" with 2 questions.', 'New category "First Class Pass" with 0 questions.']);
  let next = applyFaqOp(doc, { op: "upsertCategory", id: "pass", title: "Pass" });
  next = applyFaqOp(next, { op: "moveEntry", categoryId: "account", id: "delete", to: 0 });
  next = applyFaqOp(next, { op: "upsertEntry", categoryId: "account", id: "sign-in", question: "How do I sign in?", answer: "New." });
  next = applyFaqOp(next, { op: "upsertEntry", categoryId: "pass", id: "price", question: "What does it cost?", answer: "See the app." });
  assert.deepEqual(faqChanges(doc, next), [
    'Answer changed: "How do I sign in?".',
    'Questions reordered in "Account".',
    'Category "First Class Pass" renamed to "Pass".',
    'New question in "Pass": "What does it cost?".',
  ]);
  assert.deepEqual(faqChanges(doc, applyFaqOp(doc, { op: "removeCategory", id: "account" })), ['Category "Account" removed.'],
    "removing one doesn't move the rest");
  assert.deepEqual(faqChanges(doc, applyFaqOp(doc, { op: "removeEntry", categoryId: "account", id: "sign-in" })), [
    'Question removed from "Account": "How do I sign in?".',
  ]);
  assert.deepEqual(faqChanges(doc, applyFaqOp(doc, { op: "moveCategory", id: "pass", to: 0 })), [
    'Category "First Class Pass" moved to position 1.',
    'Category "Account" moved to position 2.',
  ]);
});

test("the host decides which copy step the desk offers", () => {
  assert.equal(faqHostKind("dev.admin.playairplanegames.com"), "dev");
  assert.equal(faqHostKind("admin.playairplanegames.com"), "live");
  assert.equal(faqHostKind("127.0.0.1"), "local");
  assert.equal(faqHostKind("localhost"), "local");
  assert.equal(movedText(3, 8), "Moved to position 3 of 8.");
});
