import { expect, test } from "bun:test";
import { BotDrafts } from "./botDrafts.ts";

test("pending sends and drafts survive subscribers closing; replies never erase newer edits", () => {
  const drafts = new BotDrafts();
  let updates = 0;
  const off = drafts.subscribe(() => updates++);
  drafts.update("runtime:bot", { text: "first", sending: true });
  off();
  expect(drafts.get("runtime:bot").sending).toBe(true);
  drafts.update("runtime:bot", { text: "next" });
  drafts.accepted("runtime:bot", "first");
  expect(drafts.get("runtime:bot")).toEqual({ text: "next", sending: false, uncertain: false });
  expect(drafts.get("other:bot").text).toBe("");
  expect(updates).toBe(1);
});
