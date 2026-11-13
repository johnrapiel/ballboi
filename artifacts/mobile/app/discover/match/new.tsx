// Post an open match (canvas W2_PostMatch, W2_PostMatchError; F6; brief item
// 39). Full screen with Cancel, standard iOS (coordinator call, Nov 7). Day,
// time window, Singles or Doubles (1 to 3 spots, shown as Need N), level
// range (a guide: anyone can still join), court (optional, from the
// directory) and an optional note. A time that has passed says so and stays.
// Every section is a sentence case heading (section type, ink-muted) over its
// control, with the same gap between sections (finding 44). The From and To
// pills are iOS's compact time picker, which draws its own time text.

import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderIconButton } from "@/components/Choice";
import { ChipRow, ChoiceChip } from "@/components/discover/Controls";
import { SettingsRow, SettingsSection } from "@/components/SettingsList";
import { Button, Field, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors, useScheme } from "@/hooks/useColors";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { courtPick, usePickedCourt } from "@/hooks/useCourts";
import { useDiscoverMe } from "@/hooks/useDiscover";
import { usePostOpenMatch } from "@/hooks/useDiscoverOpenMatches";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { defaultPlanStart, levelRangeText, windowEnd, type LevelRange } from "@/lib/discover";

const LEVELS: { value: LevelRange; label: string }[] = [
  { value: "close", label: "Close to mine" },
  { value: "wider", label: "Wider" },
  { value: "any", label: "Any" },
];

export default function PostOpenMatchScreen() {
  const c = useColors();
  const scheme = useScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const me = useDiscoverMe();
  const court = usePickedCourt();
  const post = usePostOpenMatch();

  const [start, setStart] = useState(() => defaultPlanStart(new Date()));
  const [end, setEnd] = useState(() => windowEnd(defaultPlanStart(new Date()), 2));
  const [format, setFormat] = useState<"singles" | "doubles">("singles");
  const [spots, setSpots] = useState(1);
  const [level, setLevel] = useState<LevelRange>("close");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    courtPick.clear();
  }, []);

  const guard = useDiscardGuard(touched, { title: "Discard this post?", message: "What you entered won't be saved." });

  const touch = () => {
    setTouched(true);
    setError(null);
  };
  const changeStart = (_: DateTimePickerEvent, d?: Date) => {
    if (!d) return;
    const length = end.getTime() - start.getTime();
    setStart(d);
    setEnd(new Date(d.getTime() + Math.max(length, 30 * 60_000)));
    touch();
  };
  const changeEnd = (_: DateTimePickerEvent, d?: Date) => {
    if (!d) return;
    const e = new Date(start);
    e.setHours(d.getHours(), d.getMinutes(), 0, 0);
    setEnd(e <= start ? new Date(e.getTime() + 86_400_000) : e);
    touch();
  };

  async function submit() {
    setError(null);
    try {
      const created = await post.mutateAsync({
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        format,
        spots: format === "doubles" ? spots : 1,
        level,
        courtId: court?.courtId ?? null,
        note: note.trim() || null,
      });
      AccessibilityInfo.announceForAccessibility("Posted. Players near you who fit can see it.");
      // The guard turns off first, so opening the post doesn't ask "Discard this post?".
      guard.finish(() => router.replace({ pathname: "/discover/match/[id]", params: { id: String(created.id) } }));
    } catch (e) {
      const message = isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Couldn't post your match. Try again.";
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    }
  }

  const picker = { themeVariant: scheme === "dark" ? ("dark" as const) : ("light" as const), accentColor: c.ink };

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen
        options={{
          title: "Post an open match",
          // Full-screen flow: Close at the top left (button standard, John, Nov 8).
          headerLeft: () => <HeaderIconButton symbol="xmark" label="Close" onPress={() => router.back()} />,
        }}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + 120, gap: spacing.space6 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: spacing.space3 }}>
          <Row label="Day">
            <DateTimePicker
              {...picker}
              value={start}
              mode="date"
              display="compact"
              minimumDate={new Date()}
              accessibilityLabel="Day"
              onChange={changeStart}
            />
          </Row>
          <Row label="From">
            <DateTimePicker
              {...picker}
              value={start}
              mode="time"
              display="compact"
              minuteInterval={15}
              accessibilityLabel="Start time"
              onChange={changeStart}
            />
          </Row>
          <Row label="To">
            <DateTimePicker
              {...picker}
              value={end}
              mode="time"
              display="compact"
              minuteInterval={15}
              accessibilityLabel="End time"
              onChange={changeEnd}
            />
          </Row>
          {error ? (
            <Text variant="small" tone="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>

        <View style={{ gap: spacing.space2 }}>
          <Text variant="section" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
            Format
          </Text>
          <ChipRow label="Format">
            <ChoiceChip label="Singles" selected={format === "singles"} onPress={() => (setFormat("singles"), touch())} />
            <ChoiceChip
              label="Doubles"
              selected={format === "doubles"}
              onPress={() => (setFormat("doubles"), setSpots((s) => Math.max(1, s)), touch())}
            />
          </ChipRow>
          {format === "doubles" ? (
            <View style={{ gap: spacing.space1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  Spots open
                </Text>
                <Stepper value={spots} onChange={(n) => (setSpots(n), touch())} />
              </View>
              <Text variant="small" tone="inkMuted">{`Shows as Need ${spots} in Open matches.`}</Text>
            </View>
          ) : (
            <Text variant="small" tone="inkMuted">
              Singles posts have 1 spot.
            </Text>
          )}
        </View>

        <View style={{ gap: spacing.space2 }}>
          <Text variant="section" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
            Level range
          </Text>
          <ChipRow label="Level range">
            {LEVELS.map((l) => (
              <ChoiceChip key={l.value} label={l.label} selected={level === l.value} onPress={() => (setLevel(l.value), touch())} />
            ))}
          </ChipRow>
          <Text variant="small" tone="inkMuted">{`${levelRangeText(me.data?.rating ?? null, level)} A guide: anyone can still join.`}</Text>
        </View>

        {/* Heading + control, like every other section here (finding 44): the
            row shows only the court, so it doesn't read as part of Level range. */}
        <View style={{ gap: spacing.space2 }}>
          <Text variant="section" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
            Court (optional)
          </Text>
          <SettingsSection>
            <SettingsRow
              title={court ? court.name : "Not set"}
              onPress={() => {
                touch();
                router.push({ pathname: "/courts", params: { mode: "match" } });
              }}
              accessibilityLabel={`Court, ${court ? court.name : "Not set"}`}
              accessibilityHint="Pick from the court directory, or leave it not set"
              last
            />
          </SettingsSection>
        </View>

        <Field
          label="Note (optional)"
          labelVariant="section"
          value={note}
          onChangeText={(t) => (setNote(t.slice(0, 200)), touch())}
          multiline
          maxLength={200}
          placeholder="Bring balls, warm-up first…"
          style={{ minHeight: 72, paddingTop: spacing.space3, textAlignVertical: "top" }}
        />
      </ScrollView>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space3,
          paddingBottom: insets.bottom + spacing.space3,
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          backgroundColor: c.paper,
        }}
      >
        <Button label="Post" onPress={() => void submit()} loading={post.isPending} />
      </View>
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.space2,
        minHeight: MIN_TAP,
      }}
    >
      <Text variant="bodyStrong">{label}</Text>
      {children}
    </View>
  );
}

/** − 2 spots +, 1 to 3. VoiceOver adjusts it like any iOS stepper. */
function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const c = useColors();
  const btn = (label: string, symbol: string, to: number, disabled: boolean) => (
    <Pressable
      onPress={() => onChange(to)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: MIN_TAP,
        height: MIN_TAP,
        borderRadius: radius.radiusPill,
        borderWidth: 1,
        borderColor: c.hairlineStrong,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text variant="bodyStrong">{symbol}</Text>
    </Pressable>
  );
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Spots open"
      accessibilityValue={{ min: 1, max: 3, now: value, text: `${value} ${value === 1 ? "spot" : "spots"}` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => onChange(Math.min(3, Math.max(1, value + (e.nativeEvent.actionName === "increment" ? 1 : -1))))}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}
    >
      {btn("Fewer spots", "−", value - 1, value <= 1)}
      <Text variant="bodyStrong" style={{ minWidth: 56, textAlign: "center" }}>{`${value} ${value === 1 ? "spot" : "spots"}`}</Text>
      {btn("More spots", "+", value + 1, value >= 3)}
    </View>
  );
}
