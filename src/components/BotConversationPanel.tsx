import { useState } from "react";
import type { DirectoryBot } from "../../shared/bots.ts";
import type { BotDrafts } from "../lib/botDrafts.ts";
import { useT } from "../lib/i18n.ts";
import { BotControls } from "./BotControls.tsx";
import { BotChat } from "./BotChat.tsx";

export function BotConversationPanel({ runtimeId, bot, online, drafts, revision, onActivity }: { runtimeId: string; bot: DirectoryBot; online: boolean; drafts: BotDrafts; revision: number; onActivity(): void }) {
  const t = useT();
  const [selected, setSelected] = useState("");
  const room = bot.conversations.find((entry) => entry.kind === "group" && entry.id === selected);
  const roomId = room?.id.slice("group:".length);
  return <>
    <label className="bots-conversation-picker">{t("Conversations")}<select value={room?.id ?? ""} onChange={(event) => setSelected(event.target.value)}>
      <option value="">{t("Direct chat")}</option>
      {bot.conversations.filter((entry) => entry.kind === "group").map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </select></label>
    {!roomId && <BotControls runtimeId={runtimeId} botId={bot.id} online={online} revision={revision} onChanged={onActivity} />}
    <BotChat key={roomId ?? bot.id} runtimeId={runtimeId} botId={bot.id} roomId={roomId} name={room?.name ?? bot.name} online={online} drafts={drafts} onActivity={onActivity} />
  </>;
}
