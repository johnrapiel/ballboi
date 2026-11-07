import { useUser } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React, { useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, TextInput, View, useColorScheme } from "react-native";

import {
  createLeague,
  createLeagueInvite,
  getGetLeaguesQueryKey,
  getGetMyPlayersQueryKey,
  type CreateLeagueBody,
} from "@workspace/api-client-react";

import { MatchTimeFields, hhmm, timeFromHHMM } from "@/components/league/MatchTimeFields";
import { SegmentedTabs } from "@/components/league/SegmentedTabs";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { phoneTimeZone } from "@/lib/leagueSchedule";
import { MAX_WEEKS, MIN_WEEKS, readWeeks } from "@/lib/scoreEntry";
import { Button, Card, Field, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";
import { Toggle } from "@/components/Toggle";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";

// Start a league (spec: Leagues > Setup and Onboarding > Run a league;
// approved canvas: Admin · Create league, a tall sheet with a brush title and
// Create league at the bottom; no Cancel, per the sheet rule: drag down to
// close, and it asks before discarding). Anyone can start one and becomes its admin.
// Singles only for now (Q2). A season starts tomorrow at the earliest (Q7), so a
// friend who joins on the day it's made is in from round 1.

type Format = "flex" | "round_robin";

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
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.space3 }}>
        <Text style={{ flexGrow: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
          Season length
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
          <StepButton symbol="−" label="Shorter season" onPress={() => set(weeks - 1)} disabled={weeks <= MIN_WEEKS} />
          <TextInput
            value={text}
            onChangeText={(t) => onTextChange(t.replace(/[^0-9]/g, "").slice(0, 2))}
            onBlur={onDone}
            onSubmitEditing={onDone}
            keyboardType="number-pad"
            returnKeyType="done"
            selectTextOnFocus
            accessibilityLabel="Season length in weeks"
            accessibilityHint={`${MIN_WEEKS} to ${MAX_WEEKS} weeks`}
            style={[
              type.body,
              {
                minHeight: MIN_TAP,
                minWidth: 56,
                paddingHorizontal: spacing.space2,
                textAlign: "center",
                borderRadius: radius.radiusMd,
                borderWidth: 1,
                borderColor: c.hairlineStrong,
                backgroundColor: c.linen,
                color: c.ink,
                fontVariant: ["lining-nums", "tabular-nums"],
              },
            ]}
          />
          <StepButton symbol="+" label="Longer season" onPress={() => set(weeks + 1)} disabled={weeks >= MAX_WEEKS} />
        </View>
      </View>
      <Text variant="small" tone={note ? "ink" : "inkMuted"} accessibilityLiveRegion="polite">
        {note ?? `${weeks === 1 ? "1 week" : `${weeks} weeks`}. ${MIN_WEEKS} to ${MAX_WEEKS} weeks.`}
      </Text>
    </View>
  );
}

/** A sentence case section label over a card (approved canvas). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
        {title}
      </Text>
      <Card style={{ gap: spacing.space4 }}>{children}</Card>
    </View>
  );
}

/** A choice as the condensed segmented control, with its label and a line under it. */
function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hint?: string;
}) {
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="bodyStrong" importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      <SegmentedTabs choice label={label} value={value} onChange={onChange} tabs={options} />
      {hint ? (
        <Text variant="small" tone="inkMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export default function StartLeagueScreen() {
  const c = useColors();
  const router = useRouter();
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
  const [playoffs, setPlayoffs] = useState<"0" | "4" | "8">("0");
  const [playing, setPlaying] = useState(true);
  const [setTime, setSetTime] = useState(false);
  const [matchDay, setMatchDay] = useState<number>(() => nextMonday().getDay());
  const [matchClock, setMatchClock] = useState<Date>(() => timeFromHHMM(null));
  const [saving, setSaving] = useState(false);
  const [nameMissing, setNameMissing] = useState(false);
  // Anything typed or changed: closing the sheet asks first.
  const dirty =
    name.trim() !== "" ||
    location.trim() !== "" ||
    format !== "flex" ||
    weeks !== DEFAULT_WEEKS ||
    playoffs !== "0" ||
    !playing ||
    setTime ||
    dateKey(start) !== dateKey(nextMonday());
  const sheet = useSheetClose(dirty && !saving);

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
      // Open leagues (listed in Discover, with join requests) come back once
      // Discover and join requests are built. Until then every league is private.
      visibility: "private",
      minRating: null,
      maxRating: null,
      rosterCap: null,
      startDate: dateKey(start),
      seasonWeeks: weeks,
      playoffSize: Number(playoffs) as 0 | 4 | 8,
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
      sheet.finish(() => router.replace({ pathname: "/league/invite/[leagueId]", params: { leagueId: String(league.id) } }));
    } catch (e) {
      setSaving(false);
      const message = (e as { data?: { error?: string } }).data?.error;
      Alert.alert("Couldn't start the league", message ?? "Something went wrong. Try again in a moment.");
    }
  }

  return (
    <SheetBody
      title="New league"
      close={sheet.close}
      fill
      scrollRef={scrollRef}
      contentStyle={{ gap: spacing.space6 }}
      footer={<Button label="Create league" onPress={create} loading={saving} />}
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
        <Field label="Where you play (optional)" value={location} onChangeText={setLocation} placeholder="Beacon Courts" />
      </Section>

      <Section title="How it works">
        <Choice<Format>
          label="Format"
          value={format}
          onChange={setFormat}
          options={[
            { value: "flex", label: "Flex" },
            { value: "round_robin", label: "Round robin" },
          ]}
          hint={
            format === "flex"
              ? `Flex: we pair players every ${weekday(start)} by level and who hasn't played whom.`
              : "Round robin: you play someone new each week."
          }
        />
        <Text variant="small" tone="inkMuted">
          Each round runs a week. Unplayed matches get a 1-week grace period: scores then count for Ball Boi stats, not standings.
        </Text>
        <Text variant="small" tone="inkMuted">
          Players join with your invite link or code.
        </Text>
      </Section>

      <Section title="Season">
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.space3 }}>
          <Text importantForAccessibility="no" accessibilityElementsHidden>
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
        <Choice<"0" | "4" | "8">
          label="Playoffs"
          value={playoffs}
          onChange={setPlayoffs}
          options={[
            { value: "0", label: "None" },
            { value: "4", label: "Top 4" },
            { value: "8", label: "Top 8" },
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
        <Toggle value={playing} onValueChange={setPlaying} accessibilityLabel="I'm playing in this league" />
      </Card>

      <Text variant="small" tone="inkMuted" style={{ paddingHorizontal: spacing.space1 }}>
        Standings rank by wins. Next you'll get an invite code to share.
      </Text>
    </SheetBody>
  );
}
