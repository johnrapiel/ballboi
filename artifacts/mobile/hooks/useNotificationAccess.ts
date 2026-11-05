import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import type { NotificationAccess } from "@/lib/notificationAccess";
import { readNotificationAccess } from "@/lib/notifications";

/**
 * What iOS allows right now. Read again when the screen comes into focus and
 * when the app comes back from Settings, so the Home banner and the Profile
 * note go away as soon as notifications are back on. Null until read.
 */
export function useNotificationAccess(): NotificationAccess | null {
  const [access, setAccess] = useState<NotificationAccess | null>(null);
  const read = useCallback(() => {
    let live = true;
    void readNotificationAccess().then((a) => {
      if (live) setAccess(a);
    });
    return () => {
      live = false;
    };
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
