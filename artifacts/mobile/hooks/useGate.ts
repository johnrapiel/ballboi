// Where the signed-in person may be right now (lib/gate.ts). Shared by the
// root layout, which moves people, and the layouts under it, which render
// nothing until the person may see them.

import { useAuth, useUser } from "@clerk/expo";

import { useAccountStatus } from "@/hooks/useAccountStatus";
import { useServerProfile } from "@/hooks/useServerProfile";
import { isAgeCheckPassed } from "@/lib/ageCheck";
import { gateFor, type Gate } from "@/lib/gate";
import { isOnboarded } from "@/lib/onboarding";

export function useGate(): Gate {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const account = useAccountStatus(!!isSignedIn);
  const onboardedInClerk = isOnboarded(user?.unsafeMetadata);
  // Only asked once Clerk says onboarded: before that, onboarding runs anyway.
  const hasProfile = useServerProfile(!!isSignedIn && onboardedInClerk);
  // A check that can't run doesn't lock anyone out: the server still enforces.
  const status = account.data
    ? account.data.status === "ok"
      ? "ok"
      : "blocked"
    : account.isError
      ? "ok"
      : "pending";
  return gateFor({
    signedIn: !!isSignedIn,
    hasUser: !!user,
    account: status,
    aged: isAgeCheckPassed(user?.unsafeMetadata),
    // Done in Clerk, unless this server has no profile for them (false).
    // Unknown (loading or the check failed) doesn't hold anyone back.
    onboarded: onboardedInClerk && hasProfile !== false,
  });
}
