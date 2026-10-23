export interface BotDraft { text: string; sending: boolean; uncertain: boolean }
const EMPTY: BotDraft = { text: "", sending: false, uncertain: false };

/** Tab-local drafts and pending sends outlive the modal and the selected Bot. */
export class BotDrafts {
  private readonly drafts = new Map<string, BotDraft>();
  private readonly listeners = new Set<() => void>();
  get = (key: string): BotDraft => this.drafts.get(key) ?? EMPTY;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  update(key: string, patch: Partial<BotDraft>) {
    this.drafts.set(key, { ...this.get(key), ...patch });
    for (const listener of this.listeners) listener();
  }
  accepted(key: string, text: string) {
    this.update(key, { sending: false, uncertain: false, ...(this.get(key).text === text ? { text: "" } : {}) });
  }
}
