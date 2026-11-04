// Where the signed-in person may be right now (lib/gate.ts). Shared by the
// root layout, which moves people, and the layouts under it, which render
// nothing until the person may see them.

import { useAuth, useUser } from "@clerk/expo";

import { useAccountStatus } from "@/hooks/useAccountStatus";
import { isAgeCheckPassed } from "@/lib/ageCheck";
import { gateFor, type Gate } from "@/lib/gate";
import { isOnboarded } from "@/lib/onboarding";

export function useGate(): Gate {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const account = useAccountStatus(!!isSignedIn);
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
    onboarded: isOnboarded(user?.unsafeMetadata),
  });
}
