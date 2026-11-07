// Ball Boi recorder (spec: Ball Boi > Recording).
//
// Rear camera only, phone mounted on the fence, screen facing away from the
// court. Nobody touches the fence after mounting: start now or after a
// spoken countdown, stop by holding anywhere for 2 seconds, and the safety
// cap stops and saves on low battery, low storage, or at 4 hours.
// The video is analysis input only: it is never played back.
//
// Calls and interruptions (Wave 1 review). What this relies on, from
// expo-camera 58's iOS code (ios/Current/CameraVideoRecording.swift and
// CameraView.swift) and AVFoundation:
// - When iOS ends a recording itself (a call takes the camera or microphone,
//   the phone locks, the app goes to the background), AVCaptureMovieFileOutput
//   finishes the file and reports it as successfully finished, so
//   recordAsync resolves with the file, without our stop call.
// - Going to the background, expo-camera stops the camera session; coming
//   back, it starts it again. A call that only rings interrupts the session,
//   and iOS resumes it by itself once the ringing stops.
// So: a recording that ends without a stop is an interruption. The file so
// far is kept as one piece of the match. If the app went to the background
// (answered call, lock, app switch), the player sees "Resume recording" on
// return, and the next piece adds to the same match. If it stayed open (a
// call rang and wasn't answered), the camera starts again on its own as soon
// as it can: only the ringing seconds are lost. The pieces upload together
// and are joined in order on the server.

import { useAuth } from "@clerk/expo";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChromeButton, ChromeChoice, ChromeLink } from "@/components/record/ChromeControls";
import { FirstRunCarousel } from "@/components/record/FirstRunCarousel";
import { HoldToStop } from "@/components/record/HoldToStop";
import { Button, Screen, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { abandonQuickMatch, discardOnServer, useRecordingConsent } from "@/lib/recording/api";
import { captionDurationMs, captionWaitMs } from "@/lib/recording/captions";
import { chrome } from "@/lib/recording/chrome";
import { countdownClock, cueAt, START_DELAYS, type StartDelayMinutes } from "@/lib/recording/countdown";
import { deleteRecording, keepRecording } from "@/lib/recording/files";
import { formatElapsed, spokenDuration } from "@/lib/recording/format";
import { LOW_BATTERY_START_MESSAGE } from "@/lib/recording/limits";
import { firstRunPages, type FirstRunPage } from "@/lib/recording/firstRun";
import { loadHideSetup } from "@/lib/recording/prefs";
import { enqueue, getQueue } from "@/lib/recording/queue";
import {
  batteryBlocksStart,
  hasRoomToStart,
  MAX_RECORDING_SECONDS,
  MIN_START_STORAGE_GB,
  STOP_MESSAGES,
  useSafetyCap,
  type StopReason,
} from "@/lib/recording/safety";
import {
  elapsedSeconds,
  joinSegments,
  REJOIN_GIVE_UP_MS,
  REJOIN_RETRY_MS,
  remainingSeconds,
  type RecordedSegment,
} from "@/lib/recording/segments";
import { VIDEO_CODEC, VIDEO_QUALITY, VIDEO_STABILIZATION } from "@/lib/recording/settings";
import { drainQueue } from "@/lib/recording/uploader";
import { prepareVoice, say, stopVoice } from "@/lib/recording/voice";

type Phase =
  | "ready"
  | "countdown"
  | "recording"
  /** The camera stopped while the app stayed open (a call ringing): starting again on its own. */
  | "rejoining"
  /** The app went to the background mid-match: waiting for Resume recording or Done. */
  | "interrupted"
  | "saving"
  | "deciding"
  | "error";

/** A stop you chose under this many seconds asks "Keep this recording?" first (#79 note, D1). */
const SHORT_RECORDING_SECONDS = 2 * 60;
/** A piece shorter than this is a failed start, not video worth keeping. */
const MIN_PIECE_MS = 1500;
/** After Resume recording, how long to keep trying while the camera comes back. */
const RESUME_GIVE_UP_MS = 10_000;
/** Room the ready screen keeps for the top bar, Record button and a status line, outside its scrolling panels. */
const READY_RESERVED = 250;
/** Within this many seconds of the 4-hour cap counts as reaching it. */
const CAP_SLACK_SECONDS = 5;

export const DND_HINT = "Put your phone on Do Not Disturb before you hit record so the video isn't interrupted.";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Asks Keep or Discard with the native iOS action sheet. Dismissing it keeps the recording. */
function askKeepOrDiscard(durationSeconds: number): Promise<"keep" | "discard"> {
  const title = "Keep this recording?";
  const message = `It's ${spokenDuration(durationSeconds)} long.`;
  return new Promise((resolve) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, message, options: ["Discard", "Keep"], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
        (i) => resolve(i === 0 ? "discard" : "keep"),
      );
    } else {
      Alert.alert(title, message, [
        { text: "Discard", style: "destructive", onPress: () => resolve("discard") },
        { text: "Keep", style: "cancel", onPress: () => resolve("keep") },
      ], { cancelable: true, onDismiss: () => resolve("keep") });
    }
  });
}

interface Piece {
  uri: string | null;
  startedAt: number;
  ms: number;
  error?: string;
}

export default function RecordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const params = useLocalSearchParams<{ matchId: string; opponent?: string; league?: string }>();
  const matchId = Number(params.matchId);
  const opponent = params.opponent ?? "your opponent";
  const leagueId = params.league ? Number(params.league) : null;

  const [camPerm, requestCam, getCamPerm] = useCameraPermissions();
  const [micPerm, requestMic, getMicPerm] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [phase, setPhaseState] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  const [delay, setDelay] = useState<StartDelayMinutes>(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [caption, setCaption] = useState<string | null>(null);
  const captionShownAt = useRef(0);
  const captionText = useRef<string | null>(null);
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState<StopReason>("user");
  const startAt = useRef(0);
  const reasonRef = useRef<StopReason>("user");
  /** The pieces of this match saved so far, in order. */
  const segments = useRef<RecordedSegment[]>([]);
  /** When the piece being recorded now started, or null. */
  const pieceStart = useRef<number | null>(null);
  const recId = useRef<string | null>(null);
  const stopRequested = useRef(false);
  /** The app went to the background while recording: the next stop is an interruption. */
  const backgrounded = useRef(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const askedMic = useRef(false);
  const consent = useRecordingConsent();
  const { getToken } = useAuth();
  /** "Don't show this again" from the setup page; null until read. */
  const [hideSetup, setHideSetupState] = useState<boolean | null>(null);
  /** The carousel's pages, decided once when the screen opens so saving page 2 doesn't reshuffle them. */
  const introPages = useRef<FirstRunPage[] | null>(null);
  const [introDone, setIntroDone] = useState(false);
  /** "Setup tips" on the ready screen: the setup page on its own. */
  const [tipsOpen, setTipsOpen] = useState(false);

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  // The mounted phone must never auto-lock: iOS stops the camera when it does.
  useKeepAwake();

  useEffect(() => {
    loadHideSetup()
      .then((h) => mounted.current && setHideSetupState(h))
      .catch(() => mounted.current && setHideSetupState(false));
  }, []);

  useEffect(() => {
    mounted.current = true;
    prepareVoice();
    return () => {
      mounted.current = false;
      stopVoice();
      if (captionTimer.current) clearTimeout(captionTimer.current);
    };
  }, []);

  // Background and foreground. Going away mid-match marks the piece as
  // interrupted; a countdown can't run in the background, so it's cancelled.
  // Coming back reads the permissions again, since they may have changed in
  // iOS Settings (D20).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") {
        const p = phaseRef.current;
        if (p === "recording" || p === "rejoining") backgrounded.current = true;
        if (p === "countdown") cancelCountdown(false);
      }
      if (s === "active") {
        getCamPerm().catch(() => {});
        getMicPerm().catch(() => {});
      }
    });
    return () => sub.remove();
    // Reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // D20: once the camera is allowed (here, or later in iOS Settings), ask for
  // the microphone before the first recording, without waiting for a tap.
  useEffect(() => {
    if (!camPerm?.granted || !micPerm || micPerm.granted || askedMic.current) return;
    if (micPerm.status !== "undetermined" || !micPerm.canAskAgain) return;
    askedMic.current = true;
    requestMic().catch(() => {});
  }, [camPerm?.granted, micPerm, requestMic]);

  // Recording clock: every piece so far plus the one running now.
  useEffect(() => {
    if (phase !== "recording" && phase !== "rejoining") return;
    const tick = () => setElapsed(elapsedSeconds(segments.current, pieceStart.current, Date.now()));
    tick();
    const t = setInterval(tick, 1000);
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
        speak(cue);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      if (left === 0) runRecording(segments.current.length > 0 ? RESUME_GIVE_UP_MS : 0);
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
    // runRecording reads refs only; the countdown restarts only on a new phase or delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, delay]);

  useSafetyCap(phase === "recording", (reason) => stop(reason));

  /** Says a cue and shows it as a caption for at least 2 seconds (D24). */
  function speak(text: string) {
    say(text);
    showCaption(text);
  }

  function showCaption(text: string) {
    if (captionTimer.current) clearTimeout(captionTimer.current);
    captionShownAt.current = Date.now();
    captionText.current = text;
    setCaption(text);
    captionTimer.current = setTimeout(() => {
      captionText.current = null;
      if (mounted.current) setCaption(null);
    }, captionDurationMs(text));
  }

  /** Waits until the caption on screen has had its time, so leaving never cuts it short. */
  async function captionDone() {
    const text = captionText.current;
    if (!text) return;
    const wait = captionWaitMs(text, captionShownAt.current, Date.now());
    if (wait > 0) await sleep(wait);
  }

  /** Leaves without a recording. A Quick match made just for this goes too (Q18). */
  function closeWithoutRecording() {
    if (leagueId == null && !getQueue().some((r) => r.matchId === matchId)) {
      abandonQuickMatch(matchId, getToken);
    }
    router.back();
  }

  // The first-run carousel comes first: it explains the camera and microphone before iOS asks.
  if (consent.isLoading || (consent.data && hideSetup === null)) {
    return (
      <Screen style={{ justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator accessibilityLabel="Loading" />
      </Screen>
    );
  }
  if (consent.isError) {
    return (
      <Screen style={{ justifyContent: "center", gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          Couldn't open Ball Boi
        </Text>
        <Text tone="inkMuted">Check your connection and try again.</Text>
        <Button label="Try again" onPress={() => consent.refetch()} />
        <Button variant="secondary" label="Close" onPress={closeWithoutRecording} />
      </Screen>
    );
  }
  if (consent.data && introPages.current === null) {
    introPages.current = firstRunPages(consent.data, hideSetup ?? false);
  }
  const pages = introPages.current ?? [];
  if (!introDone && pages.length > 0) {
    // The training switch starts from a choice made earlier, like at an invite (D7).
    return (
      <FirstRunCarousel
        pages={pages}
        initialTraining={consent.data?.trainingEnabled ?? true}
        release={consent.data?.release}
        onDone={() => setIntroDone(true)}
        onCancel={closeWithoutRecording}
      />
    );
  }
  // Safety net: never open the camera without consent and a current release.
  if (!consent.data?.consented || consent.data.release?.needed) {
    return (
      <Screen style={{ justifyContent: "center", gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          Couldn't open Ball Boi
        </Text>
        <Text tone="inkMuted">Close and try recording again.</Text>
        <Button label="Close" onPress={closeWithoutRecording} />
      </Screen>
    );
  }
  if (tipsOpen) {
    return (
      <FirstRunCarousel
        pages={["setup"]}
        onDone={() => setTipsOpen(false)}
        onCancel={() => setTipsOpen(false)}
        cancelLabel="Back"
      />
    );
  }

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
              if (cam.granted && !micPerm?.granted) {
                askedMic.current = true;
                await requestMic();
              }
            }}
          />
        ) : (
          <Button label="Open Settings" onPress={() => Linking.openSettings()} />
        )}
        <Button variant="secondary" label="Not now" onPress={closeWithoutRecording} />
      </Screen>
    );
  }

  async function pressStart() {
    if (!cameraReady || running.current) return;
    // D14: under 10% and unplugged, don't start.
    if (await batteryBlocksStart()) {
      Alert.alert("Battery low", LOW_BATTERY_START_MESSAGE);
      return;
    }
    if (!hasRoomToStart()) {
      Alert.alert("Not enough space", `Free up at least ${MIN_START_STORAGE_GB} GB on your phone to record a match.`);
      return;
    }
    // D20: the microphone is asked for before the first recording, if it never was.
    if (micPerm && !micPerm.granted && micPerm.status === "undetermined" && micPerm.canAskAgain) {
      askedMic.current = true;
      await requestMic().catch(() => {});
    }
    setError(null);
    if (delay === 0) {
      runRecording(segments.current.length > 0 ? RESUME_GIVE_UP_MS : 0);
      return;
    }
    startAt.current = Date.now() + delay * 60 * 1000;
    setPhase("countdown");
  }

  function cancelCountdown(announce = true) {
    stopVoice();
    captionText.current = null;
    setCaption(null);
    setPhase(segments.current.length > 0 ? "interrupted" : "ready");
    if (announce) AccessibilityInfo.announceForAccessibility("Countdown cancelled");
  }

  /** Records one piece, until it's stopped or iOS ends it. */
  async function recordPiece(maxSeconds: number, quiet: boolean): Promise<Piece> {
    const started = Date.now();
    pieceStart.current = started;
    if (!quiet) setPhase("recording");
    // Once it's really going, say so, and show it (D24).
    const confirm = setTimeout(() => {
      if (pieceStart.current !== started || !mounted.current) return;
      setPhase("recording");
      speak("Recording");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }, MIN_PIECE_MS);
    try {
      if (!camera.current) throw new Error("The camera isn't ready.");
      const video = await camera.current.recordAsync({ maxDuration: maxSeconds, codec: VIDEO_CODEC });
      return { uri: video?.uri ?? null, startedAt: started, ms: Date.now() - started };
    } catch (e) {
      return { uri: null, startedAt: started, ms: Date.now() - started, error: e instanceof Error ? e.message : undefined };
    } finally {
      clearTimeout(confirm);
      pieceStart.current = null;
    }
  }

  /** Moves a finished piece out of the cache and adds it to the match. */
  async function savePiece(piece: Piece & { uri: string }) {
    recId.current ??= `match-${matchId}-${piece.startedAt}`;
    const saved = await keepRecording(piece.uri, `${recId.current}-${segments.current.length}`);
    if (saved.sizeBytes <= 0) {
      deleteRecording(saved.uri);
      return;
    }
    segments.current = [
      ...segments.current,
      {
        uri: saved.uri,
        sizeBytes: saved.sizeBytes,
        durationSeconds: Math.max(1, Math.round(piece.ms / 1000)),
        startedAt: new Date(piece.startedAt).toISOString(),
      },
    ];
  }

  /**
   * Records the match, piece by piece, until it's stopped, reaches 4 hours,
   * or the app goes to the background. `retryMs` > 0 means the camera may
   * still be coming back (after Resume recording), so a failed start is
   * tried again for that long.
   */
  async function runRecording(retryMs: number) {
    if (running.current) return;
    running.current = true;
    stopRequested.current = false;
    reasonRef.current = "user";
    backgrounded.current = false;
    setError(null);
    let retryingSince: number | null = retryMs > 0 ? Date.now() : null;
    let retryLimit = retryMs;
    try {
      while (mounted.current) {
        const left = remainingSeconds(segments.current, MAX_RECORDING_SECONDS);
        if (left <= CAP_SLACK_SECONDS) {
          reasonRef.current = "time";
          break;
        }
        const piece = await recordPiece(left, retryingSince !== null);
        const worked = piece.uri !== null && piece.ms >= MIN_PIECE_MS;
        if (worked) {
          await savePiece(piece as Piece & { uri: string });
          retryingSince = null;
        } else if (piece.uri) {
          deleteRecording(piece.uri); // A blip, not video.
        }

        if (stopRequested.current) break;
        if (remainingSeconds(segments.current, MAX_RECORDING_SECONDS) <= CAP_SLACK_SECONDS) {
          // Reaching maxDuration ends the recording without a stop call.
          reasonRef.current = "time";
          break;
        }
        // Answered call, lock, app switch: the player resumes when they're back.
        if (backgrounded.current) {
          setPhase("interrupted");
          return;
        }
        if (!worked && segments.current.length === 0 && retryingSince === null) {
          // The very first start failed: nothing to keep.
          setError(piece.error ?? "Recording failed.");
          setPhase("error");
          return;
        }
        // The app stayed open (a call rang): start again as soon as the camera's back.
        if (retryingSince === null) {
          retryingSince = Date.now();
          retryLimit = REJOIN_GIVE_UP_MS;
          setPhase("rejoining");
        }
        if (Date.now() - retryingSince > retryLimit) {
          if (segments.current.length === 0) {
            setError("The camera didn't start. Close and try again.");
            setPhase("error");
          } else {
            setError("The camera didn't start again. Try Resume recording.");
            setPhase("interrupted");
          }
          return;
        }
        await sleep(REJOIN_RETRY_MS);
        if (stopRequested.current) break;
        if (backgrounded.current) {
          setPhase("interrupted");
          return;
        }
      }
      if (mounted.current) await finish(reasonRef.current);
    } finally {
      running.current = false;
    }
  }

  function stop(reason: StopReason = "user") {
    stopRequested.current = true;
    reasonRef.current = reason;
    Haptics.notificationAsync(
      reason === "user" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {});
    const message = reason === "user" ? "Recording stopped" : STOP_MESSAGES[reason];
    speak(message);
    AccessibilityInfo.announceForAccessibility(message);
    camera.current?.stopRecording();
  }

  function confirmStop() {
    Alert.alert("Stop recording?", "Your match so far is saved.", [
      { text: "Keep recording", style: "cancel" },
      { text: "Stop", style: "destructive", onPress: () => stop("user") },
    ]);
  }

  /** "Done" after an interruption: the match is what was recorded before it. */
  function doneAfterInterruption() {
    if (running.current) return;
    finish("user");
  }

  async function finish(reason: StopReason) {
    setStopReason(reason);
    setPhase("saving");
    const pieces = segments.current;
    // The "Recording stopped" caption gets its 2 seconds before anything covers it (D24).
    await captionDone();
    if (pieces.length === 0) {
      closeWithoutRecording();
      return;
    }
    const joined = joinSegments(pieces);
    const id = recId.current ?? `match-${matchId}-${Date.now()}`;

    // Stopped early or by mistake: ask before it goes anywhere. Auto-stops
    // (battery, storage, 4 hours) always keep.
    if (reason === "user" && joined.durationSeconds < SHORT_RECORDING_SECONDS) {
      setPhase("deciding");
      if ((await askKeepOrDiscard(joined.durationSeconds)) === "discard") {
        for (const p of pieces) deleteRecording(p.uri);
        segments.current = [];
        // No session exists yet. A Quick match only existed for this
        // recording, so it goes too (Q18); league matches stay. Sent in the
        // background so a weak signal never leaves you stuck on the camera.
        if (leagueId == null) {
          discardOnServer(matchId, null, getToken)
            .catch(() => {})
            .then(() => abandonQuickMatch(matchId, getToken));
        }
        AccessibilityInfo.announceForAccessibility("Recording discarded");
        router.back();
        return;
      }
      setPhase("saving");
    }
    // Into the upload queue: Wi-Fi by default, kept on the phone until the server confirms.
    await enqueue({
      id,
      matchId,
      opponentName: opponent,
      uri: pieces[0].uri,
      sizeBytes: joined.sizeBytes,
      durationSeconds: joined.durationSeconds,
      recordedAt: joined.recordedAt,
      segments: pieces,
      leagueId,
    });
    drainQueue();
    AccessibilityInfo.announceForAccessibility("Match saved. It uploads on Wi-Fi.");
    // Straight to the score prompt; the stop message carries over.
    router.replace({
      pathname: "/record/score/[matchId]",
      params: {
        matchId: String(matchId),
        opponent,
        rec: id,
        ...(params.league ? { league: params.league } : {}),
        ...(reason !== "user" ? { stopped: reason } : {}),
      },
    });
  }

  const recording = phase === "recording";
  const rejoining = phase === "rejoining";
  const counting = phase === "countdown";
  const interrupted = phase === "interrupted";
  const live = recording || rejoining;
  const status = recording
    ? `Recording, ${spokenDuration(elapsed)}`
    : rejoining || interrupted
      ? `Recording paused at ${spokenDuration(elapsed)}`
      : counting
        ? `Recording starts in ${spokenDuration(secondsLeft)}`
        : `Match vs ${opponent}`;
  const pillText = recording || rejoining || interrupted
    ? formatElapsed(elapsed)
    : counting
      ? `Starts in ${countdownClock(secondsLeft)}`
      : `vs ${opponent}`;
  const canClose = phase === "ready" || phase === "error";

  return (
    <View style={{ flex: 1, backgroundColor: chrome.ground }}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="video"
        // 1280x720, 30 fps, H.264, no stabilization: what the analysis models read.
        videoQuality={VIDEO_QUALITY}
        videoStabilizationMode={VIDEO_STABILIZATION}
        mute={!micPerm?.granted}
        // The app is portrait-only, but a fence-mounted phone is usually
        // sideways. Record in whichever way the phone is actually held.
        responsiveOrientationWhenOrientationLocked
        onCameraReady={() => setCameraReady(true)}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />

      {live ? <HoldToStop onStop={() => stop("user")} bottomInset={insets.bottom} /> : null}

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
        {canClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={closeWithoutRecording}
            hitSlop={4}
            style={({ pressed }) => [styles.round, { opacity: pressed ? 0.7 : 1 }]}
          >
            <SymbolView name="xmark" size={18} tintColor={chrome.text} />
          </Pressable>
        ) : (
          // D25: while recording, touches here fall through to hold-to-stop.
          <View style={{ width: MIN_TAP }} pointerEvents="none" />
        )}
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={status}
          // D25: holding on the time pill stops too.
          pointerEvents={live ? "none" : "auto"}
          style={[styles.pill, { flexShrink: 1 }]}
        >
          {recording ? <SymbolView name="record.circle" size={14} tintColor={chrome.danger} /> : null}
          {rejoining || interrupted ? <SymbolView name="pause.circle" size={14} tintColor={chrome.text} /> : null}
          {/* D26: long names wrap instead of being cut off. */}
          <Text variant="bodyStrong" style={{ color: chrome.text, flexShrink: 1, textAlign: "center" }}>
            {pillText}
          </Text>
        </View>
        <View style={{ width: MIN_TAP }} pointerEvents="none" />
      </View>

      {/* D24: every spoken cue also shows as text, for at least 2 seconds. */}
      {caption && !counting ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <View style={[styles.caption, { backgroundColor: chrome.scrim }]}>
            <Text variant="title" style={{ color: chrome.text, textAlign: "center" }} accessibilityLiveRegion="polite">
              {caption}
            </Text>
          </View>
        </View>
      ) : null}

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
            {/* At the largest text sizes the panels scroll, so Record and Close stay on screen. */}
            <ScrollView
              style={{ alignSelf: "stretch", flexGrow: 0, maxHeight: Math.max(160, height - insets.top - insets.bottom - READY_RESERVED) }}
              contentContainerStyle={{ gap: spacing.space4 }}
              showsVerticalScrollIndicator
            >
            <View style={[styles.panel, { backgroundColor: chrome.scrim, alignSelf: "stretch", gap: spacing.space4 }]}>
              <Text style={{ color: chrome.text, textAlign: "center" }}>
                Mount your phone on the fence behind the baseline, turned sideways, with the whole court in view.
              </Text>
              <View style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-start" }} accessible>
                <SymbolView name="moon.fill" size={16} tintColor={chrome.text} style={{ marginTop: 2 }} />
                <Text variant="small" style={{ color: chrome.text, flex: 1 }}>
                  {DND_HINT}
                </Text>
              </View>
              <ChromeChoice
                label="Start in"
                options={START_DELAYS.map((d) => ({ value: d.minutes, label: d.label }))}
                value={delay}
                onChange={setDelay}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: spacing.space4 }}>
                <ChromeLink
                  label="Setup tips"
                  accessibilityHint="Shows where to put your phone and what to check first."
                  onPress={() => {
                    setCameraReady(false);
                    setTipsOpen(true);
                  }}
                />
              </View>
            </View>
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={delay === 0 ? "Record" : `Start ${delay} minute countdown`}
              accessibilityHint={DND_HINT}
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
            <ChromeButton variant="secondary" label="Cancel" accessibilityLabel="Cancel countdown" onPress={() => cancelCountdown()} />
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

        {rejoining ? (
          <View style={[styles.panel, { backgroundColor: chrome.scrim, alignSelf: "stretch", alignItems: "center" }]}>
            <Text variant="bodyStrong" style={{ color: chrome.text, textAlign: "center" }} accessibilityLiveRegion="polite">
              Recording paused. It starts again in a moment.
            </Text>
            <ChromeButton variant="secondary" label="Stop" accessibilityLabel="Stop recording" onPress={confirmStop} />
          </View>
        ) : null}

        {interrupted ? (
          <View style={[styles.panel, { backgroundColor: chrome.panel, alignSelf: "stretch", gap: spacing.space4 }]}>
            <View style={{ gap: spacing.space1 }} accessible>
              <Text variant="title" accessibilityRole="header" style={{ color: chrome.text }}>
                Recording paused
              </Text>
              <Text style={{ color: chrome.textMuted }}>
                {error ?? "Your match so far is saved. Resume to add to the same match."}
              </Text>
            </View>
            <ChromeChoice
              label="Start in"
              options={START_DELAYS.map((d) => ({ value: d.minutes, label: d.label }))}
              value={delay}
              onChange={setDelay}
            />
            <ChromeButton label="Resume recording" onPress={pressStart} />
            <ChromeButton variant="secondary" label="Done" onPress={doneAfterInterruption} />
          </View>
        ) : null}

        {phase === "saving" || phase === "error" ? (
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
            {phase === "error" ? (
              <>
                <Text variant="title" accessibilityRole="alert" style={{ color: chrome.text }}>
                  Something went wrong
                </Text>
                <Text style={{ color: chrome.textMuted }}>{error}</Text>
                <ChromeButton label="Close" onPress={closeWithoutRecording} />
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
    paddingVertical: spacing.space2,
    borderRadius: radius.radiusPill,
    backgroundColor: chrome.scrim,
  },
  caption: {
    maxWidth: "85%",
    paddingHorizontal: spacing.space6,
    paddingVertical: spacing.space3,
    borderRadius: radius.radiusLg,
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
