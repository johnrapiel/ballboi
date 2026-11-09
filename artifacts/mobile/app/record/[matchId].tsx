// Ball Boi recorder (spec: Ball Boi > Recording).
//
// Rear camera only, phone mounted on the fence, screen facing away from the
// court. Start now or after a spoken countdown, stop with the Stop button
// (it asks first) or from the other player's phone, and the safety cap
// stops and saves on low battery, low storage, or at 4 hours.
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
//
// Court detection (Wave 2, spec: Ball Boi > Recording and Processing). While
// setting up and counting down, the phone reads about one small frame a
// second and finds the court lines in it (lib/court). The overlay draws what
// it found and says in words whether the court is in frame.
//
// Armed start (John, Nov 8; lib/recording/armedStart.ts). Record works as
// soon as the camera is ready: the player picks a start and taps Record with
// the phone in hand, then mounts it. The phone waits for the court, and once
// it locks the chosen countdown runs by itself. A bump mid-countdown pauses it
// until the court locks again. No lock after about 20 seconds: line 12, and
// the countdown starts anyway. Frames stop the moment capture starts: while recording, the motion sensor says
// whether the phone has moved. After the stop, a locked court that never
// moved goes with the match as its four corners. Otherwise the phone looks
// once more and, if it still isn't sure, the player fixes the lines on that
// still (CourtLineFix) or skips, and the server finds the court itself. The
// match is in the upload queue before the fix shows, held until it's
// answered, so a dead battery never loses it.

import { useAuth, useUser } from "@clerk/expo";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Icon } from "@/components/Icon";
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

import { Checkbox } from "@/components/record/Checkbox";
import { ChromeButton, ChromeChoice, ChromeLink } from "@/components/record/ChromeControls";
import { CourtLineFix } from "@/components/record/CourtLineFix";
import { CourtLines, CourtStatus, type CourtStatusText } from "@/components/record/CourtOverlay";
import { FirstRunCarousel } from "@/components/record/FirstRunCarousel";
import { Button, Screen, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { captionFor, COACH_LINES, type CueId } from "@/lib/coachLines";
import { commandAction, playersLine, type LiveCommand } from "@/lib/liveActivity/props";
import { useRecorderLiveActivity } from "@/lib/liveActivity/useRecorderLiveActivity";
import { captionOnLiveActivity } from "@/lib/recording/captions";
import { frameStatus, type AimStep, type LockState } from "@/lib/court/aim";
import { COACH_START, countdownCueDue, countdownOpening, COUNTDOWN_QUIET_MS, nextCoachCue, type CoachState } from "@/lib/court/coach";
import { hasMoved, type Attitude } from "@/lib/court/motion";
import { calibrationFromFit, toCalibration, type CourtCalibration } from "@/lib/court/calibration";
import { captureFrame, discard as discardStill, keepStill, releaseFrame, type CourtStill } from "@/lib/court/frame";
import { DEFAULT_CORNERS, isCourtShape, type Corners } from "@/lib/court/geometry";
import type { PhoneOrientation } from "@/lib/court/overlay";
import { useCourtWatch } from "@/lib/court/useCourtWatch";
import {
  abandonQuickMatch,
  discardOnServer,
  opponentAgreedLabel,
  useMatchFilming,
  useRecordingConsent,
} from "@/lib/recording/api";
import { chrome } from "@/lib/recording/chrome";
import {
  arm,
  fallbackDue,
  onCourtLocked,
  onCourtLost,
  startAnyway,
  timeLeft,
  type ArmedStart,
} from "@/lib/recording/armedStart";
import { countdownClock, START_DELAYS, type StartDelayMinutes } from "@/lib/recording/countdown";
import { deleteRecording, keepRecording } from "@/lib/recording/files";
import { formatElapsed, spokenDuration } from "@/lib/recording/format";
import { LOW_BATTERY_START_MESSAGE } from "@/lib/recording/limits";
import { firstRunPages, type FirstRunPage } from "@/lib/recording/firstRun";
import { MIC_DENIED_BODY, MIC_DENIED_TITLE, micState } from "@/lib/recording/permissions";
import { loadHideSetup } from "@/lib/recording/prefs";
import { enqueue, getQueue, updateQueued } from "@/lib/recording/queue";
import {
  batteryBlocksStart,
  hasRoomToStart,
  MAX_RECORDING_SECONDS,
  MIN_START_STORAGE_GB,
  BATTERY_WARNING,
  STORAGE_WARNING,
  useRecordingWarnings,
  STOP_CUES,
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
import { tellOpponent } from "@/lib/notifications";
import {
  loadVoiceMuted,
  playCue,
  preloadVoice,
  prepareVoice,
  releaseVoice,
  setVoiceMuted,
  stopVoice,
  useVoiceMuted,
  voiceBusy,
} from "@/lib/recording/voice";

type Phase =
  | "ready"
  /** Record tapped: waiting for the court to lock before the countdown runs. */
  | "armed"
  | "countdown"
  /** The phone moved mid-countdown: waiting for the court to lock again. */
  | "paused"
  | "recording"
  /** The camera stopped while the app stayed open (a call ringing): starting again on its own. */
  | "rejoining"
  /** The app went to the background mid-match: waiting for Resume recording or Done. */
  | "interrupted"
  | "saving"
  | "deciding"
  /** The phone wasn't sure where the court is: the player fixes the lines. */
  | "courtFix"
  | "error";

/** A stop you chose under this many seconds asks "Keep this recording?" first (#79 note, D1). */
const SHORT_RECORDING_SECONDS = 2 * 60;
/** A piece shorter than this is a failed start, not video worth keeping. */
const MIN_PIECE_MS = 1500;
/** After Resume recording, how long to keep trying while the camera comes back. */
const RESUME_GIVE_UP_MS = 10_000;
/** Room the ready screen keeps for the top bar, the court status, Record button and a hint line, outside its scrolling panels. */
const READY_RESERVED = 310;
/** Within this many seconds of the 4-hour cap counts as reaching it. */
const CAP_SLACK_SECONDS = 5;
/** Longest wait for the camera's look at the court after the stop. */
const FRAME_TIMEOUT_MS = 3000;


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
  const { width, height } = useWindowDimensions();
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
  /** The voice coach: its repeat and quiet state (G8), and where the phone was at the last correction. */
  const coachState = useRef<CoachState>(COACH_START);
  const coachAttitude = useRef<Attitude | null>(null);
  /** The armed start: waiting for the court, counting, or paused after a bump. Null when not armed. */
  const armed = useRef<ArmedStart | null>(null);
  /** Countdown lines already played for this start, so a paused countdown never repeats them. */
  const playedCues = useRef<Set<CueId>>(new Set());
  const saidSetup = useRef(false);
  const countdownToken = useRef(0);
  const muted = useVoiceMuted();
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
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
  const filming = useMatchFilming(matchId);
  /** When the recorder checked "[Name] agreed to be filmed." (B10). */
  const [opponentAgreedAt, setOpponentAgreedAt] = useState<string | null>(null);
  const { getToken } = useAuth();
  const { user } = useUser();
  /** The voice coach's latest caption, for the Live Activity only (G11). */
  const [liveCaption, setLiveCaption] = useState<string | null>(null);
  /** Setup started on the camera: the Live Activity runs from here until the match is saved. */
  const liveStarted = useRef(false);
  /** "Don't show this again" from the setup page; null until read. */
  const [hideSetup, setHideSetupState] = useState<boolean | null>(null);
  /** The carousel's pages, decided once when the screen opens so saving page 2 doesn't reshuffle them. */
  const introPages = useRef<FirstRunPage[] | null>(null);
  const [introDone, setIntroDone] = useState(false);
  /** "Setup tips" on the ready screen: the setup page on its own. */
  const [tipsOpen, setTipsOpen] = useState(false);
  /** How the mounted phone is held, for drawing the court over the preview. */
  const [orientation, setOrientation] = useState<PhoneOrientation>("portrait");
  /** The court corners when recording started from a lock, or null. */
  const lockedAtStart = useRef<CourtCalibration | null>(null);
  /** The still for the court-line fix, and where its handles start. */
  const [fixStill, setFixStill] = useState<CourtStill | null>(null);
  const [fixStart, setFixStart] = useState<Corners>(DEFAULT_CORNERS);
  const fixAnswer = useRef<((c: CourtCalibration | null) => void) | null>(null);
  /** The setup frame saved as a still when recording started without a lock. */
  const setupStill = useRef<Promise<CourtStill | null> | null>(null);

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  // The court check: frames while setting up and counting down, the motion
  // sensor the whole time the camera is open.
  const court = useCourtWatch(
    camera,
    cameraReady && !tipsOpen && settingUp(phase),
    true,
    {
      onFrame: (step, lock) => coachFrame(step, lock),
      // "Perfect. Court locked." then the chime. Armed: the countdown then runs by itself.
      onLocked: () => {
        coachState.current = COACH_START;
        say("locked");
        say("chime");
        const p = phaseRef.current;
        if ((p === "armed" || p === "paused") && armed.current) beginCountdown(onCourtLocked(armed.current, Date.now()));
      },
      onLockLost: () => {
        coachState.current = COACH_START;
        // Bumped during the countdown: it pauses, line 13 plays, and the coach
        // re-aims until the court locks again.
        if (phaseRef.current !== "countdown" || !armed.current) return;
        const next = onCourtLost(armed.current, Date.now(), COACH_LINES.go.ms, playedCues.current.has("go"));
        if (next.stage !== "paused") return;
        armed.current = next;
        countdownToken.current++;
        stopVoice();
        setSecondsLeft(Math.ceil(next.msLeft / 1000));
        setPhase("paused");
        say("moved");
      },
    },
    orientation,
  );
  const courtRef = useRef(court);
  courtRef.current = court;

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
    preloadVoice();
    loadVoiceMuted();
    return () => {
      mounted.current = false;
      releaseVoice();
      // Leaving mid-fix: the match uploads without corners, and the server finds the court.
      fixAnswer.current?.(null);
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
        if (p === "armed" || p === "countdown" || p === "paused") cancelCountdown(false);
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

  // Line 01 once the camera is up and setup starts.
  useEffect(() => {
    if (!cameraReady || phase !== "ready" || tipsOpen || saidSetup.current) return;
    saidSetup.current = true;
    say("setup");
    // say reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady, phase, tipsOpen]);

  // Countdown: 14, 15 or 16 at the start, 17 at one minute left, 18 at ten
  // seconds, and 19 timed so capture starts as it ends. Start Now is a
  // countdown as long as line 19, so it plays 19 only. Capture waits for 19 to
  // finish, so the voice never lands in the recording. After a pause it
  // carries on from where it stopped, without repeating a line.
  useEffect(() => {
    if (phase !== "countdown") return;
    const totalMs = armed.current?.totalMs ?? Math.max(0, startAt.current - Date.now());
    const played = playedCues.current;
    const token = ++countdownToken.current;
    // After an earlier piece, iOS may still have the audio set up for the camera's microphone.
    if (segments.current.length > 0) prepareVoice(true);
    const opening = countdownOpening(delay);
    if (opening && totalMs > COACH_LINES.go.ms && !played.has(opening)) {
      played.add(opening);
      say(opening);
    }
    let last = -1;
    const tick = () => {
      const msLeft = Math.max(0, startAt.current - Date.now());
      const left = Math.ceil(msLeft / 1000);
      if (left !== last) {
        last = left;
        setSecondsLeft(left);
      }
      const cue = countdownCueDue(msLeft, totalMs, played, COACH_LINES.go.ms);
      if (!cue) return;
      played.add(cue);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (cue !== "go") {
        say(cue);
        return;
      }
      say(cue).then(() => {
        if (countdownToken.current !== token || phaseRef.current !== "countdown" || !mounted.current) return;
        runRecording(segments.current.length > 0 ? RESUME_GIVE_UP_MS : 0);
      });
    };
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
    // say and runRecording read refs only; the countdown restarts only on a new phase or delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, delay]);

  useSafetyCap(phase === "recording", (reason) => stop(reason));
  // G1: low battery or storage show in words while recording, before the safety cap stops the match.
  const warnings = useRecordingWarnings(phase === "recording");

  // The Live Activity on both phones (Session G, acceptance 31 to 35): from
  // the moment setup starts on the camera until the match is saved. It
  // carries the coach's captions, which never show on this screen (G11), and
  // brings back Start or Stop from the other player's phone.
  if (cameraReady) liveStarted.current = true;
  const liveCourt: CourtStatusText = settingUp(phase)
    ? frameStatus(court.lock.stage, court.step, coachState.current.last === "noLock")
    : lockedAtStart.current
      ? court.movedSinceLock
        ? "Phone moved"
        : "Court in frame"
      : "Court not locked";
  const liveStartBlocked = !!filming.data?.needsOpponentAgreement && !opponentAgreedAt;
  const liveRecordingSince =
    phase === "recording" && pieceStart.current !== null
      ? pieceStart.current - elapsedSeconds(segments.current, null, 0) * 1000
      : null;
  useRecorderLiveActivity(
    liveStarted.current
      ? {
          matchId,
          players: playersLine(user?.fullName, opponent),
          phase,
          court: liveCourt,
          caption: liveCaption,
          countdownTo: phase === "countdown" ? startAt.current : null,
          recordingSince: liveRecordingSince,
          startBlocked: liveStartBlocked,
        }
      : null,
    remoteCommand,
  );

  /**
   * Start or Stop from the other player's phone or a Lock Screen (acceptance
   * 32). The other phone already confirmed a Stop. Start begins line 19 now,
   * with or without a court lock (the lines are fixed after, as with Record anyway).
   */
  async function remoteCommand(command: LiveCommand) {
    const p = phaseRef.current;
    const action = commandAction(p, command, liveStartBlocked);
    if (action === "stop") {
      AccessibilityInfo.announceForAccessibility("Stopped from the other phone");
      stop("user");
      return;
    }
    if (action === "finish") {
      doneAfterInterruption();
      return;
    }
    if (action !== "startNow") return;
    const now = Date.now();
    if (p === "countdown") {
      // Already counting: jump to line 19, unless it's already playing.
      if (!armed.current || startAt.current - now <= COACH_LINES.go.ms) return;
      armed.current = { ...armed.current, startAt: now + COACH_LINES.go.ms };
      startAt.current = armed.current.startAt;
      return;
    }
    if (p === "ready") {
      if (!cameraReady || running.current) return;
      if ((await batteryBlocksStart()) || !hasRoomToStart()) return;
    }
    stopVoice();
    playedCues.current = new Set();
    coachState.current = COACH_START;
    beginCountdown(arm(0, now, COACH_LINES.go.ms, true));
    AccessibilityInfo.announceForAccessibility("Started from the other phone");
  }

  /**
   * Says one coach line from the manifest. Its caption never shows on the
   * mounted phone (its screen faces the fence) and VoiceOver doesn't read it
   * there, since the line already plays out loud (lib/recording/captions.ts).
   */
  async function say(id: CueId): Promise<void> {
    // The caption goes to the Live Activity (and the other phone and Watch), never this screen (G11).
    const caption = captionFor(id);
    if (caption && captionOnLiveActivity(settingUp(phaseRef.current) ? "setup" : "recording")) setLiveCaption(caption);
    await playCue(id);
  }

  /** One court frame: the next piece of guidance, one at a time with quiet between (G8). */
  function coachFrame(step: AimStep | null, lock: LockState) {
    const p = phaseRef.current;
    if (!settingUp(p)) return;
    // Close to capture, lines 18 and 19 come first.
    if (p === "countdown" && startAt.current - Date.now() <= COUNTDOWN_QUIET_MS) return;
    const now = Date.now();
    const attitude = courtRef.current.attitude.current;
    const { cue, state } = nextCoachCue(coachState.current, {
      now,
      step,
      stage: lock.stage,
      busy: voiceBusy(),
      movedSinceLast: hasMoved(coachAttitude.current, attitude),
      // Armed and still no lock after about 20 seconds: line 12, then the countdown starts anyway.
      recordAnywayDue: (p === "armed" || p === "paused") && fallbackDue(armed.current, now),
    });
    coachState.current = state;
    if (!cue) return;
    if (cue === "recordAnyway") {
      const token = countdownToken.current;
      say(cue).then(() => {
        const q = phaseRef.current;
        if (countdownToken.current !== token || !mounted.current || (q !== "armed" && q !== "paused") || !armed.current) return;
        beginCountdown(startAnyway(armed.current, Date.now()));
      });
      return;
    }
    if (cue !== "hold") coachAttitude.current = attitude;
    say(cue);
  }

  /** The countdown runs: from the start, or from where a bump paused it. */
  function beginCountdown(next: ArmedStart) {
    armed.current = next;
    startAt.current = next.startAt;
    setSecondsLeft(Math.ceil(timeLeft(next, Date.now()) / 1000));
    setPhase("countdown");
  }

  /** Leaves without a recording. A Quick match made just for this goes too (Q18). */
  function closeWithoutRecording() {
    if (leagueId == null && !getQueue().some((r) => r.matchId === matchId)) {
      abandonQuickMatch(matchId, getToken);
    }
    router.back();
  }

  // The first-run carousel comes first: it explains the camera and microphone before iOS asks.
  if (consent.isLoading || filming.isLoading || (consent.data && hideSetup === null)) {
    return (
      <Screen style={{ justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator accessibilityLabel="Loading" />
      </Screen>
    );
  }
  if (consent.isError || filming.isError) {
    return (
      <Screen style={{ justifyContent: "center", gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          Couldn't open Ball Boi
        </Text>
        <Text tone="inkMuted">
          {filming.error instanceof Error && !consent.isError ? filming.error.message : "Check your connection and try again."}
        </Text>
        <Button
          label="Try again"
          onPress={() => {
            if (consent.isError) consent.refetch();
            if (filming.isError) filming.refetch();
          }}
        />
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
    if (filming.data?.needsOpponentAgreement && !opponentAgreedAt) return;
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
    // Armed: the countdown runs once the court locks, or straight away if it
    // already has. Start Now is a countdown as long as line 19 ("Three. Two.
    // One. Recording has started."), so capture starts as it ends.
    playedCues.current = new Set();
    coachState.current = COACH_START;
    const next = arm(delay, Date.now(), COACH_LINES.go.ms, courtRef.current.lock.stage === "locked");
    if (next.stage === "counting") {
      beginCountdown(next);
      return;
    }
    armed.current = next;
    countdownToken.current++;
    setSecondsLeft(Math.ceil(next.msLeft / 1000));
    setPhase("armed");
    AccessibilityInfo.announceForAccessibility("Waiting for the court. Mount your phone. It starts on its own.");
  }

  /** Cancel while armed, counting or paused: back to where Record was tapped. */
  function cancelCountdown(announce = true) {
    countdownToken.current++;
    armed.current = null;
    stopVoice();
    setPhase(segments.current.length > 0 ? "interrupted" : "ready");
    if (announce) AccessibilityInfo.announceForAccessibility("Start cancelled");
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
      // The other players hear Ball Boi is recording, or "Was that you?" (Session G, decision 124).
      tellOpponent(matchId);
      // No voice here: the camera is capturing (line 19 already said it).
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
    if (segments.current.length === 0) noteCourtAtStart();
    // A court-check photo still being taken finishes first, so it never lands in the video.
    await Promise.race([courtRef.current.idle(), sleep(FRAME_TIMEOUT_MS)]);
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

  /**
   * Just before the first piece: a locked court becomes the match's corners,
   * and the newest setup frame is kept in case the court-line fix needs it.
   */
  function noteCourtAtStart() {
    const c = courtRef.current;
    lockedAtStart.current = c.lock.stage === "locked" ? calibrationFromFit(c.lock.lockedFit) : null;
    const frame = c.latestFrame.current;
    if (!lockedAtStart.current && frame && !setupStill.current) {
      setupStill.current = keepStill(frame);
    }
  }

  /**
   * The match's court corners after the stop: the lock from setup if the
   * phone never moved, or a fresh look now. When the phone still isn't sure,
   * returns the still for the court-line fix. A battery stop has no time for
   * a question, so the server finds the court.
   */
  async function settleCourt(reason: StopReason): Promise<{ calibration: CourtCalibration | null; still: CourtStill | null; start: Corners }> {
    const none = { calibration: null, still: null, start: DEFAULT_CORNERS };
    if (lockedAtStart.current && !courtRef.current.movedSinceLock) {
      return { ...none, calibration: lockedAtStart.current };
    }
    const frame = await Promise.race([captureFrame(camera.current, orientation), sleep(FRAME_TIMEOUT_MS).then(() => null)]);
    try {
      const found = frame ? calibrationFromFit(frame.fit) : null;
      if (found) return { ...none, calibration: found };
      if (reason === "battery" || !mounted.current) return none;
      const still = frame ? await keepStill(frame) : await (setupStill.current ?? Promise.resolve(null));
      if (!still) return none;
      const start = frame?.fit && isCourtShape(frame.fit.corners) ? frame.fit.corners : DEFAULT_CORNERS;
      return { calibration: null, still, start };
    } finally {
      releaseFrame(frame);
    }
  }

  /** Shows the court-line fix and waits for Save or Skip. */
  function askCourtFix(still: CourtStill, start: Corners): Promise<CourtCalibration | null> {
    return new Promise((resolve) => {
      fixAnswer.current = resolve;
      setFixStart(start);
      setFixStill(still);
      setPhase("courtFix");
    });
  }

  function answerCourtFix(corners: Corners | null) {
    const resolve = fixAnswer.current;
    fixAnswer.current = null;
    setPhase("saving");
    resolve?.(corners ? toCalibration(corners, "phone-fixed") : null);
  }

  function stop(reason: StopReason = "user") {
    stopRequested.current = true;
    reasonRef.current = reason;
    Haptics.notificationAsync(
      reason === "user" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {});
    // No voice yet: the camera is still finishing the file. Line 20 or 21, or
    // the chime, plays once capture has ended (finish).
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
    // Capture has ended: now the coach may speak. iOS left the audio set up
    // for the camera's microphone, so it's set back to the speaker first.
    if (pieces.length > 0) {
      await prepareVoice(true);
      await say(STOP_CUES[reason]);
    }
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
        setupStill.current?.then((st) => discardStill(st?.uri));
        setupStill.current = null;
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
    // The court's corners: from the lock, a fresh look, or the player's fix.
    const settled = await settleCourt(reason);
    // Into the upload queue: Wi-Fi by default, kept on the phone until the
    // server confirms. Held while the court-line fix is open, so the corners
    // go with the match; saved first, so the match is safe either way.
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
      ...(opponentAgreedAt ? { opponentAgreedAt } : {}),
      courtCalibration: settled.calibration,
      courtLinesPending: settled.still !== null,
    });
    if (settled.still) {
      const fixed = await askCourtFix(settled.still, settled.start);
      await updateQueued(id, { courtCalibration: fixed, courtLinesPending: false });
      discardStill(settled.still.uri);
    }
    setupStill.current?.then((st) => {
      if (st && st.uri !== settled.still?.uri) discardStill(st.uri);
    });
    setupStill.current = null;
    if (!mounted.current) {
      drainQueue();
      return;
    }
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
  const waiting = phase === "armed" || phase === "paused";
  const settingUpNow = settingUp(phase);
  const interrupted = phase === "interrupted";
  const status = recording
    ? `Recording, ${spokenDuration(elapsed)}`
    : rejoining || interrupted
      ? `Recording paused at ${spokenDuration(elapsed)}`
      : counting
        ? `Recording starts in ${spokenDuration(secondsLeft)}`
        : phase === "paused"
          ? `Countdown paused at ${spokenDuration(secondsLeft)}. Waiting for the court.`
          : phase === "armed"
            ? "Waiting for the court"
            : `Match vs ${opponent}`;
  const pillText = recording || rejoining || interrupted
    ? formatElapsed(elapsed)
    : counting
      ? `Starts in ${countdownClock(secondsLeft)}`
      : phase === "paused"
        ? `Paused at ${countdownClock(secondsLeft)}`
        : phase === "armed"
          ? "Waiting for the court"
          : `vs ${opponent}`;
  const canClose = phase === "ready" || phase === "error";
  // B10: an opponent who isn't on Ball Boi must have agreed before Start turns on.
  const needsAgreement = !!filming.data?.needsOpponentAgreement;
  const agreementMissing = needsAgreement && !opponentAgreedAt;
  // Record works as soon as the camera is ready: the court lock starts the countdown later (armed start).
  const courtLocked = court.lock.stage === "locked";
  const startOff = !cameraReady || agreementMissing;
  const setupStatus: CourtStatusText = frameStatus(court.lock.stage, court.step, coachState.current.last === "noLock");
  // While recording there are no frames: the motion sensor says if the phone moved (G1).
  const recordingStatus: CourtStatusText = lockedAtStart.current
    ? court.movedSinceLock
      ? "Phone moved"
      : "Court in frame"
    : "Court not locked";
  const recordLabel = delay === 0 ? "Record" : `Record, start in ${delay} minutes`;
  const startHint = agreementMissing
    ? "Check the box above to start."
    : courtLocked
      ? "The countdown starts now."
      : "Then mount your phone. The countdown starts on its own once the court locks.";

  if (phase === "courtFix" && fixStill) {
    return (
      <CourtLineFix
        still={fixStill}
        initial={fixStart}
        onDone={(corners) => answerCourtFix(corners)}
        onSkip={() => answerCourtFix(null)}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: chrome.ground }}>
      {/* The camera is always dark, so the status bar is light in both modes. */}
      <StatusBar style="light" />
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
        onResponsiveOrientationChanged={(e) => {
          const o = e.orientation;
          if (o === "portrait" || o === "portraitUpsideDown" || o === "landscapeLeft" || o === "landscapeRight") {
            setOrientation(o);
          }
        }}
        // The court check's frames are silent, with no screen flash.
        animateShutter={false}
        onCameraReady={() => setCameraReady(true)}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />

      {settingUpNow ? (
        <CourtLines fit={court.fit} locked={courtLocked} orientation={orientation} width={width} height={height} />
      ) : null}

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
            <Icon name="xmark" size={18} tintColor={chrome.text} />
          </Pressable>
        ) : (
          // Keeps the time pill centred while recording.
          <View style={{ width: MIN_TAP }} pointerEvents="none" />
        )}
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={status}
          style={[styles.pill, { flexShrink: 1 }]}
        >
          {recording ? (
            // The design system's Rec pill: filled clay, a dot and the word, so it's never color alone.
            <View style={styles.rec}>
              <View style={styles.recDot} />
              <Text variant="chip" style={{ color: chrome.onRec }}>
                Rec
              </Text>
            </View>
          ) : null}
          {rejoining || interrupted ? <Icon name="pause.circle" size={14} tintColor={chrome.text} /> : null}
          {/* D26: long names wrap instead of being cut off. */}
          <Text variant="bodyStrong" style={{ color: chrome.text, flexShrink: 1, textAlign: "center" }}>
            {pillText}
          </Text>
        </View>
        {settingUpNow || interrupted ? (
          // Mute: silences the voice coach on this phone.
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Voice coach"
            accessibilityState={{ checked: !muted }}
            accessibilityHint={muted ? "Off." : "On. Plays even with the silent switch on."}
            onPress={() => {
              const next = !muted;
              setVoiceMuted(next);
              AccessibilityInfo.announceForAccessibility(next ? "Voice coach off" : "Voice coach on");
            }}
            hitSlop={4}
            style={({ pressed }) => [styles.round, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Icon name={muted ? "speaker.slash.fill" : "speaker.wave.2.fill"} size={18} tintColor={chrome.text} />
          </Pressable>
        ) : (
          <View style={{ width: MIN_TAP }} pointerEvents="none" />
        )}
      </View>

      {/* G1: whether the court is in frame, and low battery or storage, in words and an icon, under the top bar. No live stats. */}
      {settingUpNow || recording || rejoining ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: insets.top + spacing.space2 + MIN_TAP + spacing.space2, left: spacing.space4, right: spacing.space4, gap: spacing.space2 }}
        >
          <CourtStatus status={settingUpNow ? setupStatus : recordingStatus} />
          {recording && warnings.battery ? <WarningPill text={BATTERY_WARNING} symbol="battery.25" /> : null}
          {recording && warnings.storage ? <WarningPill text={STORAGE_WARNING} symbol="externaldrive.badge.exclamationmark" /> : null}
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
            {micState(micPerm) === "denied" ? (
              <View style={[styles.panel, { backgroundColor: chrome.panel, alignSelf: "stretch" }]}>
                <View style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-start" }} accessible>
                  <Icon name="mic.slash" size={18} tintColor={chrome.text} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1, gap: spacing.space1 }}>
                    <Text variant="bodyStrong" style={{ color: chrome.text }}>
                      {MIC_DENIED_TITLE}
                    </Text>
                    <Text variant="small" style={{ color: chrome.textMuted }}>
                      {MIC_DENIED_BODY}
                    </Text>
                  </View>
                </View>
                <ChromeButton variant="secondary" label="Open Settings" onPress={() => Linking.openSettings()} />
              </View>
            ) : null}
            <View style={[styles.panel, { backgroundColor: chrome.scrim, alignSelf: "stretch", gap: spacing.space4 }]}>
              <ChromeChoice
                label="Start in"
                options={START_DELAYS.map((d) => ({ value: d.minutes, label: d.label }))}
                value={delay}
                onChange={setDelay}
              />
              {needsAgreement ? (
                <Checkbox
                  tone="chrome"
                  label={opponentAgreedLabel(filming.data?.opponentName ?? params.opponent ?? null)}
                  checked={!!opponentAgreedAt}
                  onChange={(on) => setOpponentAgreedAt(on ? new Date().toISOString() : null)}
                  accessibilityHint="They aren't on Ball Boi, so confirm you asked them first."
                />
              ) : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: spacing.space4 }}>
                <ChromeLink
                  label="Something not working?"
                  accessibilityHint="Tell us what went wrong. It goes to Ball Boi support."
                  onPress={() =>
                    router.push({ pathname: "/feedback", params: { source: "ready", matchId: String(matchId) } })
                  }
                />
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
            {agreementMissing ? (
              <View style={[styles.pill]}>
                <Text variant="small" style={{ color: chrome.text, textAlign: "center" }}>
                  Check the box above to start.
                </Text>
              </View>
            ) : !courtLocked ? (
              <View style={[styles.pill]}>
                <Text variant="small" style={{ color: chrome.text, textAlign: "center" }}>
                  Tap Record, then mount your phone. It starts once the court locks.
                </Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={recordLabel}
              accessibilityHint={startHint}
              accessibilityState={{ disabled: startOff }}
              disabled={startOff}
              onPress={pressStart}
              style={({ pressed }) => [styles.shutter, { opacity: startOff ? 0.5 : pressed ? 0.8 : 1 }]}
            >
              <View style={styles.shutterRecord} />
            </Pressable>
          </>
        ) : null}

        {waiting ? (
          // Armed, or paused after a bump: waiting for the court to lock. Words
          // for the moment the phone is in your hand; once mounted, the voice
          // coach does the talking.
          <View style={[styles.panel, { backgroundColor: chrome.scrim, alignSelf: "stretch", alignItems: "center" }]}>
            <View style={{ alignItems: "center", gap: spacing.space1 }} accessible accessibilityLiveRegion="polite">
              <Text variant="bodyStrong" style={{ color: chrome.text, textAlign: "center" }}>
                {phase === "paused" ? "Countdown paused. Waiting for the court" : "Waiting for the court"}
              </Text>
              <Text variant="small" style={{ color: chrome.textMuted, textAlign: "center" }}>
                {phase === "paused"
                  ? "It carries on once the court locks again."
                  : delay === 0
                    ? "Mount your phone. Recording starts once the court locks."
                    : `Mount your phone. The ${delay} minute countdown starts once the court locks.`}
              </Text>
            </View>
            <ChromeButton variant="secondary" label="Cancel" accessibilityLabel="Cancel start" onPress={() => cancelCountdown()} />
          </View>
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
            <ChromeButton variant="secondary" label="Cancel" accessibilityLabel="Cancel countdown" onPress={() => cancelCountdown()} />
          </View>
        ) : null}

        {recording ? (
          <View style={{ alignItems: "center", gap: spacing.space3 }} pointerEvents="box-none">
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
                <Icon name="exclamationmark.triangle" size={16} tintColor={chrome.text} />
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

/** Setting up: frames, the voice coach and the court overlay run in these phases. */
function settingUp(p: Phase): boolean {
  return p === "ready" || p === "armed" || p === "countdown" || p === "paused";
}

/** A warning while recording: an icon and the words, never color alone. */
function WarningPill({ text, symbol }: { text: string; symbol: "battery.25" | "externaldrive.badge.exclamationmark" }) {
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={text} style={[styles.pill, { alignSelf: "center" }]}>
      <Icon name={symbol} size={16} tintColor={chrome.text} />
      <Text variant="bodyStrong" style={{ color: chrome.text, flexShrink: 1 }}>
        {text}
      </Text>
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
  rec: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.space1,
    paddingHorizontal: 10,
    paddingVertical: spacing.space1,
    borderRadius: radius.radiusPill,
    backgroundColor: chrome.rec,
  },
  recDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: chrome.onRec },
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
