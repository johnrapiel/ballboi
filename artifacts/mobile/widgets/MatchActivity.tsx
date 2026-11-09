// The Live Activity on the Lock Screen, Dynamic Island and Apple Watch
// (Wave 2, Session G; acceptance 31 to 35). There's no canvas screen for it:
// it follows Apple's standard Live Activity layout in the design system's
// colors, for John to review in the PR.
//
// The same Live Activity runs on the mounted phone and the other player's
// phone; the other phone's copy is opened and updated by Ball Boi's server
// through Apple. What it shows comes from lib/liveActivity/props.ts.
//
// Rules for this file (expo-widgets runs the layout outside the app):
// - The function must be marked 'widget', use only @expo/ui/swift-ui, and
//   reference nothing outside itself, so the colors are written out below.
//   They're the design system's tokens: linen, ink, ink-muted (Day and Night).
// - No SF Symbols and no icon library (John, Nov 7): words only. Every state
//   is in words, never color alone, and text uses Apple's text styles so it
//   follows the reader's text size (acceptance 35).
// - Start match and Stop open Ball Boi on that phone: Start sends it; Stop
//   asks "Stop recording?" there first (acceptance 32).
// - Never mention holding the screen (X2).

import { HStack, Link, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityHint,
  accessibilityLabel,
  activityBackgroundTint,
  background,
  clipShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  multilineTextAlignment,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

import type { LiveProps } from "@/lib/liveActivity/props";

const MatchActivity = (props: LiveProps, environment: LiveActivityEnvironment) => {
  "widget";
  const night = environment.colorScheme === "dark";
  // Design system tokens (docs/design-system/tokens.json).
  const linen = night ? "#2A2927" : "#FFFFFF";
  const ink = night ? "#F5F4EF" : "#0A2447";
  const muted = night ? "#B5B2A9" : "#4A5670";
  const onInk = night ? "#1F1E1D" : "#FFFFFF";
  const stale = environment.isStale === true;

  const timer =
    props.stage === "counting" && props.countdownTo ? (
      <Text
        date={new Date(props.countdownTo)}
        dateStyle="timer"
        countsDown
        modifiers={[font({ textStyle: "headline" }), monospacedDigit(), foregroundStyle(ink)]}
      />
    ) : props.stage === "recording" && props.recordingSince ? (
      <Text
        date={new Date(props.recordingSince)}
        dateStyle="timer"
        modifiers={[font({ textStyle: "headline" }), monospacedDigit(), foregroundStyle(ink)]}
      />
    ) : null;

  const status = (
    <HStack spacing={6}>
      <Text modifiers={[font({ textStyle: "headline" }), foregroundStyle(ink)]}>{props.status}</Text>
      {timer}
    </HStack>
  );

  const details = (
    <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(muted), lineLimit(2)]}>
      {stale ? "Waiting for the mounted phone" : props.battery ? `${props.court} · Mounted phone ${props.battery.toLowerCase()}` : props.court}
    </Text>
  );

  const caption = props.caption ? (
    <Text modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(ink), lineLimit(3), accessibilityLabel(`Coach: ${props.caption}`)]}>
      {props.caption}
    </Text>
  ) : null;

  // Start and Stop never show together (lib/liveActivity/props.ts), so each is the one primary button.
  const button = (label: string, url: string, hint: string) => (
    <Link
      destination={url}
      modifiers={[accessibilityLabel(label), accessibilityHint(hint)]}
    >
      <Text
        modifiers={[
          font({ textStyle: "subheadline", weight: "semibold" }),
          foregroundStyle(onInk),
          multilineTextAlignment("center"),
          // At least 44pt tall.
          frame({ minWidth: 88, minHeight: 44 }),
          padding({ horizontal: 14 }),
          background(ink),
          clipShape("capsule"),
        ]}
      >
        {label}
      </Text>
    </Link>
  );

  const buttons =
    props.canStart || props.canStop ? (
      <HStack spacing={10}>
        {props.canStart ? button("Start match", props.startUrl, "Opens Ball Boi and starts recording on the mounted phone") : null}
        {props.canStop ? button("Stop", props.stopUrl, "Opens Ball Boi to confirm stopping the recording") : null}
        <Spacer />
      </HStack>
    ) : null;

  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 16 }), activityBackgroundTint(linen)]}>
        <HStack modifiers={[accessibilityElement("combine")]}>
          <Text modifiers={[font({ textStyle: "subheadline", weight: "semibold" }), foregroundStyle(ink), lineLimit(1)]}>
            {props.players}
          </Text>
          <Spacer />
          <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(muted)]}>Ball Boi</Text>
        </HStack>
        <VStack alignment="leading" spacing={2} modifiers={[accessibilityElement("combine")]}>
          {status}
          {details}
        </VStack>
        {caption}
        {buttons}
      </VStack>
    ),
    // Apple Watch Smart Stack and CarPlay: the stage and the coach's line.
    bannerSmall: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 8 })]}>
        {status}
        {props.caption ? <Text modifiers={[font({ textStyle: "footnote" }), lineLimit(3)]}>{props.caption}</Text> : details}
      </VStack>
    ),
    compactLeading: (
      <Text modifiers={[font({ textStyle: "caption", weight: "semibold" })]}>
        {props.stage === "recording"
          ? "Rec"
          : props.stage === "stopped"
            ? "Saved"
            : props.stage === "waiting" || props.stage === "paused"
              ? "Waiting"
              : props.stage === "counting"
                ? "Starting"
                : "Setup"}
      </Text>
    ),
    compactTrailing: timer ?? (
      <Text modifiers={[font({ textStyle: "caption" })]}>{props.court === "Court locked" ? "Locked" : "Aiming"}</Text>
    ),
    minimal: (
      <Text modifiers={[font({ textStyle: "caption2", weight: "semibold" })]}>
        {props.stage === "recording"
          ? "Rec"
          : props.stage === "stopped"
            ? "Saved"
            : props.stage === "waiting" || props.stage === "paused"
              ? "Waiting"
              : props.stage === "counting"
                ? "Starting"
                : "Setup"}
      </Text>
    ),
    expandedLeading: (
      <Text modifiers={[font({ textStyle: "subheadline", weight: "semibold" }), lineLimit(1)]}>{props.status}</Text>
    ),
    expandedTrailing: timer ?? <Text modifiers={[font({ textStyle: "footnote" })]}>{props.court}</Text>,
    expandedBottom: (
      <VStack alignment="leading" spacing={6}>
        {caption ?? details}
        {buttons}
      </VStack>
    ),
  };
};

export default createLiveActivity<LiveProps>("MatchActivity", MatchActivity);
