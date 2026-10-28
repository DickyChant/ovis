import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STOPPED_CONNECTING, type Machine } from "../shared/machines.ts";
import { MachineManager } from "./machines.ts";
import type { CompletionTracker } from "./completion.ts";
import type { PushService } from "./push.ts";

// Stop connecting (MachineSettings.paused_all / paused_machines): nothing here may start SSH, so a
// registered PC is placed in the manager directly and every connect it would make is counted.
const PC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
type Inside = { runtime(machine: Machine): { machine: Machine; retry?: unknown }; machines: Map<string, { machine: Machine; retry?: unknown }>; reconnect(runtime: unknown): Promise<void>; retryLater(runtime: unknown): void };

describe("stop connecting", () => {
  const dirs: string[] = [];
  const managers: MachineManager[] = [];
  afterEach(() => {
    for (const manager of managers.splice(0)) manager.stop();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function fixture(dir = mkdtempSync(join(tmpdir(), "herdr-pause-"))) {
    if (!dirs.includes(dir)) dirs.push(dir);
    const manager = new MachineManager(dir, {} as PushService, {} as CompletionTracker, async () => { throw new Error("local offline"); });
    managers.push(manager);
    const inside = manager as unknown as Inside;
    const connects: string[] = [];
    // a connect that got past the stop would reach this
    inside.reconnect = new Proxy(inside.reconnect, { apply: (target, self, args: [{ machine: Machine }]) => { connects.push(args[0].machine.id); return Promise.resolve(); } });
    for (const id of [PC_A, PC_B]) {
      const runtime = inside.runtime({ id, name: id.slice(0, 4), kind: "ssh", enabled: true, state: "connected", target: { destination: "pc" }, snapshot: null, error: null });
      inside.machines.set(id, runtime);
    }
    const machine = (id: string) => manager.list().find((m) => m.id === id)!;
    return { dir, manager, inside, connects, machine };
  }

  it("stops every remote PC, refuses setups, and is kept for the next start", () => {
    const { dir, manager, machine } = fixture();
    expect(manager.updateSettings({ paused_all: true })).toMatchObject({ paused_all: true, paused_machines: [] });
    for (const id of [PC_A, PC_B]) expect(machine(id)).toMatchObject({ paused: true, state: "disconnected", error: null });
    expect(manager.list().find((m) => m.kind === "local")?.paused).toBeUndefined();
    expect(() => manager.setup({ destination: "pc", machine_id: PC_A })).toThrow(STOPPED_CONNECTING);
    expect(() => manager.setup({ destination: "new-pc" })).toThrow(STOPPED_CONNECTING);
    expect(fixture(dir).manager.settings()).toMatchObject({ paused_all: true });
  });

  it("never schedules or starts a reconnect for a stopped PC", async () => {
    const { manager, inside, connects, machine } = fixture();
    manager.setPaused(PC_A, true);
    const runtime = inside.machines.get(PC_A)!;
    inside.retryLater(runtime);
    expect(runtime.retry).toBeUndefined();
    expect(machine(PC_A).state).toBe("disconnected");
    manager.retryNow(PC_A);
    expect(connects).toEqual([]);
    expect(machine(PC_B).paused).toBeUndefined();
  });

  it("resumes one PC while every PC is stopped by stopping the others by name", () => {
    const { manager, connects, machine } = fixture();
    manager.updateSettings({ paused_all: true });
    expect(manager.setPaused(PC_A, false)).toMatchObject({ paused_all: false, paused_machines: [PC_B] });
    expect(machine(PC_A).paused).toBeUndefined();
    expect(machine(PC_B).paused).toBe(true);
    expect(connects).toEqual([PC_A]);
  });

  it("connects every PC again when the stop is lifted", () => {
    const { manager, connects } = fixture();
    manager.updateSettings({ paused_all: true, paused_machines: [PC_A] });
    manager.updateSettings({ paused_all: false, paused_machines: [] });
    expect(connects.sort()).toEqual([PC_A, PC_B].sort());
  });

  it("refuses settings that are not a stop", () => {
    const { manager } = fixture();
    expect(() => manager.updateSettings({ paused_all: "yes" })).toThrow("paused_all must be boolean");
    expect(() => manager.updateSettings({ paused_machines: [1] })).toThrow("paused_machines");
    expect(() => manager.setPaused("missing", true)).toThrow("PC not found");
  });
});
