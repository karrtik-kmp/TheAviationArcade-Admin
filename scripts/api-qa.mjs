import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { signInDemoEditor } from "./seed-auth-emulator.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const origin = process.env.QA_ORIGIN || "http://127.0.0.1:5173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: "light",
});
try {
  const loginPage = await context.newPage();
  await signInDemoEditor(loginPage, origin);
  // The website's own proposal routes are gone (A3 fix wave): a plain 404 for every method.
  const gone = async (res, label) => {
    assert.equal(res.status(), 404, label);
    assert.notEqual((await res.json().catch(() => ({}))).code, "SUBMISSIONS_CLOSED", label);
  };
  await gone(await context.request.get(origin + "/api/submissions"), "member list gone");
  await gone(
    await context.request.post(origin + "/api/submissions", {
      headers: { Origin: origin, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        data: JSON.stringify({}),
        photo: {
          name: "qa.jpg",
          mimeType: "image/jpeg",
          buffer: await readFile("public/media/aircraft.jpg"),
        },
      },
    }),
    "member create gone",
  );
  await gone(
    await context.request.put(origin + "/api/submissions/example", {
      headers: { Origin: origin },
      multipart: { data: JSON.stringify({}) },
    }),
    "member revise gone",
  );
  const badZone = await context.request.get(
    origin + "/api/featured?timeZone=bad-zone",
  );
  assert.equal(badZone.status(), 422);
  assert.match((await badZone.json()).error, /timezone/i);
  const page = await context.newPage();
  await page.goto(origin + "/admin", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Good to have you back." }).waitFor();
  await page.screenshot({
    path: "docs/evidence/admin-overview-light.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(origin + "/contribute", { waitUntil: "domcontentloaded" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .getByRole("heading", { name: "Photo submissions aren't open yet" })
    .waitFor();
  await page.screenshot({
    path: "docs/evidence/contributor-mobile-light.png",
    fullPage: true,
  });
  await writeFile(
    "docs/evidence/api-qa.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        memberSubmissionRoutes: "404",
        contributeClosedPanel: true,
        badTimezone: 422,
        adminLightOverflow: false,
        contributor360Overflow: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS removed member submission routes, closed /contribute panel, invalid timezone, light admin and 360px contributor layout",
  );
} finally {
  await browser.close();
}
