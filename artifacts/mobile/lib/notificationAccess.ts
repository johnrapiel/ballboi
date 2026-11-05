// What iOS lets Ball Boi do with notifications, and what the app does about it
// (spec: Permissions are asked only when needed, decisions 11 and 73). Pure, so
// it's tested in Node; lib/notifications.ts reads the real permission.
//
// - notAsked: nothing asked yet. Sign-in asks for quiet (provisional)
//   notifications, which shows no prompt.
// - quiet: iOS delivers to Notification Center only, with Keep and Turn Off.
// - full: alerts, sounds and the Lock Screen.
// - off: the player turned notifications off. Home shows one line linking to
//   Settings, and Ball Boi never asks again.

export type NotificationAccess = "notAsked" | "quiet" | "full" | "off";

/** iOS UNAuthorizationStatus, as expo-notifications reports it. */
export const IOS_STATUS = { notDetermined: 0, denied: 1, authorized: 2, provisional: 3, ephemeral: 4 } as const;

export interface PermissionLike {
  granted: boolean;
  status: string;
  ios?: { status: number } | null;
}

export function accessFrom(p: PermissionLike): NotificationAccess {
  const ios = p.ios?.status;
  if (ios != null) {
    if (ios === IOS_STATUS.authorized || ios === IOS_STATUS.ephemeral) return "full";
    if (ios === IOS_STATUS.provisional) return "quiet";
    if (ios === IOS_STATUS.denied) return "off";
    return "notAsked";
  }
  if (p.granted) return "full";
  return p.status === "denied" ? "off" : "notAsked";
}

/** iOS will deliver something, so the phone's push token is worth sending. */
export const canDeliver = (a: NotificationAccess) => a === "full" || a === "quiet";

/**
 * After joining a league or sending a match request: show the reason screen
 * before the iOS prompt, once per phone. Never when the player already said
 * yes in full or turned notifications off (iOS won't ask again then).
 */
export function shouldShowReason(access: NotificationAccess, reasonShownBefore: boolean): boolean {
  return !reasonShownBefore && (access === "notAsked" || access === "quiet");
}

/** The one-line Home banner, only once the player has turned notifications off. */
export const showOffBanner = (a: NotificationAccess) => a === "off";
