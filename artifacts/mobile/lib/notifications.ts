// Notifications on the phone (spec: Permissions are asked only when needed;
// decisions 11 and 73). Match day reminders are on by default, and reach a
// player once iOS allows them:
// 1. Once signed in and through onboarding, ask iOS for quiet (provisional)
//    notifications. iOS shows no prompt; reminders land in Notification
//    Center with Keep and Turn Off buttons.
// 2. After joining a league (and, from Discover, sending a match request),
//    show the reason screen once, then the iOS prompt for full alerts.
// 3. If the player turned notifications off, Home shows one line linking to
//    Settings. Ball Boi never asks again.
//
// The phone's push token goes to the API whenever iOS will deliver, so the
// day-before reminder can reach it.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import type { useRouter } from "expo-router";
import { Platform } from "react-native";

import { apiFetch, type TokenGetter } from "@/lib/api";
import { accessFrom, canDeliver, shouldShowReason, type NotificationAccess } from "@/lib/notificationAccess";

// A reminder that arrives while Ball Boi is open still shows as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type Router = ReturnType<typeof useRouter>;

const REASON_SHOWN_KEY = "ballboi.notifications.reasonShown";

export async function readNotificationAccess(): Promise<NotificationAccess> {
  if (Platform.OS === "web") return "off";
  try {
    return accessFrom(await Notifications.getPermissionsAsync());
  } catch {
    return "notAsked";
  }
}

/** Sends this phone's push token to Ball Boi. Quietly does nothing where push can't work (a simulator). */
async function sendPushToken(getToken: TokenGetter): Promise<void> {
  try {
    const { data } = await Notifications.getExpoPushTokenAsync();
    if (!data) return;
    await apiFetch("/api/notifications/expo-token", getToken, { method: "POST", body: JSON.stringify({ token: data }) });
  } catch {
    // Tried again next launch.
  }
}

/**
 * Step 1, on every launch once the player is in the app: quiet notifications
 * the first time (no prompt), then keep the push token current.
 */
export async function startQuietNotifications(getToken: TokenGetter): Promise<void> {
  if (Platform.OS !== "ios") return;
  let access = await readNotificationAccess();
  if (access === "notAsked") {
    try {
      access = accessFrom(
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true, allowProvisional: true },
        }),
      );
    } catch {
      return;
    }
  }
  if (canDeliver(access)) await sendPushToken(getToken);
}

/**
 * Step 2: after joining a league or sending a match request. Opens the reason
 * screen if it hasn't shown on this phone and iOS can still ask. Returns
 * whether it opened. Call it from the screen that confirms the join or request.
 */
export async function askForMatchReminders(router: Router): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  let shownBefore = false;
  try {
    shownBefore = (await AsyncStorage.getItem(REASON_SHOWN_KEY)) === "1";
  } catch {
    // Treated as not shown.
  }
  if (!shouldShowReason(await readNotificationAccess(), shownBefore)) return false;
  try {
    await AsyncStorage.setItem(REASON_SHOWN_KEY, "1");
  } catch {
    // Shown once per launch at worst.
  }
  router.push("/notifications");
  return true;
}

/** The reason screen's "Turn on reminders": the iOS prompt for full alerts. */
export async function requestFullNotifications(getToken: TokenGetter): Promise<NotificationAccess> {
  let access: NotificationAccess;
  try {
    access = accessFrom(
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }),
    );
  } catch {
    access = await readNotificationAccess();
  }
  if (canDeliver(access)) await sendPushToken(getToken);
  return access;
}

/** The Profile switch, saved to the account so it's the same on every phone. */
export async function saveMatchReminders(on: boolean, getToken: TokenGetter): Promise<void> {
  const res = await apiFetch("/api/users/me", getToken, { method: "PUT", body: JSON.stringify({ matchRemindersEnabled: on }) });
  if (!res.ok) throw new Error("Couldn't save. Try again.");
}
