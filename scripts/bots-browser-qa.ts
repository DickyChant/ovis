import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import "./test-herdr.ts";
import { createServer } from "../server/index.ts";
import { BotsService } from "../server/bots.ts";
import { demoBots } from "../site/demo/bots.ts";

const stateDir = mkdtempSync(join(tmpdir(), "ovis-bots-browser-"));
let online = true;
let rotated = false;
const bots = new BotsService({ url: "http://127.0.0.1:3090", fetch: async () => {
  if (!online) throw new Error("Fixture disconnected");
  const value = demoBots();
  if (rotated) {
    value.bots[0]!.conversations[0]!.currentSessionId = "chief-3";
    value.bots[0]!.conversations[0]!.sessionIds.push("chief-3");
  }
  return Response.json(value);
} });
const server = createServer({ port: 0, hostname: "127.0.0.1", stateDir, token: "", tailscaleOwner: null, bots });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Bots", exact: true });
  await dialog.getByRole("button", { name: /Editor.*Needs attention/ }).waitFor();
  assert.equal(await dialog.locator(".bots-row").count(), 2);
  assert.equal(await dialog.getByRole("link", { name: "Open in DSH" }).getAttribute("href"), "http://127.0.0.1:3090/");
  await dialog.getByRole("button", { name: /Chief.*Working/ }).click();
  await dialog.getByRole("heading", { name: "Chief", exact: true }).waitFor();
  assert.equal(await dialog.getByText("Launch review", { exact: true }).count(), 1);
  rotated = true;
  await dialog.getByText("3 session parts", { exact: true }).waitFor({ timeout: 12000 });
  assert.equal(await dialog.locator(".bots-row").count(), 2, "part rotation does not duplicate Bots");
  const evidence = process.env["UI_EVIDENCE_DIR"];
  if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "bots-desktop.png"), animations: "disabled" }); }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await dialog.evaluate((node) => node.getBoundingClientRect().width <= window.innerWidth));
  await dialog.evaluate((node) => { for (const animation of node.getAnimations()) animation.finish(); });
  assert.ok(await dialog.evaluate((node) => node.getBoundingClientRect().bottom <= window.innerHeight + 1));
  if (evidence) await page.screenshot({ path: join(evidence, "bots-phone.png"), animations: "disabled" });
  online = false;
  await dialog.getByText("DSH is offline. Shown Bots may be out of date.", { exact: true }).waitFor({ timeout: 12000 });
  assert.equal(await dialog.getByText("Status unavailable", { exact: true }).count(), 2);
  online = true;
  await dialog.getByText("Working", { exact: true }).waitFor({ timeout: 12000 });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log("PASS Bots: roster, group work, part rotation, stale status, recovery, desktop/phone and Escape");
} finally { await browser.close(); server.stop(); rmSync(stateDir, { recursive: true, force: true }); }
