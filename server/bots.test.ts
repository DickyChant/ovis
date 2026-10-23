import { expect, test } from "bun:test";
import { BotsService, dshUrl, parseBotDirectory } from "./bots.ts";

const fixture = () => ({ version: 1, runtimeId: "runtime-1", observedAt: 123, secret: "PRIVATE", bots: [{ id: "bot-1", name: "Writer", role: "Drafts", status: "working", instructions: "PRIVATE", conversations: [{ id: "direct:bot-1", name: "Writer", kind: "direct", currentSessionId: "part-2", sessionIds: ["part-1", "part-2"], transcript: "PRIVATE" }] }] });

test("only whitelisted metadata crosses the Ovis boundary", () => {
  const value = parseBotDirectory(fixture());
  expect(value.bots[0]!.conversations[0]!.sessionIds).toEqual(["part-1", "part-2"]);
  expect(JSON.stringify(value)).not.toContain("PRIVATE");
  expect(() => parseBotDirectory({ ...fixture(), version: 2 })).toThrow();
  expect(() => parseBotDirectory({ ...fixture(), bots: [...fixture().bots, ...fixture().bots] })).toThrow();
});

test("fetch destinations are fixed loopback origins without credentials or redirects", async () => {
  for (const value of ["http://evil.test/", "http://127.0.0.1@evil.test/", "http://127.0.0.1/?token=x", "file:///tmp/file", "http://127.0.0.1/path", "https://127.0.0.1/"]) expect(() => dshUrl(value, true)).toThrow();
  expect(dshUrl("http://[::1]:3090/", true).hostname).toBe("[::1]");
  let calls = 0;
  const source = new BotsService({ url: "http://127.0.0.1:3090", fetch: (async (target, init) => {
    calls++;
    expect(String(target)).toBe("http://127.0.0.1:3090/herdr-bots");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toBeUndefined();
    return Response.json(fixture());
  }) });
  const [first, second] = await Promise.all([source.snapshot(), source.snapshot()]);
  expect(calls).toBe(1);
  expect(first).toEqual(second);
  expect(first.state).toBe("online");
  expect(first.machineId).toBe("local");
});

test("offline never turns last-known work into available; recovery and replacement are fresh", async () => {
  let now = 0;
  let fail = false;
  let value = fixture();
  const source = new BotsService({ url: "http://127.0.0.1:3090", now: () => now, fetch: (async () => {
    if (fail) throw new Error("PRIVATE");
    return Response.json(value);
  }) });
  expect((await source.snapshot()).bots[0]!.status).toBe("working");
  fail = true; now += 3000;
  const offline = await source.snapshot();
  expect(offline.state).toBe("offline");
  expect(offline.bots[0]!.status).toBe("unknown");
  expect(offline.observedAt).toBe(123);
  expect(JSON.stringify(offline)).not.toContain("PRIVATE");
  fail = false; now += 3000; value = { ...fixture(), runtimeId: "replacement", bots: [] };
  const recovered = await source.snapshot();
  expect(recovered.state).toBe("online");
  expect(recovered.runtimeId).toBe("replacement");
  expect(recovered.bots).toEqual([]);
});

test("disabled, missing plugin, malformed and oversized responses are explicit", async () => {
  expect((await new BotsService().snapshot()).state).toBe("not_configured");
  for (const response of [new Response(null, { status: 503 }), Response.json({ version: 99 }), new Response("x".repeat(2_000_001))]) {
    const service = new BotsService({ url: "http://127.0.0.1:3090", fetch: (async () => response) });
    expect((await service.snapshot()).state).toBe("incompatible");
  }
  const service = new BotsService();
  const mutation = await service.handle(new Request("http://localhost/api/bots", { method: "POST" }));
  expect(mutation.status).toBe(405);
  expect(mutation.headers.get("allow")).toBe("GET");
  expect((await service.handle(new Request("http://localhost/api/bots"))).headers.get("cache-control")).toBe("no-store");
});
