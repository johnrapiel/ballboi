// Ball Boi recorder (spec: Ball Boi > Recording).
//
// Rear camera only, phone mounted on the fence, screen facing away from the
// court. Nobody touches the fence after mounting: start now or after a
// spoken countdown, stop by holding anywhere for 2 seconds, and the safety
// cap stops and saves on low battery, low storage, or at 4 hours.
// The video is analysis input only: it is never played back.

import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChromeButton, ChromeChoice } from "@/components/record/ChromeControls";
import { HoldToStop } from "@/components/record/HoldToStop";
import { Button, Screen, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { chrome } from "@/lib/recording/chrome";
import { countdownClock, cueAt, START_DELAYS, type StartDelayMinutes } from "@/lib/recording/countdown";
import { keepRecording } from "@/lib/recording/files";
import { enqueue } from "@/lib/recording/queue";
import { formatElapsed, spokenDuration } from "@/lib/recording/format";
import {
  hasRoomToStart,
  MAX_RECORDING_SECONDS,
  STOP_MESSAGES,
  useSafetyCap,
  type StopReason,
} from "@/lib/recording/safety";
import { drainQueue } from "@/lib/recording/uploader";
import { prepareVoice, say, stopVoice } from "@/lib/recording/voice";

type Phase = "ready" | "countdown" | "recording" | "saving" | "saved" | "error";

export default function RecordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ matchId: string; opponent?: string }>();
  const matchId = Number(params.matchId);
  const opponent = params.opponent ?? "your opponent";

  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [delay, setDelay] = useState<StartDelayMinutes>(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [caption, setCaption] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState<StopReason>("user");
  const startedAt = useRef(0);
  const startAt = useRef(0);
  const reasonRef = useRef<StopReason>("user");

  // The mounted phone must never auto-lock: iOS stops the camera when it does.
  useKeepAwake();

  useEffect(() => {
    prepareVoice();
    return () => stopVoice();
  }, []);

  // Recording clock.
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Countdown: a cue at each whole minute, 30 s, 10 s, then 5 to 1, each spoken and captioned.
  useEffect(() => {
    if (phase !== "countdown") return;
    const total = delay * 60;
    let last = -1;
    const tick = () => {
      const left = Math.max(0, Math.ceil((startAt.current - Date.now()) / 1000));
      if (left === last) return;
      last = left;
      setSecondsLeft(left);
      const cue = cueAt(left, total);
      if (cue) {
        setCaption(cue);
        say(cue);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      if (left === 0) beginRecording();
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
    // beginRecording reads refs only; the countdown restarts only on a new phase or delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, delay]);

  useSafetyCap(phase === "recording", (reason) => stop(reason));

  if (!camPerm) {
    return <View style={{ flex: 1, backgroundColor: chrome.ground }} />;
  }

  if (!camPerm.granted) {
    return (
      <Screen style={{ justifyContent: "center", gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          Camera access
        </Text>
        <Text tone="inkMuted">
          Ball Boi films your match with the back camera to track your shots. The microphone listens for the ball being
          hit. Video is never played back, and audio is deleted after analysis.
        </Text>
        {camPerm.canAskAgain ? (
          <Button
            label="Allow camera"
            onPress={async () => {
              const cam = await requestCam();
              if (cam.granted && !micPerm?.granted) await requestMic();
            }}
          />
        ) : (
          <Button label="Open Settings" onPress={() => Linking.openSettings()} />
        )}
        <Button variant="secondary" label="Not now" onPress={() => router.back()} />
      </Screen>
    );
  }

  function pressStart() {
    if (!cameraReady) return;
    if (!hasRoomToStart()) {
      Alert.alert("Not enough space", "Free up at least 3 GB on your phone to record a match.");
      return;
    }
    setError(null);
    if (delay === 0) {
      beginRecording();
      return;
    }
    startAt.current = Date.now() + delay * 60 * 1000;
    setPhase("countdown");
  }

  function cancelCountdown() {
    stopVoice();
    setCaption(null);
    setPhase("ready");
    AccessibilityInfo.announceForAccessibility("Countdown cancelled");
  }

  async function beginRecording() {
    if (!camera.current) return;
    reasonRef.current = "user";
    startedAt.current = Date.now();
    setElapsed(0);
    setCaption(null);
    setPhase("recording");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    AccessibilityInfo.announceForAccessibility("Recording started");
    try {
      const video = await camera.current.recordAsync({ maxDuration: MAX_RECORDING_SECONDS });
      if (!video?.uri) throw new Error("No video was saved.");
      // Reaching maxDuration ends the recording without a stop call.
      if (reasonRef.current === "user" && Date.now() - startedAt.current >= (MAX_RECORDING_SECONDS - 5) * 1000) {
        reasonRef.current = "time";
      }
      await finish(video.uri, reasonRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed.");
      setPhase("error");
    }
  }

  function stop(reason: StopReason = "user") {
    reasonRef.current = reason;
    Haptics.notificationAsync(
      reason === "user" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {});
    const message = reason === "user" ? "Recording stopped" : STOP_MESSAGES[reason];
    say(message);
    AccessibilityInfo.announceForAccessibility(message);
    camera.current?.stopRecording();
  }

  function confirmStop() {
    Alert.alert("Stop recording?", "Your match so far is saved.", [
      { text: "Keep recording", style: "cancel" },
      { text: "Stop", style: "destructive", onPress: () => stop("user") },
    ]);
  }

  async function finish(cacheUri: string, reason: StopReason) {
    setStopReason(reason);
    setPhase("saving");
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    const id = `match-${matchId}-${Date.now()}`;
    const saved = await keepRecording(cacheUri, id);
    // Into the upload queue: Wi-Fi by default, kept on the phone until the server confirms.
    await enqueue({
      id,
      matchId,
      opponentName: opponent,
      uri: saved.uri,
      sizeBytes: saved.sizeBytes,
      durationSeconds,
      recordedAt: new Date().toISOString(),
    });
    drainQueue();
    setPhase("saved");
    AccessibilityInfo.announceForAccessibility("Match saved. It uploads on Wi-Fi.");
  }

  const recording = phase === "recording";
  const counting = phase === "countdown";
  const status = recording
    ? `Recording, ${spokenDuration(elapsed)}`
    : counting
      ? `Recording starts in ${spokenDuration(secondsLeft)}`
      : `Match vs ${opponent}`;
  const pillText = recording ? formatElapsed(elapsed) : counting ? `Starts in ${countdownClock(secondsLeft)}` : `vs ${opponent}`;

  return (
    <View style={{ flex: 1, backgroundColor: chrome.ground }}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="video"
        videoQuality="1080p"
        mute={!micPerm?.granted}
        // The app is portrait-only, but a fence-mounted phone is usually
        // sideways. Record in whichever way the phone is actually held.
        responsiveOrientationWhenOrientationLocked
        onCameraReady={() => setCameraReady(true)}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />

      {recording ? <HoldToStop onStop={() => stop("user")} bottomInset={insets.bottom} /> : null}

      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: insets.top + spacing.space2,
          left: spacing.space4,
          right: spacing.space4,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.space3,
        }}
      >
        {recording || counting ? (
          <View style={{ width: MIN_TAP }} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => router.back()}
            hitSlop={4}
            style={({ pressed }) => [styles.round, { opacity: pressed ? 0.7 : 1 }]}
          >
            <SymbolView name="xmark" size={18} tintColor={chrome.text} />
          </Pressable>
        )}
        <View accessible accessibilityRole="text" accessibilityLabel={status} style={[styles.pill, { flexShrink: 1 }]}>
          {recording ? <SymbolView name="record.circle" size={14} tintColor={chrome.danger} /> : null}
          <Text variant="bodyStrong" numberOfLines={1} style={{ color: chrome.text }}>
            {pillText}
          </Text>
        </View>
        <View style={{ width: MIN_TAP }} />
      </View>

      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          bottom: insets.bottom + spacing.space6,
          left: spacing.space4,
          right: spacing.space4,
          alignItems: "center",
          gap: spacing.space4,
        }}
      >
        {phase === "ready" ? (
          <>
            <View style={[styles.panel, { backgroundColor: chrome.scrim, alignSelf: "stretch", gap: spacing.space4 }]}>
              <Text style={{ color: chrome.text, textAlign: "center" }}>
                Mount your phone on the fence behind the baseline, turned sideways, with the whole court in view.
              </Text>
              <ChromeChoice
                label="Start in"
                options={START_DELAYS.map((d) => ({ value: d.minutes, label: d.label }))}
                value={delay}
                onChange={setDelay}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={delay === 0 ? "Record" : `Start ${delay} minute countdown`}
              accessibilityState={{ disabled: !cameraReady }}
              disabled={!cameraReady}
              onPress={pressStart}
              style={({ pressed }) => [styles.shutter, { opacity: !cameraReady ? 0.5 : pressed ? 0.8 : 1 }]}
            >
              <View style={styles.shutterRecord} />
            </Pressable>
          </>
        ) : null}

        {counting ? (
          <View style={[styles.panel, { backgroundColor: chrome.scrim, alignSelf: "stretch", alignItems: "center" }]}>
            <Text
              variant="score"
              style={{ color: chrome.text }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {countdownClock(secondsLeft)}
            </Text>
            {caption ? (
              <Text
                variant="bodyStrong"
                style={{ color: chrome.text, textAlign: "center" }}
                accessibilityLiveRegion="polite"
              >
                {caption}
              </Text>
            ) : null}
            <ChromeButton variant="secondary" label="Cancel" accessibilityLabel="Cancel countdown" onPress={cancelCountdown} />
          </View>
        ) : null}

        {recording ? (
          <View style={{ alignItems: "center", gap: spacing.space3 }} pointerEvents="box-none">
            <View style={[styles.pill]} pointerEvents="none">
              <Text variant="small" style={{ color: chrome.text }}>
                Press and hold anywhere for 2 seconds to stop
              </Text>
            </View>
            <ChromeButton variant="secondary" label="Stop" accessibilityLabel="Stop recording" onPress={confirmStop} />
          </View>
        ) : null}

        {phase === "saving" || phase === "saved" || phase === "error" ? (
          <View style={[styles.panel, { backgroundColor: chrome.panel, alignSelf: "stretch" }]}>
            {stopReason !== "user" && phase !== "error" ? (
              <View style={{ flexDirection: "row", gap: spacing.space2, alignItems: "center" }} accessible>
                <SymbolView name="exclamationmark.triangle" size={16} tintColor={chrome.text} />
                <Text variant="bodyStrong" style={{ color: chrome.text, flex: 1 }}>
                  {STOP_MESSAGES[stopReason]}
                </Text>
              </View>
            ) : null}
            {phase === "saving" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }} accessible>
                <ActivityIndicator color={chrome.text} />
                <Text variant="bodyStrong" style={{ color: chrome.text }} accessibilityLiveRegion="polite">
                  Saving your match
                </Text>
              </View>
            ) : null}
            {phase === "saved" ? (
              <>
                <Text variant="title" accessibilityRole="header" style={{ color: chrome.text }}>
                  Saved
                </Text>
                <Text style={{ color: chrome.textMuted }}>
                  Your match uploads on Wi-Fi, then Ball Boi analyzes it. Follow along in the Ball Boi tab.
                </Text>
                <ChromeButton label="Done" onPress={() => router.back()} />
              </>
            ) : null}
            {phase === "error" ? (
              <>
                <Text variant="title" accessibilityRole="alert" style={{ color: chrome.text }}>
                  Something went wrong
                </Text>
                <Text style={{ color: chrome.textMuted }}>{error}</Text>
                <ChromeButton label="Close" onPress={() => router.back()} />
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  round: {
    width: MIN_TAP,
    height: MIN_TAP,
    borderRadius: MIN_TAP / 2,
    backgroundColor: chrome.scrim,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.space2,
    minHeight: MIN_TAP,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.radiusPill,
    backgroundColor: chrome.scrim,
  },
  panel: {
    padding: spacing.space4,
    borderRadius: radius.radiusLg,
    gap: spacing.space3,
  },
  shutter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 5,
    borderColor: chrome.text,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterRecord: { width: 64, height: 64, borderRadius: 32, backgroundColor: chrome.danger },
});
