import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The admin workspace styles live in components/admin.css only. When globals.css also styled the
// same selectors, admin.css (loaded later) silently cancelled globals' phone and tablet breakpoints.
test("globals.css holds no admin workspace rules", () => {
  const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const workspace =
    /(^|[\s,}])\.(admin-(?!gate|local-note|signin|sign-in)[\w-]*|review-panel|status-badge|skeleton|audit-list|answer-preview|photo-preview-label)\b/gm;
  const found = [...globals.matchAll(workspace)].map((match) => match[0].trim());
  assert.deepEqual(found, [], "move these rules to components/admin.css");
});
