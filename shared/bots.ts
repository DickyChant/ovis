export type BotStatus = "available" | "working" | "attention" | "waiting" | "unknown";
export interface BotSettings { model: string | null; writable: boolean; working: boolean; sessionId: string; models: { ref: string; name: string; provider: string; available: boolean }[] }
export interface BotChatCursor { part: number; beforeSeq?: number }
export interface BotFile { id: string; name: string; bytes: number }
export interface BotUpload { receiptId: string; sessionId: string; name: string; bytes: number }
export interface BotApproval { id: string; sessionId: string; botId: string; name: string; tool: string; reason: string; detail: string; answerable: boolean }
export interface BotChatItem { id: string; kind: "user" | "bot" | "divider"; text: string; name?: string; files?: BotFile[] }
export interface BotChatPage { recent?: boolean; sessionId: string; sendState: "ready" | "setup_required" | "read_only"; items: BotChatItem[]; cursor: BotChatCursor | null }
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
