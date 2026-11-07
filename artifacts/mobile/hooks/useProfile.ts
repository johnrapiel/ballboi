import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useStableGetToken } from "@/hooks/useStableGetToken";
import { fetchProfile, type Profile } from "@/lib/onboarding";

/**
 * The signed-in player's saved profile, loaded when the screen comes into
 * focus, so the Edit profile list shows new values after a Save and Back.
 */
export function useProfile() {
  const getToken = useStableGetToken();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setError(null);
    fetchProfile(getToken)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        if (!p) setError("We couldn't find your profile.");
      })
      .catch(() => {
        // Our own words, never the server's: the cause is almost always signal.
        if (!cancelled) setError("We couldn't load your profile. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  useFocusEffect(reload);

  return { profile, loading, error, reload };
}
