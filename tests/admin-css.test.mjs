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

// A3 fix wave: the stats row sizes to its stats (staff three, the demo one) and draws its dividers with a gap, so a
// row never has an empty cell or a stray border where the cells wrap.
test("the stats row sizes to its stats and has no fixed-count border rules", () => {
  const css = readFileSync(new URL("../components/admin.css", import.meta.url), "utf8");
  assert.match(css, /\.admin-stats \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(180px, 1fr\)\)/);
  assert.match(css, /\.admin-stat:last-child:nth-child\(odd\) \{\s*grid-column: 1 \/ -1;/);
  assert.doesNotMatch(css, /\.admin-stat \+ \.admin-stat/);
  assert.doesNotMatch(css, /\.admin-stat:nth-child\((3|4|n \+ 3)\)/);
});
