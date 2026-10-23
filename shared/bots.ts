export type BotStatus = "available" | "working" | "attention" | "waiting" | "unknown";
export interface BotConversation {
  id: string;
  kind: "direct" | "group";
  name: string;
  currentSessionId: string | null;
  sessionIds: string[];
}
export interface DirectoryBot {
  id: string;
  name: string;
  role: string;
  status: BotStatus;
  conversations: BotConversation[];
}
export interface BotDirectory {
  version: 1;
  machineId: "local";
  runtimeId: string | null;
  state: "not_configured" | "online" | "offline" | "incompatible";
  observedAt: number | null;
  openUrl: string | null;
  bots: DirectoryBot[];
}
