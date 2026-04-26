import type { ChatHistoryItem } from "@/lib/appData";

/** Human-readable relative / short absolute time for sidebar recent list. */
export function formatChatHistoryTime(at: number): string {
  const diff = Date.now() - at;
  if (!Number.isFinite(at) || diff < 0) {
    return "Just now";
  }
  const sec = Math.floor(diff / 1000);
  if (sec < 60) {
    return "Just now";
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const d = Math.floor(hr / 24);
  if (d < 7) {
    return `${d}d ago`;
  }
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Migrate localStorage rows that only had `timestamp: "Just now"` and stable ids. */
export function normalizeChatHistoryFromStorage(raw: unknown): ChatHistoryItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ChatHistoryItem[] = [];
  for (const item of raw) {
    const normalized = normalizeChatHistoryItem(item);
    if (normalized) {
      out.push(normalized);
    }
  }
  return out;
}

function normalizeChatHistoryItem(raw: unknown): ChatHistoryItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") {
    return null;
  }
  if (typeof o.at === "number" && Number.isFinite(o.at)) {
    return { id: o.id, title: o.title, at: o.at };
  }
  const fromId = /^chat-(\d+)$/.exec(o.id);
  if (fromId) {
    return { id: o.id, title: o.title, at: Number(fromId[1]) };
  }
  return { id: o.id, title: o.title, at: Date.now() };
}
