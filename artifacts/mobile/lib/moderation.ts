// Plain words for the Moderation screens.

import { REPORT_REASONS } from "@/hooks/useReportBlock";

export function reasonLabel(code: string): string {
  return REPORT_REASONS.find((r) => r.code === code)?.label ?? "Something else";
}

/** Who or what filed the report. */
export function sourceLabel(source: string): string {
  switch (source) {
    case "user":
      return "Reported by a player";
    case "stream":
      return "Flagged by message screening";
    case "auto":
      return "Flagged by auto-restrict";
    case "appeal":
      return "Appeal";
    default:
      return "Report";
  }
}

export function agentActionLabel(action: string): string {
  switch (action) {
    case "hide":
      return "Hid a message";
    case "restrict":
      return "Restricted the account";
    case "dismiss":
      return "Dismissed the report";
    default:
      return "Escalated to you and restricted the account";
  }
}

/** "Just now", "12 min ago", "3 hr ago", "2 days ago". */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
}
