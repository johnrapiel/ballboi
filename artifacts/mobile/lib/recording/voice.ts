// The voice coach's speaker on the mounted phone (spec: Ball Boi > Recording;
// claude/design-decisions/voice-coach.md). Plays John's recorded clips from
// lib/coachLines.ts exactly as they are: no text-to-speech, no pitch, speed
// or effects.
//
// - One line at a time: a new line waits for the one playing to finish.
// - Plays with the silent switch on (spec decision 81: the app speaks only
//   from the mounted phone, only during a Ball Boi recording).
// - Never while the camera is capturing: the screen plays line 19 before
//   capture starts and 20 or 21 after it ends, so the voice never lands in
//   the match audio used for shot detection.
// - Mute silences the voice; captions keep showing.
// - A clip that can't load or play fails safe: its caption still shows, and
//   setup carries on after the line's usual length.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useSyncExternalStore } from "react";

import { COACH_LINES, type CueId } from "@/lib/coachLines";
import { COACH_CLIPS } from "@/lib/recording/coachAudio";

/** Extra time a line may run past its length before it counts as finished anyway. */
const FINISH_SLACK_MS = 1500;

let prepared = false;
const players = new Map<string, AudioPlayer>();
let queue: Promise<unknown> = Promise.resolve();
let playing = 0;
let generation = 0;

/**
 * Sets the phone to play with the silent switch on, through the speaker.
 * `again` after the camera has recorded: iOS leaves the audio set up for the
 * camera's microphone, which would send the voice to the earpiece.
 */
export async function prepareVoice(again = false) {
  if (prepared && !again) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
      interruptionMode: "duckOthers",
    });
    prepared = true;
  } catch {
    // Captions still carry every line.
  }
}

function playerFor(file: string): AudioPlayer | null {
  const existing = players.get(file);
  if (existing) return existing;
  const source = COACH_CLIPS[file];
  if (source == null) return null;
  try {
    const p = createAudioPlayer(source);
    players.set(file, p);
    return p;
  } catch {
    return null;
  }
}

/** Loads every clip ahead of time, so the first line isn't late. */
export function preloadVoice() {
  for (const line of Object.values(COACH_LINES)) playerFor(line.file);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Plays one clip to its end. Resolves true if it played out loud. Never throws. */
async function playOnce(id: CueId, gen: number): Promise<boolean> {
  const line = COACH_LINES[id];
  if (gen !== generation) return false;
  if (muted) {
    await sleep(line.ms);
    return false;
  }
  const p = playerFor(line.file);
  if (!p) {
    await sleep(line.ms);
    return false;
  }
  return new Promise<boolean>((resolve) => {
    let done = false;
    let started = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sub?.remove();
      clearTimeout(timer);
      resolve(ok);
    };
    let sub: { remove(): void } | null = null;
    try {
      sub = p.addListener("playbackStatusUpdate", (s) => {
        if (s.playing) started = true;
        if (s.didJustFinish) finish(true);
      });
    } catch {
      sub = null;
    }
    // Fail safe: a line never holds things up longer than it should.
    const timer = setTimeout(() => finish(started), line.ms + FINISH_SLACK_MS);
    try {
      p.seekTo(0)
        .catch(() => {})
        .then(() => {
          if (gen !== generation) return finish(false);
          p.play();
        });
    } catch {
      finish(false);
    }
  });
}

export interface PlayResult {
  /** True when the line was heard out loud (not muted, clip played). */
  played: boolean;
}

/**
 * Says one line, after any line already playing. Resolves when it ends, or
 * straight away (played: false) if the coach was stopped meanwhile.
 */
export function playCue(id: CueId): Promise<PlayResult> {
  const gen = generation;
  playing++;
  const run = queue.then(() => playOnce(id, gen));
  queue = run.catch(() => false);
  return run
    .then((played) => ({ played }))
    .catch(() => ({ played: false }))
    .finally(() => {
      playing = Math.max(0, playing - 1);
    });
}

/** True while a line is playing or waiting to. */
export function voiceBusy(): boolean {
  return playing > 0;
}

/** Stops the line playing and drops any waiting. */
export function stopVoice() {
  generation++;
  for (const p of players.values()) {
    try {
      p.pause();
    } catch {
      // Not playing.
    }
  }
}

/** Frees every clip when the camera screen closes. */
export function releaseVoice() {
  stopVoice();
  for (const p of players.values()) {
    try {
      p.remove();
    } catch {
      // Already freed.
    }
  }
  players.clear();
}

// ---------------------------------------------------------------------------
// Mute: per phone, like the other camera settings. Captions keep showing.

const MUTE_KEY = "ballboi.recording.voiceMuted";
let muted = false;
let muteLoaded = false;
const listeners = new Set<() => void>();

export async function loadVoiceMuted(): Promise<boolean> {
  if (muteLoaded) return muted;
  try {
    muted = (await AsyncStorage.getItem(MUTE_KEY)) === "1";
  } catch {
    muted = false;
  }
  muteLoaded = true;
  for (const l of listeners) l();
  return muted;
}

export async function setVoiceMuted(on: boolean) {
  muted = on;
  muteLoaded = true;
  if (on) {
    for (const p of players.values()) {
      try {
        p.pause();
      } catch {
        // Not playing.
      }
    }
  }
  for (const l of listeners) l();
  try {
    await AsyncStorage.setItem(MUTE_KEY, on ? "1" : "0");
  } catch {
    // Kept for this launch.
  }
}

export function useVoiceMuted(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => muted,
    () => muted,
  );
}
