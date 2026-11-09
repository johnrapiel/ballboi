// "Discard changes?" before leaving an editor with unsaved changes. One hook
// for every screen and sheet, so Discard always leaves on the first tap.

import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

import { guardOn, nextPhase, type DiscardCopy, type DiscardPhase } from "@/lib/discardGuard";

/**
 * While `dirty`, back, swipe back and drag down ask first. Keep editing stays.
 * Discard turns the guard off, then finishes the leave that was asked for.
 * `finish()` leaves without asking, for after a save; `finish(go)` runs `go`
 * instead of going back (to open the next screen in this one's place).
 */
export function useDiscardGuard(dirty: boolean, copy: DiscardCopy) {
  const router = useRouter();
  const navigation = useNavigation();
  const [phase, setPhase] = useState<DiscardPhase>("editing");
  const pending = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const next = useRef<(() => void) | null>(null);

  usePreventRemove(guardOn(dirty, phase), ({ data }) => {
    Alert.alert(copy.title, copy.message, [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          pending.current = data.action;
          setPhase((p) => nextPhase(p, "discard"));
        },
      },
    ]);
  });

  // The guard is off now (this runs after the render that turned it off), so
  // the saved leave goes through.
  useEffect(() => {
    if (phase !== "discarding" || !pending.current) return;
    const action = pending.current;
    pending.current = null;
    navigation.dispatch(action);
  }, [phase, navigation]);

  useEffect(() => {
    if (phase !== "finished") return;
    if (next.current) next.current();
    else if (router.canGoBack()) router.back();
  }, [phase, router]);

  /** Leave, asking first if something changed. */
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);
  /** Leave without asking, after a save. */
  const finish = useCallback((then?: () => void) => {
    next.current = then ?? null;
    setPhase((p) => nextPhase(p, "finish"));
  }, []);
  return { close, finish };
}
