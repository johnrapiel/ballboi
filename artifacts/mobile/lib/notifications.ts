// Notifications on the phone (spec: Roles and onboarding, Notifications;
// decisions 125 and 128).
// 1. Signed in and in the app: ask iOS for quiet (provisional) notifications.
//    iOS shows no prompt; they land in Notification Center with Keep and
//    Turn Off.
// 2. At the first of joining a league, a match being added in chat, posting or
//    joining an open match, or turning on open match alerts: the reason
//    screen, then the iOS prompt. Once per phone, never again.
// 3. Notifications off: one line on Home linking to iOS Settings. Ball Boi
//    never asks again.
// The push token goes to the API whenever iOS will deliver. Tapping a push
// opens the screen it's about (a message opens that chat).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { answerNotMe, sendOpponentNotice, unregisterExpoPushToken } from "@workspace/api-client-react";
import * as Notifications from "expo-notifications";
import { router, type Href } from "expo-router";
import { Platform } from "react-native";

import { apiFetch, type TokenGetter } from "@/lib/api";
import {
  accessFrom,
  canDeliver,
  routeForPushLink,
  shouldAskNow,
  type NotificationAccess,
  type PromptTrigger,
} from "@/lib/notificationAccess";

// A push that arrives while Ball Boi is open still shows as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const ASKED_KEY = "ballboi.notifications.asked";

export async function readNotificationAccess(): Promise<NotificationAccess> {
  // Ball Boi is iOS only; elsewhere (web previews) nothing asks and no Home line shows.
  if (Platform.OS !== "ios") return "notAsked";
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
    // Tried again next time the app opens.
  }
}

/**
 * Step 1, whenever the app opens signed in: quiet notifications the first
 * time (no prompt), then keep this phone's push token current.
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
 * Step 2, at one of the four triggers. Opens the reason screen the first time
 * on this phone, while iOS can still ask. Safe to call every time: after the
 * first, it does nothing. Never throws, so it can't break the action that
 * called it.
 */
export async function askForNotifications(trigger: PromptTrigger): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    const asked = (await AsyncStorage.getItem(ASKED_KEY)) === "1";
    if (!shouldAskNow(await readNotificationAccess(), asked)) return false;
    await AsyncStorage.setItem(ASKED_KEY, "1");
  } catch {
    return false;
  }
  // Let the screen that triggered it finish its own change first (a sheet
  // closing, a confirmation appearing), then open the reason screen over it.
  setTimeout(() => {
    try {
      router.push({ pathname: "/notifications", params: { trigger } });
    } catch {
      // Navigation wasn't ready; the next trigger won't ask, which is the rule.
    }
  }, 700);
  return true;
}

/** The reason screen's Continue: the iOS prompt for full notifications. */
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

/** Opens the screen a tapped push is about. */
export function openPushLink(response: Notifications.NotificationResponse | null | undefined): void {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const link = (response.notification.request.content.data as { link?: unknown } | null)?.link;
  const to = routeForPushLink(link);
  try {
    router.push(to as Href);
  } catch {
    // Navigation wasn't ready; the app opens where it was.
  }
}

/**
 * Signing out: this phone stops getting the account's pushes, so the next
 * person to sign in here never sees someone else's messages. Best effort,
 * and never holds up signing out (at most 3 seconds).
 */
export async function forgetThisPhone(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const work = (async () => {
      const { data } = await Notifications.getExpoPushTokenAsync();
      if (data) await unregisterExpoPushToken({ token: data });
    })();
    await Promise.race([work, new Promise((r) => setTimeout(r, 3000))]);
  } catch {
    // The token is reassigned when the next account signs in here.
  }
}

// ─── Opponent notice and "Was that you?" (decision 124) ─────────────────────

const toldOpponent = new Set<number>();

/**
 * The mounted phone started capturing: the other players hear about it (the
 * API decides who gets what, at most once). Once per match per app session
 * here too. Never throws and never holds up recording; with no connection,
 * the opponent just isn't told.
 */
export function tellOpponent(matchId: number): void {
  if (!Number.isInteger(matchId) || matchId <= 0 || toldOpponent.has(matchId)) return;
  toldOpponent.add(matchId);
  sendOpponentNotice(matchId).catch(() => {
    toldOpponent.delete(matchId);
  });
}

/** "Was that you?" answered Not me. */
export async function sayNotMe(code: string): Promise<void> {
  await answerNotMe(code);
}
