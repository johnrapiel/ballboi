// The mounted phone's side of the Live Activity (Wave 2, Session G).
//
// From the moment setup starts until the match is saved:
// - its own Live Activity shows the stage, court, battery and the coach's
//   latest caption (captions never show on the mounted screen, G11);
// - Ball Boi's server gets the same, opens the Live Activity on the other
//   player's phone (G7) and keeps it current;
// - every few seconds it asks the server for a Start or Stop sent from the
//   other phone or a Lock Screen, and hands it to the record screen.
// Once the match stops, the Live Activity ends on both phones and stays on
// the Lock Screen for a few minutes with "Recording stopped".

import { useAuth } from "@clerk/expo";
import * as Battery from "expo-battery";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { apiFetch } from "@/lib/api";
import { endLiveActivity, showLiveActivity } from "@/lib/liveActivity/native";
import { buildLiveProps, leftWithoutRecording, sameLive, type LiveCommand, type LiveProps, type RecorderSnapshot } from "@/lib/liveActivity/props";

/** How often the mounted phone checks for Start or Stop from another phone. */
export const HEARTBEAT_MS = 3_000;
/** Battery is read this often (the Live Activity shows it in steps of 5%). */
const BATTERY_MS = 60_000;

export function useRecorderLiveActivity(snapshot: Omit<RecorderSnapshot, "batteryLevel"> | null, onCommand: (c: LiveCommand) => void) {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const [battery, setBattery] = useState<number | null>(null);
  const sent = useRef<LiveProps | null>(null);
  const latest = useRef<LiveProps | null>(null);
  const ended = useRef(false);
  const tokenGetter = () => getTokenRef.current();

  useEffect(() => {
    let alive = true;
    const read = () =>
      Battery.getBatteryLevelAsync().then(
        (l) => alive && setBattery(l >= 0 ? l : null),
        () => undefined,
      );
    void read();
    const t = setInterval(read, BATTERY_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const props = snapshot ? buildLiveProps({ ...snapshot, batteryLevel: battery }) : null;
  latest.current = props;

  async function sendToServer(p: LiveProps) {
    try {
      const res = await apiFetch(`/api/live/${p.matchId}`, tokenGetter, { method: "PUT", body: JSON.stringify(p) });
      if (!res.ok) return;
      const body = (await res.json()) as { command?: LiveCommand | null };
      if (body.command === "start" || body.command === "stop") onCommandRef.current(body.command);
    } catch {
      // Offline for a moment: the next heartbeat tries again.
    }
  }

  // A change: this phone's Live Activity and the server, straight away.
  useEffect(() => {
    if (!props || ended.current) return;
    if (props.stage === "stopped") {
      ended.current = true;
      void endLiveActivity(props);
      void apiFetch(`/api/live/${props.matchId}`, tokenGetter, { method: "DELETE", body: JSON.stringify(props) }).catch(() => undefined);
      return;
    }
    if (sameLive(sent.current, props)) return;
    sent.current = props;
    void showLiveActivity(props, tokenGetter);
    void sendToServer(props);
    // Runs on what the Live Activity shows, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props && JSON.stringify(props)]);

  // The heartbeat: picks up Start or Stop from another phone.
  useEffect(() => {
    const t = setInterval(() => {
      const p = latest.current;
      if (!p || ended.current || AppState.currentState !== "active") return;
      void sendToServer(p);
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the screen without a recording: it ends on both phones.
  useEffect(
    () => () => {
      const p = latest.current;
      if (!p || ended.current) return;
      ended.current = true;
      const final = leftWithoutRecording(p);
      void endLiveActivity(final);
      void apiFetch(`/api/live/${p.matchId}`, tokenGetter, { method: "DELETE", body: JSON.stringify(final) }).catch(() => undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
