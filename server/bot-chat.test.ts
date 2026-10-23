import { expect, test } from "bun:test";
import { BotChatService, parseBotChat } from "./bot-chat.ts";

const target = "runtimeId=r&botId=b";
const page = { sessionId: "s", sendState: "ready", cursor: { part: 0 }, items: [{ id: "m", kind: "bot", text: "Hello", private: "SECRET" }], private: "SECRET" };
const request = (action: string, body?: unknown) => new Request(`http://localhost/api/bots/${action}?${target}`, body === undefined ? {} : { method: "POST", headers: { "x-ovis-bot": "1" }, body: JSON.stringify(body) });

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
