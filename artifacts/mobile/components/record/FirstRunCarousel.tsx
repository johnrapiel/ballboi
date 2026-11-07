// The first-run carousel before the camera opens (spec decisions 90 to 92;
// B7 to B9). Replaces the single consent screen.
//
// 1) What Ball Boi records, 2) Your choices (training toggle, and the Beta
// Footage Release checkbox while the beta backend asks for it), 3) Set up
// your phone, ending in Open camera. Which pages show is decided by
// firstRunPages() in lib/recording/firstRun.ts.
//
// Next and Back, or swipe; never advances on its own. VoiceOver reads
// "Page 2 of 3" with each page's title. Reduce Motion swaps the slide for a
// fade. Next on page 2 saves the choices, and stays off until the release
// box is checked, with the reason in text under it.

import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/Icon";
import { Checkbox } from "@/components/record/Checkbox";
import { SetupGraphic } from "@/components/record/SetupGraphic";
import { Toggle } from "@/components/Toggle";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { consentKey, saveRecordingConsent, type RecordingConsent } from "@/lib/recording/api";
import {
  canLeavePage,
  HIDE_SETUP,
  pageLabel,
  RELEASE_BLOCKED,
  RELEASE_CHECKBOX,
  RELEASE_TITLE,
  SETUP_CHECKLIST,
  TRAINING_COPY,
  type FirstRunPage,
} from "@/lib/recording/firstRun";
import { loadHideSetup, setHideSetup } from "@/lib/recording/prefs";

const TITLES: Record<FirstRunPage, string> = {
  records: "What Ball Boi records",
  choices: "Your choices",
  setup: "Set up your phone",
};

/** A horizontal drag this far, mostly sideways, turns the page. */
const SWIPE_PX = 60;

function Point({ symbol, title, body }: { symbol: IconName; title: string; body: string }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={`${title}. ${body}`} style={{ flexDirection: "row", gap: spacing.space3 }}>
      <Icon name={symbol} size={22} tintColor={c.ink} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: spacing.space1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text tone="inkMuted">{body}</Text>
      </View>
    </View>
  );
}

function RecordsPage() {
  return (
    <View style={{ gap: spacing.space4 }}>
      <Point
        symbol="person.2"
        title="You're filming other players"
        body="Ball Boi films the whole court, including your opponent. Let everyone in the match know before you start."
      />
      <Point
        symbol="waveform"
        title="Audio is for analysis only"
        body="The microphone listens for the sound of the ball being hit. Audio is never played back and is deleted after your match is analyzed."
      />
      <Point
        symbol="eye.slash"
        title="Video is never shown in the app"
        body="Ball Boi turns your match into stats and a simulated replay. The video is never played back in the app."
      />
    </View>
  );
}

function ChoicesPage({
  training,
  setTraining,
  release,
  releaseChecked,
  setReleaseChecked,
}: {
  training: boolean;
  setTraining: (v: boolean) => void;
  release: RecordingConsent["release"] | undefined;
  releaseChecked: boolean;
  setReleaseChecked: (v: boolean) => void;
}) {
  const c = useColors();
  const openRelease = () => {
    WebBrowser.openBrowserAsync(release?.url ?? "https://ballboi.tennis/beta-release").catch(() => {});
  };
  return (
    <View style={{ gap: spacing.space4 }}>
      <Card style={{ gap: spacing.space3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: MIN_TAP }}>
          <Text variant="bodyStrong" style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
            Help Ball Boi get smarter
          </Text>
          <Toggle
            value={training}
            onValueChange={setTraining}
            accessibilityLabel="Help Ball Boi get smarter"
            accessibilityHint={TRAINING_COPY}
          />
        </View>
        <Text tone="inkMuted">{TRAINING_COPY}</Text>
        <Text variant="small" tone="inkMuted">
          A match is used for training only if every player leaves this on. Players who haven't joined Ball Boi are never
          included.
        </Text>
      </Card>

      {release?.needed ? (
        <Card style={{ gap: spacing.space2 }}>
          {/* The title is its own link target, separate from the checkbox label. */}
          <Pressable
            onPress={openRelease}
            accessibilityRole="link"
            accessibilityLabel={RELEASE_TITLE}
            accessibilityHint="Opens the release on ballboi.tennis"
            hitSlop={spacing.space1}
            style={({ pressed }) => ({
              minHeight: MIN_TAP,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.space2,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text variant="bodyStrong" style={{ flexShrink: 1, textDecorationLine: "underline" }}>
              {RELEASE_TITLE}
            </Text>
            {/* arrow.up.right has no brush drawing yet; the underline and hint say it opens a page. */}
          </Pressable>
          <Text tone="inkMuted">
            You're testing Ball Boi before it launches. The release explains how the matches you record are used for
            testing and training, how long they're kept, and how to withdraw.
          </Text>
          <View style={{ height: 1, backgroundColor: c.hairline, marginVertical: spacing.space1 }} />
          <Checkbox label={RELEASE_CHECKBOX} checked={releaseChecked} onChange={setReleaseChecked} />
        </Card>
      ) : null}
    </View>
  );
}

function SetupPage({ hide, setHide }: { hide: boolean; setHide: (v: boolean) => void }) {
  const c = useColors();
  return (
    <View style={{ gap: spacing.space4 }}>
      <SetupGraphic />
      <View style={{ gap: spacing.space3 }}>
        {SETUP_CHECKLIST.map((item) => (
          <View
            key={item.title}
            accessible
            accessibilityLabel={`${item.title}. ${item.detail}`}
            style={{ flexDirection: "row", gap: spacing.space3 }}
          >
            <Icon name="checkmark.circle" size={22} tintColor={c.ink} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: spacing.space1 }}>
              <Text variant="bodyStrong">{item.title}</Text>
              <Text tone="inkMuted">{item.detail}</Text>
            </View>
          </View>
        ))}
      </View>
      <Checkbox label={HIDE_SETUP} checked={hide} onChange={setHide} accessibilityHint="Setup tips on the camera screen still opens this page." />
    </View>
  );
}

/** Dots for the position: the current one filled, the rest outlined, so it's not color alone. */
function Dots({ index, count }: { index: number; count: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: spacing.space2 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.radiusPill,
            borderWidth: 1.5,
            borderColor: c.ink,
            backgroundColor: i === index ? c.ink : "transparent",
          }}
        />
      ))}
    </View>
  );
}

export function FirstRunCarousel({
  pages,
  initialTraining = true,
  release,
  onDone,
  onCancel,
  cancelLabel = "Not now",
}: {
  pages: FirstRunPage[];
  /** The account's saved training choice, so a "no" made earlier shows as off. */
  initialTraining?: boolean;
  release?: RecordingConsent["release"];
  /** Open camera, on the last page. */
  onDone: () => void;
  /** Leaves from the first page. */
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [index, setIndex] = useState(0);
  const [training, setTraining] = useState(initialTraining);
  const [releaseChecked, setReleaseChecked] = useState(false);
  const [hide, setHide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const header = useRef<React.ComponentRef<typeof View>>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const enter = useRef(new Animated.Value(1)).current;
  const direction = useRef<1 | -1>(1);
  const firstRender = useRef(true);

  const page = pages[Math.min(index, pages.length - 1)];
  const last = index >= pages.length - 1;
  const releaseNeeded = !!release?.needed;
  const canLeave = canLeavePage(page, releaseNeeded, releaseChecked);
  const title = TITLES[page];
  const position = pages.length > 1 ? pageLabel(index, pages.length) : null;

  // "Setup tips" opens with the saved choice showing.
  useEffect(() => {
    loadHideSetup().then(setHide).catch(() => {});
  }, []);

  // Each page change: slide in (or fade with Reduce Motion), scroll to the
  // top, and move VoiceOver to the heading, which reads "Page 2 of 3".
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: reduceMotion ? 180 : 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    scroll.current?.scrollTo({ y: 0, animated: false });
    const t = setTimeout(() => {
      if (header.current) AccessibilityInfo.sendAccessibilityEvent(header.current, "focus");
    }, 100);
    return () => clearTimeout(t);
  }, [index, enter, reduceMotion]);

  async function next() {
    if (saving) return;
    if (!canLeave) {
      // A swipe can't get past page 2 either; say why.
      AccessibilityInfo.announceForAccessibility(RELEASE_BLOCKED);
      return;
    }
    setError(null);
    if (page === "choices") {
      setSaving(true);
      try {
        const saved = await saveRecordingConsent(training, getToken, releaseNeeded ? release?.version : undefined);
        queryClient.setQueryData(consentKey, saved);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Couldn't save your choices. Try again.";
        setError(message);
        AccessibilityInfo.announceForAccessibility(message);
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    if (last) {
      if (page === "setup") await setHideSetup(hide);
      onDone();
      return;
    }
    direction.current = 1;
    setIndex((i) => i + 1);
  }

  function back() {
    if (saving) return;
    setError(null);
    if (index === 0) {
      onCancel();
      return;
    }
    direction.current = -1;
    setIndex((i) => i - 1);
  }

  // Swipe left for Next, right for Back. Next and Back are always on screen.
  const nav = useRef({ next, back });
  nav.current = { next, back };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderRelease: (_e, g) => {
          if (g.dx <= -SWIPE_PX) nav.current.next();
          else if (g.dx >= SWIPE_PX && index > 0) nav.current.back();
        },
      }),
    [index],
  );

  const slide = reduceMotion
    ? { opacity: enter }
    : {
        opacity: enter,
        transform: [
          { translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [direction.current * width * 0.25, 0] }) },
        ],
      };

  const primaryLabel = last ? "Open camera" : "Next";
  const secondaryLabel = index === 0 ? cancelLabel : "Back";

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }} {...pan.panHandlers}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.space6,
          paddingBottom: spacing.space6,
          paddingHorizontal: spacing.space4,
          gap: spacing.space6,
        }}
      >
        <Animated.View style={[{ gap: spacing.space6 }, slide]}>
          <View
            ref={header}
            accessible
            accessibilityRole="header"
            accessibilityLabel={position ? `${title}. ${position}` : title}
            style={{ gap: spacing.space3 }}
          >
            {position ? <Dots index={index} count={pages.length} /> : null}
            <Text variant="brushL">{title}</Text>
          </View>

          {page === "records" ? <RecordsPage /> : null}
          {page === "choices" ? (
            <ChoicesPage
              training={training}
              setTraining={setTraining}
              release={release}
              releaseChecked={releaseChecked}
              setReleaseChecked={setReleaseChecked}
            />
          ) : null}
          {page === "setup" ? <SetupPage hide={hide} setHide={setHide} /> : null}

          {error ? (
            <Text tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </Animated.View>
      </ScrollView>

      <View
        style={{
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space3,
          paddingBottom: insets.bottom + spacing.space4,
          gap: spacing.space3,
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          backgroundColor: c.paper,
        }}
      >
        <Button
          label={primaryLabel}
          loading={saving}
          disabled={!canLeave}
          accessibilityHint={!canLeave ? RELEASE_BLOCKED : undefined}
          onPress={next}
        />
        {!canLeave ? (
          <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
            {RELEASE_BLOCKED}
          </Text>
        ) : null}
        <Button variant="secondary" label={secondaryLabel} onPress={back} disabled={saving} />
      </View>
    </View>
  );
}
