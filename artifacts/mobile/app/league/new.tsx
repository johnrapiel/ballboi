import { useUser } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React, { useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, TextInput, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createLeague,
  createLeagueInvite,
  getGetLeaguesQueryKey,
  getGetMyPlayersQueryKey,
  type CreateLeagueBody,
} from "@workspace/api-client-react";

import { ChoiceGroup } from "@/components/Choice";
import { MatchTimeFields, hhmm, timeFromHHMM } from "@/components/league/MatchTimeFields";
import { phoneTimeZone } from "@/lib/leagueSchedule";
import { MAX_WEEKS, MIN_WEEKS, readWeeks } from "@/lib/scoreEntry";
import { Button, Card, Field, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";
import { Toggle } from "@/components/Toggle";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";

// Start a league (spec: Leagues > Setup and Onboarding > Run a league;
// canvas: Admin · Create league). Anyone can start one and becomes its admin.
// Singles only for now (Q2). A season starts tomorrow at the earliest (Q7), so a
// friend who joins on the day it's made is in from round 1. Private or Open
// (Wave 2): an Open league is listed in Discover and takes join requests.

type Format = "flex" | "round_robin";

// Open leagues: a level range and an optional roster cap (spec: Leagues > Setup, Eligibility).
const LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"] as const;
type Level = (typeof LEVELS)[number];
const CAPS = [0, 8, 12, 16, 24] as const;
type Cap = (typeof CAPS)[number];

// Season length limits match the spec (Leagues > Setup: 1 to 24 weeks) and the API.
const DEFAULT_WEEKS = 8;

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const tomorrow = () => {
  const d = today();
  d.setDate(d.getDate() + 1);
  return d;
};

/** Default start: next Monday. Any day from tomorrow can be picked; pairings go out on the start weekday each week (decision 29). */
function nextMonday(): Date {
  const d = today();
  const daysToMonday = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + daysToMonday);
  return d;
}

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const weekday = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long" });
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function HeaderButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center" }}
    >
      <Text>{label}</Text>
    </Pressable>
  );
}

/** Round minus or plus button for the weeks stepper, 44×44pt. */
function StepButton({ symbol, label, onPress, disabled }: { symbol: string; label: string; onPress: () => void; disabled: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
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
      <Text variant="bodyStrong" importantForAccessibility="no" accessibilityElementsHidden>
        {symbol}
      </Text>
    </Pressable>
  );
}

/**
 * Weeks: a number field with minus and plus. The season length follows the
 * field as you type (C8); 30 or 0 snap to 24 or 1 with a note.
 */
function WeeksStepper({
  text,
  onTextChange,
  onDone,
  weeks,
  note,
}: {
  text: string;
  onTextChange: (t: string) => void;
  /** The field lost focus: show the length it snapped to. */
  onDone: () => void;
  weeks: number;
  note: string | null;
}) {
  const c = useColors();
  const set = (n: number) => onTextChange(String(Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, n))));
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
        Weeks
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
        <StepButton symbol="−" label="Fewer weeks" onPress={() => set(weeks - 1)} disabled={weeks <= MIN_WEEKS} />
        <TextInput
          value={text}
          onChangeText={(t) => onTextChange(t.replace(/[^0-9]/g, "").slice(0, 2))}
          onBlur={onDone}
          onSubmitEditing={onDone}
          keyboardType="number-pad"
          returnKeyType="done"
          selectTextOnFocus
          accessibilityLabel="Weeks"
          accessibilityHint={`${MIN_WEEKS} to ${MAX_WEEKS} weeks`}
          style={[
            type.body,
            {
              minHeight: 48,
              minWidth: 72,
              paddingHorizontal: 14,
              textAlign: "center",
              borderRadius: radius.radiusSm,
              borderWidth: 1,
              borderColor: c.hairlineStrong,
              backgroundColor: c.linen,
              color: c.ink,
            },
          ]}
        />
        <StepButton symbol="+" label="More weeks" onPress={() => set(weeks + 1)} disabled={weeks >= MAX_WEEKS} />
      </View>
      <Text variant="small" tone={note ? "ink" : "inkMuted"} accessibilityLiveRegion="polite">
        {note ?? `${MIN_WEEKS} to ${MAX_WEEKS} weeks`}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="label" tone="inkMuted" accessibilityRole="header">
        {title}
      </Text>
      <Card style={{ gap: spacing.space4 }}>{children}</Card>
    </View>
  );
}

export default function StartLeagueScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useUser();

  const scheme = useColorScheme();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const minStart = useMemo(tomorrow, []);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [format, setFormat] = useState<Format>("flex");
  const [start, setStart] = useState<Date>(nextMonday);
  const [weeksText, setWeeksText] = useState(String(DEFAULT_WEEKS));
  const lastWeeks = useRef(DEFAULT_WEEKS);
  const typedWeeks = readWeeks(weeksText);
  if (typedWeeks.weeks != null) lastWeeks.current = typedWeeks.weeks;
  // A blank field keeps the last length until something is typed.
  const weeks = typedWeeks.weeks ?? lastWeeks.current;
  // The note stays after the field snaps (30 shows 24), until the next edit.
  const [snapNote, setSnapNote] = useState<string | null>(null);
  const editWeeks = (t: string) => {
    setSnapNote(null);
    setWeeksText(t);
  };
  const snapWeeks = () => {
    if (typedWeeks.note) setSnapNote(typedWeeks.note);
    setWeeksText(String(weeks));
  };
  const [playoffs, setPlayoffs] = useState<0 | 4 | 8>(0);
  // Who can join (spec: Leagues > Setup, Visibility and Eligibility).
  const [visibility, setVisibility] = useState<"private" | "open">("private");
  const [minLevel, setMinLevel] = useState<Level | "any">("any");
  const [maxLevel, setMaxLevel] = useState<Level | "any">("any");
  const [cap, setCap] = useState<Cap>(0);
  const pickMin = (v: Level | "any") => {
    setMinLevel(v);
    if (v !== "any" && maxLevel !== "any" && Number(maxLevel) < Number(v)) setMaxLevel(v);
  };
  const pickMax = (v: Level | "any") => {
    setMaxLevel(v);
    if (v !== "any" && minLevel !== "any" && Number(minLevel) > Number(v)) setMinLevel(v);
  };
  const [playing, setPlaying] = useState(true);
  const [setTime, setSetTime] = useState(false);
  const [matchDay, setMatchDay] = useState<number>(() => nextMonday().getDay());
  const [matchClock, setMatchClock] = useState<Date>(() => timeFromHHMM(null));
  const [saving, setSaving] = useState(false);
  const [nameMissing, setNameMissing] = useState(false);

  // A1: the league shows the profile name, never any part of the email. The
  // API uses the saved profile too; this is only its fallback.
  const { profile } = useProfile();
  const playerName = profile?.displayName?.trim() || user?.fullName?.trim() || "";

  const end = new Date(start);
  end.setDate(end.getDate() + weeks * 7 - 1);

  async function create() {
    if (saving) return;
    if (!name.trim()) {
      setNameMissing(true);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setSaving(true);
    const body: CreateLeagueBody = {
      name: name.trim(),
      format,
      // Q2: doubles leagues come later.
      leagueType: "singles",
      partnerMode: null,
      // Open leagues are listed in Discover near the admin's home area and take join requests.
      visibility,
      minRating: visibility === "open" && minLevel !== "any" ? minLevel : null,
      maxRating: visibility === "open" && maxLevel !== "any" ? maxLevel : null,
      rosterCap: visibility === "open" && cap ? cap : null,
      startDate: dateKey(start),
      seasonWeeks: weeks,
      playoffSize: playoffs,
      location: location.trim() || null,
      playing,
      playerName: playing ? playerName || "Admin" : null,
      // The league runs on this phone's time zone (PR 4).
      timeZone: phoneTimeZone() || null,
      matchDay: setTime ? matchDay : null,
      matchTime: setTime ? hhmm(matchClock) : null,
    };
    try {
      const league = await createLeague(body);
      // Every league gets an invite code right away, so the admin can share it.
      await createLeagueInvite(league.id, {}).catch(() => undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetLeaguesQueryKey().slice(0, 1) }),
        queryClient.invalidateQueries({ queryKey: getGetMyPlayersQueryKey() }),
      ]);
      router.replace({ pathname: "/league/invite/[leagueId]", params: { leagueId: String(league.id) } });
    } catch (e) {
      setSaving(false);
      const message = (e as { data?: { error?: string } }).data?.error;
      Alert.alert("Couldn't start the league", message ?? "Something went wrong. Try again in a moment.");
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => <HeaderButton label="Cancel" onPress={() => router.back()} />,
        }}
      />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: spacing.space8, gap: spacing.space6 }}
        keyboardShouldPersistTaps="handled"
      >
        <Section title="League">
          <Field
            label="Name"
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (t.trim()) setNameMissing(false);
            }}
            placeholder="Tuesday Night 3.5"
            maxLength={60}
            autoFocus
            error={nameMissing}
            hint={nameMissing ? "Give your league a name to create it." : undefined}
          />
          <Field
            label="Where you play (optional)"
            value={location}
            onChangeText={setLocation}
            placeholder="Beacon Courts"
          />
        </Section>

        <Section title="How it works">
          <ChoiceGroup<Format>
            label="Format"
            value={format}
            onChange={setFormat}
            options={[
              { value: "flex", label: "Flex" },
              { value: "round_robin", label: "Round robin" },
            ]}
            hint={
              format === "flex"
                ? `We pair players every ${weekday(start)} by level and who hasn't played whom.`
                : "Pairs you with someone new each week."
            }
          />
          <Text variant="small" tone="inkMuted">
            Each round runs a week. Unplayed matches get a 1-week grace period: scores then count for Ball Boi stats, not standings.
          </Text>
        </Section>

        <Section title="Who can join">
          <ChoiceGroup<"private" | "open">
            label="Visibility"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: "private", label: "Private" },
              { value: "open", label: "Open" },
            ]}
            hint={
              visibility === "private"
                ? "Players join with your invite link or code."
                : "Listed in Discover for players near your home area. They ask to join, and you approve them in Manage. Your invite link works too."
            }
          />
          {visibility === "open" ? (
            <>
              <ChoiceGroup<Level | "any">
                label="Lowest level"
                value={minLevel}
                onChange={pickMin}
                options={[{ value: "any" as const, label: "Any" }, ...LEVELS.map((l) => ({ value: l, label: l, accessibilityLabel: `Level ${l}` }))]}
              />
              <ChoiceGroup<Level | "any">
                label="Highest level"
                value={maxLevel}
                onChange={pickMax}
                options={[{ value: "any" as const, label: "Any" }, ...LEVELS.map((l) => ({ value: l, label: l, accessibilityLabel: `Level ${l}` }))]}
              />
              <ChoiceGroup<Cap>
                label="Spots"
                value={cap}
                onChange={setCap}
                options={CAPS.map((n) => (n ? { value: n, label: String(n), accessibilityLabel: `${n} players` } : { value: n, label: "No limit" }))}
                hint={cap ? "Once it's full, requests wait on a list for next season." : "Requests wait on a list for next season once it starts."}
              />
            </>
          ) : null}
        </Section>

        <Section title="Season">
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.space3 }}>
            <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
              Starts
            </Text>
            {/* Native iOS date button: tap for the calendar, any day from tomorrow on. */}
            <DateTimePicker
              value={start}
              mode="date"
              display="compact"
              minimumDate={minStart}
              themeVariant={scheme === "dark" ? "dark" : "light"}
              accentColor={c.court}
              accessibilityLabel="Season starts"
              onChange={(_: DateTimePickerEvent, date?: Date) => {
                if (date) {
                  date.setHours(0, 0, 0, 0);
                  setStart(date);
                }
              }}
            />
          </View>
          <WeeksStepper text={weeksText} onTextChange={editWeeks} onDone={snapWeeks} weeks={weeks} note={typedWeeks.note ?? snapNote} />
          <Text variant="small" tone="inkMuted" accessibilityLiveRegion="polite">
            Runs {shortDate(start)} to {shortDate(end)}
          </Text>
          <MatchTimeFields
            enabled={setTime}
            onEnabledChange={(on) => {
              // Start on the season's weekday, the day pairings go out.
              if (on && !setTime) setMatchDay(start.getDay());
              setSetTime(on);
            }}
            day={matchDay}
            onDayChange={setMatchDay}
            time={matchClock}
            onTimeChange={setMatchClock}
          />
          <ChoiceGroup<0 | 4 | 8>
            label="Playoffs"
            value={playoffs}
            onChange={setPlayoffs}
            options={[
              { value: 0, label: "None" },
              { value: 4, label: "Top 4" },
              { value: 8, label: "Top 8" },
            ]}
          />
        </Section>

        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">I'm playing in this league</Text>
            <Text variant="small" tone="inkMuted">
              {playing ? "You'll be paired like everyone else." : "You'll run the league without playing."}
            </Text>
          </View>
          <Toggle
            value={playing}
            onValueChange={setPlaying}
            accessibilityLabel="I'm playing in this league"
          />
        </Card>
      </ScrollView>
      {/* Primary action pinned at the bottom, always in reach. */}
      <View
        style={{
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space3,
          paddingBottom: insets.bottom + spacing.space3,
          backgroundColor: c.paper,
          borderTopWidth: 1,
          borderTopColor: c.hairline,
        }}
      >
        <Button label="Create league" onPress={create} loading={saving} />
      </View>
    </>
  );
}
