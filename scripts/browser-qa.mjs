import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
const page = await context.newPage();
const pageErrors = [],
  results = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
await mkdir("docs/evidence", { recursive: true });
async function check(name, run) {
  await run();
  results.push({ name, passed: true });
  console.log("PASS " + name);
}
async function api(path, method = "GET", data) {
  const response = await context.request.fetch(origin + path, {
    method,
    headers: method === "GET" ? {} : { Origin: origin },
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), body: await response.json() };
}
try {
  await check("Homepage desktop and theme switch", async () => {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page
      .getByRole("heading", { name: "Think you know airplanes?" })
      .waitFor();
    await page.getByRole("link", { name: "Sign in", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "docs/evidence/home-desktop-light.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await page.screenshot({
      path: "docs/evidence/home-desktop-dark.png",
      fullPage: true,
    });
  });
  await check(
    "Eight-game catalog, category filters, search and detail",
    async () => {
      await page.goto(origin + "/games", { waitUntil: "domcontentloaded" });
      await page.getByRole("link", { name: "Sign in", exact: true }).waitFor();
      assert.equal(await page.locator(".game-card").count(), 8);
      await page.getByRole("button", { name: "Matching", exact: true }).click();
      assert.equal(await page.locator(".game-card").count(), 2);
      await page
        .getByRole("button", { name: "Word games", exact: true })
        .click();
      assert.equal(await page.locator(".game-card").count(), 1);
      await page
        .getByRole("button", { name: "All games", exact: true })
        .click();
      await page.getByRole("textbox", { name: "Search games" }).fill("zzzz");
      await page.getByRole("heading", { name: "No matching games" }).waitFor();
      await page.getByRole("button", { name: "Clear filters" }).click();
      assert.equal(await page.locator(".game-card").count(), 8);
      await page.screenshot({
        path: "docs/evidence/catalog-desktop-dark.png",
        fullPage: true,
      });
      await page.locator('a[href="/games/atc-match"]').click();
      await page
        .getByRole("heading", { name: "ATC Match", exact: true })
        .waitFor();
    },
  );
  await check("Mobile navigation and layout", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Sign in", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Games", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Eight games. One aviation obsession." })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "docs/evidence/catalog-mobile-dark.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check(
    "Anonymous API is denied and local demo staff can sign in",
    async () => {
      assert.equal((await api("/api/admin/military")).status, 401);
      // A write from another origin is refused end to end (403), whatever the route would do.
      const crossOrigin = await page.context().request.post(`${origin}/api/admin/plane-of-the-day`, {
        headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" },
        data: {},
      });
      assert.ok([401, 403].includes(crossOrigin.status()), `cross-origin write answered ${crossOrigin.status()}`);
      await signInDemoEditor(page, origin);
      await page
        .getByRole("heading", { name: "Good to have you back." })
        .waitFor({ timeout: 60000 });
      await page.screenshot({
        path: "docs/evidence/admin-overview-dark.png",
        fullPage: true,
      });
    },
  );
  await check(
    "The website's own submission routes are gone (plain 404)",
    async () => {
      for (const [path, method] of [
        ["/api/submissions", "GET"],
        ["/api/submissions", "POST"],
        ["/api/submissions/example", "PUT"],
      ]) {
        const gone = await api(path, method, method === "GET" ? undefined : {});
        assert.equal(gone.status, 404, method + " " + path);
        assert.notEqual(gone.body.code, "SUBMISSIONS_CLOSED", method + " " + path);
      }
    },
  );
  await check(
    "Account page shows the Photo area card instead of My submissions",
    async () => {
      await page.goto(origin + "/account", { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Photo area", exact: true }).waitFor();
      await page.getByRole("link", { name: "Open the photo area", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("heading", { name: "My submissions", exact: true }).count(),
        0,
      );
    },
  );
  await check(
    "Mobile admin fits viewport",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(origin + "/admin", { waitUntil: "domcontentloaded" });
      await page
        .getByRole("heading", { name: "Good to have you back." })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: "docs/evidence/admin-mobile-dark.png",
        fullPage: true,
      });
    },
  );
  assert.deepEqual(pageErrors, []);
  await writeFile(
    "docs/evidence/browser-qa.json",
    JSON.stringify(
      { origin, checkedAt: new Date().toISOString(), results, pageErrors },
      null,
      2,
    ) + "\n",
  );
  console.log("Browser checks passed: " + results.length);
} catch (error) {
  await page
    .screenshot({ path: "docs/evidence/browser-failure.png", fullPage: true })
    .catch(() => {});
  await writeFile(
    "docs/evidence/browser-qa.json",
    JSON.stringify({ results, pageErrors, failure: String(error) }, null, 2) +
      "\n",
  );
  throw error;
} finally {
  await browser.close();
}
