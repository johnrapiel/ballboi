// Whether this account is banned or suspended. Checked right after sign-in
// (spec: Enforcement ladder, "Ban sticks"). The server also refuses every other
// request from a sanctioned account, so this only decides what screen to show.

import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage, apiFetch } from "@/lib/api";

export interface AccountStatus {
  status: "ok" | "banned" | "suspended";
  endsAt: string | null;
  appeal: { submittedAt: string; outcome: "upheld" | "overturned" | null } | null;
  canAppeal: boolean;
  supportEmail: string;
  appealReference: string | null;
}

export const accountStatusKey = ["account", "status"] as const;

export function useAccountStatus(enabled = true) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: accountStatusKey,
    enabled,
    queryFn: async (): Promise<AccountStatus> => {
      const res = await apiFetch("/api/account/status", getToken);
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Couldn't check your account."));
      return (await res.json()) as AccountStatus;
    },
    // Recheck when the app comes back, so a lifted ban or an ended suspension clears.
    staleTime: 60_000,
    // If the check can't run, don't lock anyone out: the server still enforces.
    retry: 1,
  });
}

/** The one appeal. Returns the reference to put in the email subject. */
export function useSendAppeal() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return async (): Promise<{ reference: string; supportEmail: string }> => {
    const res = await apiFetch("/api/account/appeal", getToken, { method: "POST" });
    if (!res.ok) throw new Error(await apiErrorMessage(res, "We couldn't log your appeal. Try again."));
    const body = (await res.json()) as { reference: string; supportEmail: string };
    await qc.invalidateQueries({ queryKey: accountStatusKey });
    return body;
  };
}
