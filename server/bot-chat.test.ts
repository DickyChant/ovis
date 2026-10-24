import { expect, test } from "bun:test";
import { BotChatService, parseBotChat, parseBotSettings } from "./bot-chat.ts";

const target = "runtimeId=r&botId=b";
const page = { sessionId: "s", sendState: "ready", cursor: { part: 0 }, items: [{ id: "m", kind: "bot", text: "Hello", private: "SECRET" }], private: "SECRET" };
const request = (action: string, body?: unknown) => new Request(`http://localhost/api/bots/${action}?${target}`, body === undefined ? {} : { method: "POST", headers: { "x-ovis-bot": "1" }, body: JSON.stringify(body) });

test("native controls expose only model metadata and forward a bounded explicit action", async () => {
  const settings = { model: null, writable: true, working: false, sessionId: "s", models: [{ ref: "mock/one", name: "One", provider: "Mock", available: true, secret: "SECRET" }] };
  expect(JSON.stringify(parseBotSettings(settings))).not.toContain("SECRET");
  let calls = 0;
  const service = new BotChatService({ url: "http://127.0.0.1:3096", token: "fixture", fetch: async (url, init) => {
    calls++;
    if (url.pathname.endsWith("settings")) return Response.json(settings);
    const input = JSON.parse(String(init.body));
    expect(input).toEqual({ runtimeId: "r", botId: "b", requestId: "control-id-000001", action: "model", model: "mock/one" });
    return Response.json({ accepted: true, requestId: input.requestId });
  } });
  expect((await service.handle(request("settings"))).status).toBe(200);
  expect((await service.handle(request("control", { runtimeId: "r", botId: "b", requestId: "control-id-000001", action: "model", model: "mock/one", secret: "NEVER" }))).status).toBe(200);
  expect((await service.handle(request("control", { action: "delete" }))).status).toBe(400);
  expect(calls).toBe(2);
});

test("chat validates and whitelists history, and only server credentials reach fixed DSH origin", async () => {
  expect(JSON.stringify(parseBotChat(page))).not.toContain("SECRET");
  const service = new BotChatService({ url: "http://127.0.0.1:3096", token: "private-fixture", fetch: (async (url, init) => {
    expect(String(url)).toBe("http://127.0.0.1:3096/herdr-bots/chat");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-fixture");
    expect(JSON.parse(String(init?.body))).toEqual({ runtimeId: "r", botId: "b", cursor: null });
    return Response.json(page);
  }) });
  const response = await service.handle(request("chat"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(JSON.stringify(await response.json())).not.toContain("SECRET");
  expect((await service.handle(request("chat", {}))).status).toBe(405);
});

test("send validation and lost acknowledgements cannot automatically replay a message", async () => {
  let calls = 0;
  const service = new BotChatService({ url: "http://127.0.0.1:3096", token: "private-fixture", fetch: (async () => { calls++; throw new Error("SECRET"); }) });
  expect((await service.handle(request("send", { text: "hello" }))).status).toBe(400);
  expect(calls).toBe(0);
  const response = await service.handle(request("send", { runtimeId: "r", botId: "b", requestId: "request-id-00000001", text: "hello" }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "send_unconfirmed", message: "Bot conversation unavailable" } });
  expect(calls).toBe(1);
});

test("SSE cancellation and device revocation release the upstream connection", async () => {
  let revoked = () => {};
  let removed = false;
  let signal: AbortSignal | undefined;
  const service = new BotChatService({ url: "http://127.0.0.1:3096", token: "private-fixture", fetch: (async (_url, init) => {
    signal = init?.signal as AbortSignal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n')); } }), { headers: { "content-type": "text/event-stream" } });
  }) });
  const response = await service.handle(request("events"), (close) => { revoked = close; return () => { removed = true; }; });
  const reader = response.body!.getReader();
  expect((await reader.read()).done).toBe(false);
  revoked();
  expect(signal?.aborted).toBe(true);
  await reader.cancel();
  expect(removed).toBe(true);
});

test("group target and session-bound upload receipts pass through an authenticated narrow route", async () => {
  const seen: Record<string, unknown>[] = [];
  const service = new BotChatService({ url: "http://127.0.0.1:3096", token: "fixture", fetch: async (url, init) => {
    const input = JSON.parse(String(init.body)); seen.push(input);
    return url.pathname.endsWith("upload") ? Response.json({ receiptId: "receipt", sessionId: "room", name: "你好.txt", bytes: 5, private: "SECRET" }) : Response.json({ accepted: true, requestId: input.requestId });
  } });
  const body = { runtimeId: "r", botId: "b", roomId: "room", sessionId: "room", requestId: "files-request-0001" };
  const upload = await service.handle(request("upload", { ...body, name: "你好.txt", data: "aGVsbG8=", path: "/SECRET" }));
  expect(upload.status).toBe(200); expect(JSON.stringify(await upload.json())).not.toContain("SECRET");
  expect((await service.handle(request("send", { ...body, text: "", receipts: ["receipt"] }))).status).toBe(200);
  expect(seen[1]!.roomId).toBe("room"); expect(seen[1]!.receipts).toEqual(["receipt"]);
  expect(seen[0]!.path).toBeUndefined();
  expect((await service.handle(request("send", { ...body, text: "", receipts: Array(9).fill("receipt") }))).status).toBe(400);
});

test("files are downloaded as inert bytes and approval decisions never broaden permissions", async () => {
  let calls = 0;
  const service = new BotChatService({ url: "http://127.0.0.1:3096", token: "fixture", fetch: async (url, init) => {
    calls++;
    if (url.pathname.endsWith("download")) return Response.json({ name: "unsafe.html", data: Buffer.from("<script>bad()</script>").toString("base64") });
    const input = JSON.parse(String(init.body));
    expect(input.choice).toBe("reject"); expect(input.sessionId).toBe("s");
    return Response.json({ accepted: true, requestId: input.requestId });
  } });
  const download = await service.handle(new Request(`http://localhost/api/bots/download?${target}&fileId=opaque`));
  expect(download.headers.get("content-type")).toBe("application/octet-stream");
  expect(download.headers.get("content-disposition")).toStartWith("attachment;");
  expect(download.headers.get("x-content-type-options")).toBe("nosniff");
  const body = { runtimeId: "r", botId: "b", sessionId: "s", approvalId: "a", requestId: "approval-request-1", choice: "reject" };
  expect((await service.handle(request("answer", body))).status).toBe(200);
  expect((await service.handle(request("answer", { ...body, choice: "always" }))).status).toBe(400);
  expect((await service.handle(new Request("http://localhost/api/bots/answer", { method: "POST", body: JSON.stringify(body) }))).status).toBe(403);
  expect(calls).toBe(2);
});
