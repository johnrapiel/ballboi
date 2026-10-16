import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Linking, Pressable, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  completeBallBoiSession,
  requestBallBoiUploadUrl,
  startBallBoiSession,
} from "@workspace/api-client-react";
import { Button, Screen, Text } from "@/components/ui";
import { MIN_TAP, space, useTheme } from "@/theme";

type Phase = "ready" | "recording" | "uploading" | "done" | "error";

function formatElapsed(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function RecordScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const { matchId, opponent } = useLocalSearchParams<{ matchId: string; opponent?: string }>();
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  if (!camPerm) return null;

  if (!camPerm.granted) {
    return (
      <Screen style={{ paddingTop: 96 }}>
        <Text variant="title" accessibilityRole="header">Camera access</Text>
        <Text muted>Ball Boi needs the camera to record your match and track your shots. Video stays private to you and the players in the match.</Text>
        {camPerm.canAskAgain ? (
          <Button label="Allow camera" onPress={async () => { await requestCam(); await requestMic(); }} />
        ) : (
          <Button label="Open Settings" onPress={() => Linking.openSettings()} />
        )}
        <Button tone="secondary" label="Not now" onPress={() => router.back()} />
      </Screen>
    );
  }

  async function start() {
    if (!camera.current) return;
    setError(null);
    setPhase("recording");
    startedAt.current = Date.now();
    setElapsed(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    AccessibilityInfo.announceForAccessibility("Recording started");
    try {
      const video = await camera.current.recordAsync({ maxDuration: 3 * 60 * 60 });
      if (!video?.uri) throw new Error("No video was saved.");
      await upload(video.uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed.");
      setPhase("error");
    }
  }

  function stop() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    AccessibilityInfo.announceForAccessibility("Recording stopped. Uploading.");
    camera.current?.stopRecording();
  }

  async function upload(uri: string) {
    setPhase("uploading");
    const id = Number(matchId);
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    const session = await startBallBoiSession(id, { metadata: { source: "ios" } });
    const { uploadURL, objectPath } = await requestBallBoiUploadUrl(session.id);
    // TODO: long matches produce multi-GB files. Move to a background URLSession
    // upload (expo-file-system upload task) so this survives app suspension.
    const file = await fetch(uri);
    const blob = await file.blob();
    const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": "video/quicktime" }, body: blob });
    if (!put.ok) throw new Error(`Upload failed (${put.status}). Your video is still on this phone.`);
    await completeBallBoiSession(session.id, {
      objectPath,
      contentType: "video/quicktime",
      sizeBytes: blob.size,
      durationSeconds,
    });
    setPhase("done");
    AccessibilityInfo.announceForAccessibility("Upload complete. Ball Boi is analyzing your match.");
  }

  const recording = phase === "recording";

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="video"
        videoQuality="1080p"
        mute={!micPerm?.granted}
        accessibilityLabel="Camera preview"
      />

      {/* Top bar: always on black scrim so white text stays readable over video */}
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => (recording ? stop() : router.back())} style={styles.iconBtn}>
          <Ionicons name="close" size={26} color="#FFF" />
        </Pressable>
        <View style={styles.pill} accessible accessibilityLabel={recording ? `Recording, ${formatElapsed(elapsed)}` : `Match vs ${opponent ?? "opponent"}`}>
          {recording ? <View style={styles.dot} /> : null}
          <Text variant="label" color="#FFF">{recording ? formatElapsed(elapsed) : `VS ${(opponent ?? "").toUpperCase()}`}</Text>
        </View>
        <View style={{ width: MIN_TAP }} />
      </View>

      {phase === "ready" ? (
        <View style={styles.hint}>
          <Text color="#FFF" style={{ textAlign: "center" }}>Turn your phone sideways and fit the whole court in frame.</Text>
        </View>
      ) : null}

      <View style={styles.bottom}>
        {phase === "ready" || phase === "recording" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? "Stop recording" : "Start recording"}
            onPress={recording ? stop : start}
            style={styles.shutter}
          >
            <View style={[styles.shutterInner, recording && styles.shutterStop]} />
          </Pressable>
        ) : (
          <View style={[styles.panel, { backgroundColor: c.surface }]}>
            {phase === "uploading" ? <Text variant="headline">Uploading your match…</Text> : null}
            {phase === "done" ? (
              <>
                <Text variant="headline">Uploaded</Text>
                <Text muted>Ball Boi is analyzing your shots. We'll notify you when the replay is ready.</Text>
                <Button label="Done" onPress={() => router.back()} />
              </>
            ) : null}
            {phase === "error" ? (
              <>
                <Text variant="headline" color={c.destructive} accessibilityRole="alert">Something went wrong</Text>
                <Text muted>{error}</Text>
                <Button label="Close" onPress={() => router.back()} />
              </>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: "absolute", top: 54, left: space.lg, right: space.lg, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  iconBtn: { width: MIN_TAP, height: MIN_TAP, borderRadius: MIN_TAP / 2, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, minHeight: 32, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.6)" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#FF453A" },
  hint: { position: "absolute", top: "40%", left: space.xl, right: space.xl, padding: space.md, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.6)" },
  bottom: { position: "absolute", bottom: 48, left: space.lg, right: space.lg, alignItems: "center" },
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: "#FFF", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#FF453A" },
  shutterStop: { width: 32, height: 32, borderRadius: 6 },
  panel: { width: "100%", padding: space.lg, borderRadius: 16, gap: space.md },
});
