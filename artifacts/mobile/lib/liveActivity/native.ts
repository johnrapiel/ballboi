// The Live Activity on this phone (Wave 2, Session G). Wraps expo-widgets so
// the rest of the app never touches it directly, and fails safe: in Expo Go,
// on a simulator without Live Activities, or with them switched off in iOS
// Settings, every call quietly does nothing and recording carries on.
//
// - The mounted phone starts its own Live Activity and updates it as setup
//   and the match go (lib/liveActivity/useRecorderLiveActivity.ts).
// - Every phone sends Ball Boi its push-to-start token when the app opens, so
//   the server can open the Live Activity on the opponent's phone (G7), and
//   each running Live Activity's update token, so the server can keep it
//   current.

import { Platform } from "react-native";

import { apiFetch, type TokenGetter } from "@/lib/api";
import type { LiveProps } from "@/lib/liveActivity/props";

type Factory = import("expo-widgets").LiveActivityFactory<LiveProps>;
type Instance = import("expo-widgets").LiveActivity<LiveProps>;
type Widgets = typeof import("expo-widgets");

let factory: Factory | null | undefined;
let widgets: Widgets | null | undefined;

function load(): { factory: Factory; widgets: Widgets } | null {
  if (Platform.OS !== "ios") return null;
  if (factory === undefined) {
    try {
      // The layout registers itself with iOS when it loads, which is also what
      // lets a Live Activity started by Ball Boi's server draw on this phone.
      factory = (require("@/widgets/MatchActivity") as { default: Factory }).default;
      widgets = require("expo-widgets") as Widgets;
    } catch {
      factory = null;
      widgets = null;
    }
  }
  return factory && widgets ? { factory, widgets } : null;
}

let current: Instance | null = null;
let currentMatch: number | null = null;

/** Starts or updates this phone's Live Activity for the match. Never throws. */
export async function showLiveActivity(props: LiveProps, getToken: TokenGetter): Promise<void> {
  const w = load();
  if (!w) return;
  try {
    if (current && currentMatch === props.matchId) {
      await current.update(props);
      return;
    }
    if (current) await endLiveActivity(null);
    current = w.factory.start(props, props.openUrl);
    currentMatch = props.matchId;
    const instance = current;
    const send = (token: string | null) => {
      if (token) void sendActivityToken(token, instance.getId(), props.matchId, getToken);
    };
    instance.addPushTokenListener((e) => send(e.pushToken));
    instance.getPushToken().then(send, () => undefined);
  } catch {
    // Live Activities off in Settings, or too many running: recording carries on.
    current = null;
    currentMatch = null;
  }
}

/** Ends this phone's Live Activity, leaving the final words up for a few minutes. Never throws. */
export async function endLiveActivity(final: LiveProps | null): Promise<void> {
  const instance = current;
  current = null;
  currentMatch = null;
  if (!instance) return;
  try {
    const w = load();
    const dismissAt = new Date(Date.now() + 5 * 60_000);
    await instance.end(w ? w.widgets.after(dismissAt) : "default", final ?? undefined);
  } catch {
    // Already gone.
  }
}

async function sendActivityToken(token: string, activityId: string, matchId: number | null, getToken: TokenGetter) {
  try {
    await apiFetch("/api/live-activity/activity-token", getToken, {
      method: "POST",
      body: JSON.stringify({ token, activityId, matchId }),
    });
  } catch {
    // Sent again when the token changes or the app opens.
  }
}

let started = false;

/**
 * When the app opens signed in: sends this phone's push-to-start token, and
 * the update token of any Live Activity Ball Boi's server opened here, so the
 * server can keep it current. Safe to call more than once.
 */
export function startLiveActivityTokens(getToken: TokenGetter): () => void {
  const w = load();
  if (!w || started) return () => undefined;
  started = true;
  const subs: { remove(): void }[] = [];
  try {
    subs.push(
      w.widgets.addPushToStartTokenListener((e) => {
        void apiFetch("/api/live-activity/start-token", getToken, {
          method: "PUT",
          body: JSON.stringify({ token: e.activityPushToStartToken }),
        }).catch(() => undefined);
      }),
    );
    for (const instance of w.factory.getInstances()) {
      const send = (token: string | null) => {
        if (token) void sendActivityToken(token, instance.getId(), null, getToken);
      };
      subs.push(instance.addPushTokenListener((e) => send(e.pushToken)));
      instance.getPushToken().then(send, () => undefined);
    }
  } catch {
    // Live Activities aren't available on this phone.
  }
  return () => {
    started = false;
    subs.forEach((s) => s.remove());
  };
}
