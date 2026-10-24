import { useEffect, useRef, useSyncExternalStore } from "react";
import { BotDrafts } from "./botDrafts.ts";

export const isDshWorkspace = () => /^\/dsh\/?$/.test(window.location.pathname);
const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
export const useDshWorkspace = () => useSyncExternalStore(subscribe, isDshWorkspace);
export function useBotWorkspace(setDrawerOpen: (open: boolean) => void) {
  const active = useDshWorkspace();
  const drafts = useRef(new BotDrafts());
  useEffect(() => { if (active) setDrawerOpen(false); }, [active, setDrawerOpen]);
  return { active, drafts: drafts.current };
}
export function navigateDshWorkspace(open: boolean): void {
  window.history.pushState(null, "", open ? "/dsh" : "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}
