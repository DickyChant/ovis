import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import "./test-herdr.ts";
import { createServer } from "../server/index.ts";
import { BotChatService } from "../server/bot-chat.ts";
import { BotsService } from "../server/bots.ts";
import { demoBots } from "../site/demo/bots.ts";

const stateDir = mkdtempSync(join(tmpdir(), "ovis-bots-browser-"));
let online = true;
let rotated = false;
let frameLoads = 0;
const dshFrame = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
  frameLoads++;
  const signedIn = request.headers.get("cookie")?.includes("dsh_portal_fixture=ready");
  return new Response(signedIn ? "<!doctype html><html lang=en><title>DSH fixture</title><h1>Fictional DSH workspace</h1><button>Models fixture</button></html>" : "<!doctype html><html lang=en><h1>DSH fixture sign-in required</h1></html>", { headers: { "content-type": "text/html" } });
} });
const dshAddress = `http://127.0.0.1:${dshFrame.port}/`;
const bots = new BotsService({ url: "http://127.0.0.1:3090", publicUrl: dshAddress, fetch: async () => {
  if (!online) throw new Error("Fixture disconnected");
  const value = demoBots();
  if (rotated) {
    value.bots[0]!.conversations[0]!.currentSessionId = "chief-3";
    value.bots[0]!.conversations[0]!.sessionIds.push("chief-3");
  }
  return Response.json(value);
} });
const chats = new Map<string, { id: string; kind: string; text: string }[]>();
const listeners = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
const encoder = new TextEncoder();
const emit = (botId: string, event: string, data: unknown) => {
  for (const listener of listeners.get(botId) ?? []) listener.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
};
let sent = 0;
let rejectSend = false;
let setupRequired = false;
let selectedModel: string | null = "mock/one";
let stopped = 0;
const botChat = new BotChatService({ url: "http://127.0.0.1:3090", token: "fixture", fetch: async (url, init) => {
  const target = new URL(String(url));
  const action = target.pathname.split("/").at(-1);
  if (action === "events") {
    const botId = target.searchParams.get("botId")!;
    let own: ReadableStreamDefaultController<Uint8Array>;
    const leave = () => { listeners.get(botId)?.delete(own); try { own.close(); } catch {} };
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      own = controller;
      if (!listeners.has(botId)) listeners.set(botId, new Set());
      listeners.get(botId)!.add(own);
      own.enqueue(encoder.encode('event: ready\ndata: {}\n\n'));
      init.signal?.addEventListener("abort", leave, { once: true });
    }, cancel: leave }), { headers: { "content-type": "text/event-stream" } });
  }
  const input = JSON.parse(String(init.body));
  if (action === "settings") return Response.json({ model: selectedModel, writable: true, working: true, sessionId: "s", models: [{ ref: "mock/one", name: "One", provider: "Mock", available: true }, { ref: "mock/two", name: "Two", provider: "Mock", available: true }] });
  if (action === "control") {
    if (input.action === "model") { selectedModel = input.model; setupRequired = false; emit(input.botId, "changed", {}); }
    else { stopped++; assert.equal(input.sessionId, "s"); }
    return Response.json({ accepted: true, requestId: input.requestId });
  }
  if (action === "send") {
    sent++;
    if (rejectSend) throw new Error("Fixture lost acknowledgement");
    chats.set(input.botId, [...(chats.get(input.botId) ?? []), { id: `user-${sent}`, kind: "user", text: input.text }]);
    emit(input.botId, "changed", {});
    emit(input.botId, "stream", { attemptId: "a", phase: "start" });
    emit(input.botId, "stream", { attemptId: "a", text: "Streaming a fictional reply" });
    return Response.json({ accepted: true, requestId: input.requestId });
  }
  return Response.json({ sessionId: "s", sendState: setupRequired ? "setup_required" : "ready", cursor: null, items: chats.get(input.botId) ?? [] });
} });
const server = createServer({ port: 0, hostname: "127.0.0.1", stateDir, token: "", tailscaleOwner: null, bots, botChat });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "load" });
  await page.getByRole("link", { name: "Bots", exact: true }).click().catch(async (error) => { console.log("Fixture page:", await page.locator("body").innerText(), errors); throw error; });
  const dialog = page.getByRole("main", { name: "DSH workspace", exact: true });
  await dialog.getByRole("button", { name: /Editor.*Needs attention/ }).waitFor();
  assert.equal(await dialog.locator(".bots-row").count(), 2);
  assert.equal(await dialog.getByRole("link", { name: "Open in DSH" }).getAttribute("href"), dshAddress);
  await dialog.getByRole("button", { name: /Chief.*Working/ }).click();
  await dialog.getByRole("heading", { name: "Chief", exact: true }).waitFor();
  await dialog.locator(".bots-conversations summary").click();
  assert.equal(await dialog.getByText("Launch review", { exact: true }).count(), 1);
  await dialog.getByText("Connected to DSH", { exact: true }).waitFor();
  const chiefId = demoBots().bots.find((bot) => bot.name === "Chief")!.id;
  const composer = dialog.getByRole("textbox", { name: "Message Chief" });
  await composer.fill("Draft kept across Bot selection");
  await dialog.getByRole("button", { name: /Editor.*Needs attention/ }).click();
  await dialog.getByRole("textbox", { name: "Message Editor" }).fill("Other Bot draft");
  await dialog.getByRole("button", { name: /Chief.*Working/ }).click();
  assert.equal(await composer.inputValue(), "Draft kept across Bot selection");
  await dialog.getByText("Connected to DSH", { exact: true }).waitFor();
  await composer.fill("A fictional user message 你好");
  await dialog.getByRole("button", { name: "Send message", exact: true }).click();
  await dialog.getByText("Streaming a fictional reply", { exact: true }).waitFor();
  assert.equal(sent, 1);
  await dialog.getByText("A fictional user message 你好", { exact: true }).waitFor();
  chats.get(chiefId)!.push({ id: "reply-1", kind: "bot", text: "A completed fictional reply" });
  emit(chiefId, "stream", { attemptId: "a", phase: "end" });
  await dialog.getByText("A completed fictional reply", { exact: true }).waitFor();
  rejectSend = true;
  await composer.fill("Uncertain delivery draft");
  await dialog.getByRole("button", { name: "Send message", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Send was not confirmed" }).waitFor();
  assert.equal(await composer.inputValue(), "Uncertain delivery draft");
  assert.equal(sent, 2);
  rejectSend = false;
  rotated = true;
  await dialog.getByText("3 session parts", { exact: true }).waitFor({ timeout: 12000 });
  assert.equal(await dialog.locator(".bots-row").count(), 2, "part rotation does not duplicate Bots");
  await dialog.locator(".bots-detail").evaluate((node) => { node.scrollTop = 0; });
  const evidence = process.env["UI_EVIDENCE_DIR"];
  if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "bots-desktop.png"), animations: "disabled" }); }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await dialog.evaluate((node) => node.getBoundingClientRect().width <= window.innerWidth));
  await dialog.evaluate((node) => { for (const animation of node.getAnimations()) animation.finish(); });
  assert.ok(await dialog.evaluate((node) => node.getBoundingClientRect().bottom <= window.innerHeight + 1));
  if (evidence) await page.screenshot({ path: join(evidence, "bots-phone.png"), animations: "disabled" });
  online = false;
  await dialog.getByText("DSH is offline. Shown Bots may be out of date.", { exact: true }).waitFor({ timeout: 12000 });
  assert.equal(await dialog.locator(".bots-roster").getByText("Status unavailable", { exact: true }).count(), 2);
  online = true;
  await dialog.locator(".bots-roster").getByText("Working", { exact: true }).waitFor({ timeout: 12000 });
  assert.equal(sent, 2, "recovery never replays the uncertain send");
  assert.equal(await composer.inputValue(), "Uncertain delivery draft");
  await dialog.getByRole("button", { name: "Back to terminals" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Bots", exact: true }).click();
  await dialog.getByRole("button", { name: /Chief.*Working/ }).click();
  assert.equal(await composer.inputValue(), "Uncertain delivery draft", "leaving the workspace preserves the draft");
  setupRequired = true; selectedModel = null;
  emit(chiefId, "changed", {});
  await dialog.getByText("Choose a model above before sending messages.", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Send message", exact: true }).isDisabled(), true);
  await dialog.getByRole("button", { name: "Refresh Bots" }).click();
  await dialog.getByRole("combobox", { name: "Bot model" }).selectOption("mock/two");
  await dialog.getByRole("button", { name: "Apply model" }).click();
  await dialog.getByText("Choose a model above before sending messages.", { exact: true }).waitFor({ state: "detached" });
  assert.equal(selectedModel, "mock/two");
  await dialog.getByRole("button", { name: "Stop reply" }).click();
  await page.waitForResponse((response) => response.url().includes("/api/bots/settings"));
  assert.equal(stopped, 1);
  assert.equal(await page.locator("iframe").count(), 0, "native workspace needs no DSH frame or cookie");
  assert.equal(new URL(page.url()).pathname, "/dsh");
  await dialog.getByRole("searchbox", { name: "Find a Bot" }).fill("Chief");
  assert.equal(await dialog.locator(".bots-row").count(), 1);
  await dialog.getByRole("searchbox", { name: "Find a Bot" }).fill("");
  await page.reload();
  await dialog.getByRole("heading", { name: "Chief", exact: true }).waitFor();
  await page.goBack();
  await dialog.waitFor({ state: "detached" });
  await page.goForward();
  await dialog.getByRole("heading", { name: "Chief", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Back to terminals", exact: true }).click();
  await page.getByRole("button", { name: "Open DSH", exact: true }).click();
  const portal = page.getByRole("dialog", { name: "DSH workspace", exact: true });
  const frame = portal.frameLocator("iframe");
  await frame.getByRole("heading", { name: "DSH fixture sign-in required" }).waitFor();
  await page.context().addCookies([{ name: "dsh_portal_fixture", value: "ready", url: dshAddress, httpOnly: true, sameSite: "Lax" }]);
  await portal.getByRole("button", { name: "Reload DSH" }).click();
  await frame.getByRole("heading", { name: "Fictional DSH workspace" }).waitFor();
  assert.equal(await portal.getByRole("link", { name: "Open DSH in a new tab" }).getAttribute("href"), dshAddress);
  assert.ok(frameLoads >= 2);
  assert.ok(!(await portal.locator("iframe").getAttribute("sandbox"))!.includes("allow-top-navigation"));
  if (evidence) await page.screenshot({ path: join(evidence, "dsh-portal-desktop.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await portal.evaluate((node) => node.getBoundingClientRect().width <= window.innerWidth));
  assert.ok(await portal.getByRole("button", { name: "Close DSH" }).isVisible());
  await frame.getByRole("heading", { name: "Fictional DSH workspace" }).waitFor();
  assert.ok(await portal.locator("iframe").evaluate((node) => node.getBoundingClientRect().height > 300));
  await frame.locator("body").evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  if (evidence) await page.screenshot({ path: join(evidence, "dsh-portal-phone.png"), animations: "disabled" });
  await portal.getByRole("button", { name: "Close DSH" }).click();
  await portal.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log("PASS Bots: roster, group work, part rotation, stale status, recovery, desktop/phone, chat, streaming, drafts, uncertain sends, native /dsh navigation, model/stop controls and authenticated embedded DSH");
} finally { await browser.close(); server.stop(); dshFrame.stop(); rmSync(stateDir, { recursive: true, force: true }); }
