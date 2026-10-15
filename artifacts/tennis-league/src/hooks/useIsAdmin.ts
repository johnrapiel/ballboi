import { useUser } from "@clerk/react";
import { ADMIN_EMAIL } from "@/lib/admin";

export function useIsAdmin(): boolean {
  const { user, isLoaded } = useUser();
  return isLoaded && user?.primaryEmailAddress?.emailAddress === ADMIN_EMAIL;
}
