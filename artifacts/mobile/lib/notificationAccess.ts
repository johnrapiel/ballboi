// What iOS lets Ball Boi do with notifications, and when Ball Boi asks
// (spec: Roles and onboarding, Notifications; decision 125). Pure, so it's
// tested in Node; lib/notifications.ts reads the real permission.
//
// - notAsked: nothing asked yet. Once signed in, Ball Boi asks for quiet
//   (provisional) notifications, which shows no prompt.
// - quiet: iOS delivers to Notification Center only, with Keep and Turn Off.
// - full: alerts, sounds and the Lock Screen.
// - off: the player said no, or turned notifications off. Home shows one line
//   linking to iOS Settings, and Ball Boi never asks again.

export type NotificationAccess = "notAsked" | "quiet" | "full" | "off";

/**
 * The four moments that show the reason screen and then the iOS prompt, once,
 * at whichever comes first (decision 125).
 */
export type PromptTrigger = "joinedLeague" | "matchInChat" | "openMatch" | "matchAlerts";

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
 * At one of the four triggers: show the reason screen, then the iOS prompt,
 * only the first time on this phone, and only while iOS can still ask (it
 * can't once the player said yes in full or said no).
 */
export function shouldAskNow(access: NotificationAccess, askedBefore: boolean): boolean {
  return !askedBefore && (access === "notAsked" || access === "quiet");
}

/** The one Home line, only when notifications are off. */
export const showOffLine = (a: NotificationAccess | null) => a === "off";

/**
 * Where tapping a push goes. The API sends web-style links; only the ones the
 * app has a screen for are opened, anything else opens Home.
 */
export function routeForPushLink(link: unknown): string {
  if (typeof link !== "string") return "/";
  const path = link.split(/[?#]/)[0] ?? "";
  const id = (re: RegExp) => path.match(re)?.[1];
  // A group chat (F15): an open match's chat in Messages.
  const group = id(/^\/conversation\/group\/(\d+)$/);
  if (group) return `/conversation/group/${group}`;
  const conversation = id(/^\/conversation\/(\d+)$/) ?? id(/^\/messages\/(\d+)$/);
  if (conversation) return `/conversation/${conversation}`;
  const match = id(/^\/matches\/(\d+)$/) ?? id(/^\/match\/(\d+)$/);
  if (match) return `/match/${match}`;
  const league = id(/^\/leagues?\/(\d+)$/);
  if (league) return `/league/${league}`;
  // "Was that you?" (decision 124) opens the match invite screen.
  const invite = path.match(/^\/record\/invite\/([A-Za-z0-9]{4,16})$/)?.[1];
  if (invite) return `/record/invite/${invite.toUpperCase()}`;
  if (path === "/messages") return "/messages";
  if (path === "/matches") return "/matches";
  if (path === "/discover") return "/discover";
  if (path === "/leagues") return "/leagues";
  return "/";
}
