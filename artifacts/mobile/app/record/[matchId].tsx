// Ball Boi recorder (spec: Ball Boi > Recording).
//
// Rear camera only, phone mounted on the fence, screen facing away from the
// court. Ported from the old `feat/ios-expo-app` recorder and rebuilt on the
// design system. The video is analysis input only: it is never played back.

import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Linking, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Screen, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { chrome } from "@/lib/recording/chrome";
import { keepRecording } from "@/lib/recording/files";
import { formatElapsed, spokenDuration } from "@/lib/recording/format";
import { ensureSession, uploadRecording } from "@/lib/recording/upload";

/** Spec safety cap: a recording never runs past 4 hours. */
const MAX_SECONDS = 4 * 60 * 60;

type Phase = "ready" | "recording" | "saving" | "uploading" | "done" | "error";

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
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  // The mounted phone must never auto-lock: iOS stops the camera when it does.
  useKeepAwake();

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

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

  async function start() {
    if (!camera.current || !cameraReady) return;
    setError(null);
    startedAt.current = Date.now();
    setElapsed(0);
    setPhase("recording");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    AccessibilityInfo.announceForAccessibility("Recording started");
    try {
      const video = await camera.current.recordAsync({ maxDuration: MAX_SECONDS });
      if (!video?.uri) throw new Error("No video was saved.");
      await finish(video.uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed.");
      setPhase("error");
    }
  }

  function stop() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    AccessibilityInfo.announceForAccessibility("Recording stopped");
    camera.current?.stopRecording();
  }

  async function finish(cacheUri: string) {
    setPhase("saving");
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    const saved = await keepRecording(cacheUri, `match-${matchId}-${Date.now()}`);
    setPhase("uploading");
    const rec = { matchId, uri: saved.uri, sizeBytes: saved.sizeBytes, durationSeconds };
    const sessionId = await ensureSession(rec);
    await uploadRecording({ ...rec, sessionId });
    setPhase("done");
    AccessibilityInfo.announceForAccessibility("Uploaded. Ball Boi is analyzing your match.");
  }

  const recording = phase === "recording";
  const status = recording ? `Recording, ${spokenDuration(elapsed)}` : `Match vs ${opponent}`;

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

      <View
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
        {recording ? (
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
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={status}
          style={[styles.pill, { flexShrink: 1 }]}
        >
          {recording ? <SymbolView name="record.circle" size={14} tintColor={chrome.danger} /> : null}
          <Text variant="bodyStrong" numberOfLines={1} style={{ color: chrome.text }}>
            {recording ? formatElapsed(elapsed) : `vs ${opponent}`}
          </Text>
        </View>
        <View style={{ width: MIN_TAP }} />
      </View>

      <View
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
          <View style={[styles.panel, { backgroundColor: chrome.scrim }]}>
            <Text style={{ color: chrome.text, textAlign: "center" }}>
              Mount your phone on the fence behind the baseline, turned sideways, with the whole court in view.
            </Text>
          </View>
        ) : null}

        {phase === "ready" || phase === "recording" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? "Stop recording" : "Record"}
            accessibilityState={{ disabled: !cameraReady }}
            disabled={!cameraReady}
            onPress={recording ? stop : start}
            style={({ pressed }) => [styles.shutter, { opacity: !cameraReady ? 0.5 : pressed ? 0.8 : 1 }]}
          >
            <View style={recording ? styles.shutterStop : styles.shutterRecord} />
          </Pressable>
        ) : (
          <View style={[styles.panel, { backgroundColor: chrome.panel, alignSelf: "stretch" }]}>
            {phase === "saving" || phase === "uploading" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }} accessible>
                <ActivityIndicator color={chrome.text} />
                <Text variant="bodyStrong" style={{ color: chrome.text }} accessibilityLiveRegion="polite">
                  {phase === "saving" ? "Saving your match" : "Uploading your match"}
                </Text>
              </View>
            ) : null}
            {phase === "done" ? (
              <>
                <Text variant="title" accessibilityRole="header" style={{ color: chrome.text }}>
                  Uploaded
                </Text>
                <Text style={{ color: chrome.textMuted }}>
                  Ball Boi is analyzing your shots. Your replay shows up in the Ball Boi tab when it's ready.
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
        )}
      </View>
    </View>
  );
}

/** Primary button on the dark camera screen. */
function ChromeButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        borderRadius: radius.radiusPill,
        backgroundColor: chrome.button,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.space6,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text variant="button" style={{ color: chrome.onButton }}>
        {label}
      </Text>
    </Pressable>
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
  shutterStop: { width: 32, height: 32, borderRadius: radius.radiusSm, backgroundColor: chrome.danger },
});
