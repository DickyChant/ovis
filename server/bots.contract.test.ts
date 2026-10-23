import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";
import { BotsService } from "./bots.ts";

test("the directory uses Ovis authentication and cannot write to DSH", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ovis-bots-"));
  let reads = 0;
  const bots = new BotsService({ url: "http://127.0.0.1:3090", fetch: async (_url, init) => {
    reads++;
    expect(init.headers).toBeUndefined();
    expect(init.method).toBeUndefined();
    return Response.json({ version: 1, runtimeId: "runtime", observedAt: Date.now(), bots: [] });
  } });
  const server = createServer({ port: 0, hostname: "127.0.0.1", stateDir, token: "fixture-bots", machines: false, tailscaleOwner: null, bots });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    expect((await fetch(`${base}/api/bots`)).status).toBe(401);
    expect(reads).toBe(0);
    const response = await fetch(`${base}/api/bots`, { headers: { authorization: "Bearer fixture-bots" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).runtimeId).toBe("runtime");
    const mutation = await fetch(`${base}/api/bots`, { method: "POST", headers: { authorization: "Bearer fixture-bots", origin: base } });
    expect(mutation.status).toBe(405);
    expect(reads).toBe(1);
  } finally { server.stop(); rmSync(stateDir, { recursive: true, force: true }); }
});
