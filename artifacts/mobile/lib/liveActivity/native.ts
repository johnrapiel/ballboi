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
// - One Live Activity per match per phone (John, Nov 9): the mounted phone
//   updates its one in place and, when setup starts, ends any Ball Boi Live
//   Activity left from earlier. A phone that ends up with more than one (the
//   server opened one while an old one was still up) keeps one.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";

import { apiFetch, type TokenGetter } from "@/lib/api";
import { extraActivities } from "@/lib/liveActivity/dedupe";
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
/** One Live Activity call at a time, so two quick updates never start two. */
let chain: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.catch(() => undefined);
  return run;
}

async function endInstance(instance: Instance, final: LiveProps | null, immediately: boolean) {
  try {
    const w = load();
    const dismissAt = new Date(Date.now() + 5 * 60_000);
    await instance.end(immediately ? "immediate" : w ? w.widgets.after(dismissAt) : "default", final ?? undefined);
  } catch {
    // Already gone.
  }
}

/** Starts or updates this phone's Live Activity for the match, in place. Never throws. */
export function showLiveActivity(props: LiveProps, getToken: TokenGetter): Promise<void> {
  return serial(async () => {
    const w = load();
    if (!w) return;
    if (current && currentMatch === props.matchId) {
      try {
        await current.update(props);
        return;
      } catch {
        // Swiped away or ended by iOS: a new one starts below.
        current = null;
        currentMatch = null;
      }
    }
    try {
      // A new setup: anything Ball Boi left on this phone from earlier goes.
      for (const old of w.factory.getInstances()) await endInstance(old, null, true);
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
  });
}

/**
 * Ends this phone's Live Activity. It stays on the Lock Screen for a few
 * minutes with the final words, or goes straight away when setup ended with
 * nothing recorded. Never throws.
 */
export function endLiveActivity(final: LiveProps | null): Promise<void> {
  return serial(async () => {
    const instance = current;
    current = null;
    currentMatch = null;
    if (!instance) return;
    await endInstance(instance, final, final?.status === "Setup ended");
  });
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

const INSTALL_KEY = "ballboi.liveActivity.installId";
let installId: Promise<string | null> | null = null;

/** This app install's id, so Ball Boi keeps one push-to-start token per phone. */
function getInstallId(): Promise<string | null> {
  installId ??= (async () => {
    try {
      const saved = await AsyncStorage.getItem(INSTALL_KEY);
      if (saved) return saved;
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
      await AsyncStorage.setItem(INSTALL_KEY, id);
      return id;
    } catch {
      return null;
    }
  })();
  return installId;
}

let started = false;

/**
 * When the app opens signed in: sends this phone's push-to-start token, and
 * the update token of any Live Activity Ball Boi's server opened here, so the
 * server can update it in place. Looks again each time the app comes back,
 * since the server may have opened one while it was away, and keeps only one
 * if there's more than one. Safe to call more than once.
 */
export function startLiveActivityTokens(getToken: TokenGetter): () => void {
  const w = load();
  if (!w || started) return () => undefined;
  started = true;
  const subs: { remove(): void }[] = [];
  const watched = new Set<string>();

  const scan = () =>
    serial(async () => {
      try {
        const instances = w.factory.getInstances();
        const ids = instances.map((i) => i.getId());
        const extra = new Set(extraActivities(ids, current ? current.getId() : null));
        for (const instance of instances) {
          const id = instance.getId();
          if (extra.has(id)) {
            await endInstance(instance, null, true);
            continue;
          }
          if (watched.has(id)) continue;
          watched.add(id);
          const send = (token: string | null) => {
            if (token) void sendActivityToken(token, id, null, getToken);
          };
          subs.push(instance.addPushTokenListener((e) => send(e.pushToken)));
          instance.getPushToken().then(send, () => undefined);
        }
      } catch {
        // Live Activities aren't available on this phone.
      }
    });

  try {
    subs.push(
      w.widgets.addPushToStartTokenListener((e) => {
        void getInstallId().then((id) =>
          apiFetch("/api/live-activity/start-token", getToken, {
            method: "PUT",
            body: JSON.stringify({ token: e.activityPushToStartToken, installId: id }),
          }).catch(() => undefined),
        );
      }),
    );
  } catch {
    // Live Activities aren't available on this phone.
  }
  void scan();
  const appState = AppState.addEventListener("change", (s) => {
    if (s === "active") void scan();
  });
  return () => {
    started = false;
    appState.remove();
    subs.forEach((s) => s.remove());
  };
}
