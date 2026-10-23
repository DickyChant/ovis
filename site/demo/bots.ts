import type { BotDirectory } from "../../shared/bots.ts";

/** Fictional metadata only; the demo never discovers a real DSH runtime. */
export function demoBots(): BotDirectory {
  return {
    version: 1, machineId: "local", runtimeId: "demo-team", state: "online", observedAt: Date.now(), openUrl: null,
    bots: [
      { id: "chief", name: "Chief", role: "Coordinates the team", status: "working", conversations: [
        { id: "direct:chief", kind: "direct", name: "Chief", currentSessionId: "chief-2", sessionIds: ["chief-1", "chief-2"] },
        { id: "group:launch", kind: "group", name: "Launch review", currentSessionId: "launch-chief", sessionIds: ["launch-chief"] },
      ] },
      { id: "editor", name: "Editor", role: "Reviews the draft", status: "attention", conversations: [
        { id: "direct:editor", kind: "direct", name: "Editor", currentSessionId: "editor-1", sessionIds: ["editor-1"] },
        { id: "group:launch", kind: "group", name: "Launch review", currentSessionId: "launch-editor", sessionIds: ["launch-editor"] },
      ] },
    ],
  };
}
