// Moderation data for the admin-only Moderation screens. Spec: Messaging and
// moderation, Enforcement ladder. Every call here is admin-only on the server
// (requireAdmin); the app only shows the screens to the admin.

import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage, apiFetch } from "@/lib/api";

export interface SnapshotMessage {
  id: string;
  senderClerkUserId: string;
  senderName: string;
  text: string;
  at: string;
  reported: boolean;
}

export interface Report {
  id: number;
  reporterClerkUserId: string | null;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: "open" | "reviewed" | "actioned" | "dismissed";
  source: "user" | "auto" | "stream" | "appeal";
  subjectClerkUserId: string | null;
  subjectName: string | null;
  createdAt: string;
  snapshot: { conversationId: number | null; messages: SnapshotMessage[] } | null;
}

export interface AgentDecision {
  id: number;
  reportId: number;
  action: "hide" | "restrict" | "dismiss" | "escalate";
  reason: string;
  createdAt: string;
}

export interface Appeal {
  id: number;
  sanctionId: number;
  clerkUserId: string;
  name: string | null;
  reference: string;
  createdAt: string;
  outcome: "upheld" | "overturned" | null;
  sanction: { id: number; kind: "ban" | "suspend"; reason: string; endsAt: string | null; liftedAt: string | null } | null;
}

export const moderationKeys = {
  all: ["moderation"] as const,
  admin: ["moderation", "admin"] as const,
  reports: ["moderation", "reports"] as const,
  decisions: ["moderation", "decisions"] as const,
  appeals: ["moderation", "appeals"] as const,
};

function useCall() {
  const { getToken } = useAuth();
  return async function call<T>(path: string, init?: RequestInit, fallback = "That didn't work. Try again."): Promise<T> {
    let res: Response;
    try {
      res = await apiFetch(path, getToken, init);
    } catch {
      throw new Error("Check your connection and try again.");
    }
    if (!res.ok) throw new Error(await apiErrorMessage(res, fallback));
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  };
}

/** isAdmin is true only for the admin account. Everyone else never sees Moderation. */
export function useIsAdmin() {
  const call = useCall();
  const q = useQuery({
    queryKey: moderationKeys.admin,
    queryFn: () => call<{ admin: boolean }>("/api/admin/me"),
    staleTime: 10 * 60_000,
    retry: false,
  });
  return { isAdmin: q.data?.admin === true, isPending: q.isPending };
}

export function useOpenReports(enabled = true) {
  const call = useCall();
  return useQuery({
    queryKey: moderationKeys.reports,
    queryFn: () => call<Report[]>("/api/admin/reports?status=open"),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useReport(id: number | null) {
  const call = useCall();
  return useQuery({
    queryKey: [...moderationKeys.reports, id] as const,
    queryFn: () => call<Report>(`/api/admin/reports/${id}`),
    enabled: id !== null,
  });
}

export function usePendingDecisions(enabled = true) {
  const call = useCall();
  return useQuery({
    queryKey: moderationKeys.decisions,
    queryFn: () => call<AgentDecision[]>("/api/admin/agent-decisions"),
    enabled,
  });
}

export function useOpenAppeals(enabled = true) {
  const call = useCall();
  return useQuery({
    queryKey: moderationKeys.appeals,
    queryFn: () => call<Appeal[]>("/api/admin/appeals"),
    enabled,
  });
}

const post = (body?: object): RequestInit => ({ method: "POST", body: body ? JSON.stringify(body) : undefined });

export function useModerationActions() {
  const call = useCall();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: moderationKeys.all });
  const after = async <T>(p: Promise<T>) => {
    const r = await p;
    await refresh();
    return r;
  };

  return {
    refresh,
    setReportStatus: (id: number, status: Report["status"]) =>
      after(call(`/api/admin/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status }) })),
    hideMessage: (messageId: string) => after(call(`/api/admin/messages/${encodeURIComponent(messageId)}/hide`, post({ hidden: true }))),
    restrict: (clerkUserId: string, reason: string, reportId: number) =>
      after(call(`/api/admin/accounts/${encodeURIComponent(clerkUserId)}/restrict`, post({ reason, reportId }))),
    suspend: (clerkUserId: string, reason: string, reportId: number, days: number) =>
      after(call(`/api/admin/accounts/${encodeURIComponent(clerkUserId)}/suspend`, post({ reason, reportId, days }))),
    ban: (clerkUserId: string, reason: string, reportId: number) =>
      after(call(`/api/admin/accounts/${encodeURIComponent(clerkUserId)}/ban`, post({ reason, reportId }))),
    decide: (decisionId: number, verb: "confirm" | "undo") => after(call(`/api/admin/agent-decisions/${decisionId}/${verb}`, post())),
    decideAppeal: (appealId: number, outcome: "upheld" | "overturned") =>
      after(call(`/api/admin/appeals/${appealId}/decide`, post({ outcome }))),
  };
}
