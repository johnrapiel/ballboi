import { useAuth } from "@clerk/expo";
import * as Notifications from "expo-notifications";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { startLiveActivityTokens } from "@/lib/liveActivity/native";
import type { NotificationAccess } from "@/lib/notificationAccess";
import { openPushLink, readNotificationAccess, startQuietNotifications } from "@/lib/notifications";

/**
 * What iOS allows right now. Read again when the screen comes into focus and
 * when the app comes back from iOS Settings, so the Home line goes away as
 * soon as notifications are back on. Null until read.
 */
export function useNotificationAccess(): NotificationAccess | null {
  const [access, setAccess] = useState<NotificationAccess | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const read = useCallback(() => {
    void readNotificationAccess().then((a) => {
      if (mounted.current) setAccess(a);
    });
  }, []);
  useFocusEffect(read);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") read();
    });
    return () => sub.remove();
  }, [read]);
  return access;
}

/**
 * Once the player is in the app (tab layout): quiet notifications and the
 * push token (step 1 in lib/notifications.ts), again whenever the app comes
 * back to the front, the Live Activity tokens, and taps on pushes open the screen they're about,
 * including the one that launched the app.
 */
export function usePushSetup(ready: boolean) {
  const { getToken, userId } = useAuth();
  const tokenGetter = useRef(getToken);
  tokenGetter.current = getToken;
  const last = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!ready || !userId) return;
    const start = () => void startQuietNotifications(() => tokenGetter.current());
    start();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") start();
    });
    return () => sub.remove();
  }, [ready, userId]);

  // Live Activity tokens (Session G): push-to-start, so the opponent's
  // phone can show the match, and any running Live Activity's update token.
  useEffect(() => {
    if (!ready || !userId) return;
    return startLiveActivityTokens(() => tokenGetter.current());
  }, [ready, userId]);

  useEffect(() => {
    if (!ready || !last) return;
    const id = last.notification.request.identifier;
    if (openedPushes.has(id)) return;
    openedPushes.add(id);
    openPushLink(last);
  }, [ready, last]);
}

/** Pushes already opened, so a tab layout remount never opens one twice. */
const openedPushes = new Set<string>();
