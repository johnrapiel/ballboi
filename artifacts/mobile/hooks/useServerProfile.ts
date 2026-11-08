// Whether this server has a profile row for the signed-in person
// (GET /api/users/me: 200 yes, 404 no).
//
// Onboarding is marked done in Clerk, but the profile lives on the API. Clerk
// is shared between local, staging and production, so an account can say
// "onboarded" while the server it's talking to has no profile: then Discover,
// Profile and anything else that reads the profile fails with "Finish setting
// up your profile first." The gate sends that person through onboarding once,
// which creates the profile (John, Nov 7, found on TestFlight).

import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export const serverProfileKey = ["profile", "exists"] as const;

/** true or false once known; undefined while loading or when the check can't run. */
export function useServerProfile(enabled: boolean): boolean | undefined {
  const { getToken } = useAuth();
  const q = useQuery({
    queryKey: serverProfileKey,
    enabled,
    queryFn: async (): Promise<boolean> => {
      const res = await apiFetch("/api/users/me", getToken);
      if (res.status === 404) return false;
      if (!res.ok) throw new Error("Couldn't check your profile.");
      return true;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
  // A check that can't run doesn't send anyone back to onboarding.
  return q.isError ? undefined : q.data;
}
