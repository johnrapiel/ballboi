import { useUser } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React, { useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, TextInput, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createLeague,
  createLeagueInvite,
  getGetLeaguesQueryKey,
  getGetMyPlayersQueryKey,
  type CreateLeagueBody,
} from "@workspace/api-client-react";

import { ChoiceGroup } from "@/components/Choice";
import { Button, Card, Field, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// Start a league (spec: Leagues > Setup and Onboarding > Run a league;
// canvas: Admin · Create league). Anyone can start one and becomes its admin.

type Format = "flex" | "round_robin";
type PlayType = "singles" | "fixed" | "rotating";
type Unplayed = "no_result" | "forfeit";

// Season length limits match the spec (Leagues > Setup: 1 to 24 weeks) and the API.
const MIN_WEEKS = 1;
const MAX_WEEKS = 24;
const DEFAULT_WEEKS = 8;

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Default start: next Monday, since Flex pairings go out Monday mornings. Any day can be picked. */
function nextMonday(): Date {
  const d = today();
  const daysToMonday = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + daysToMonday);
  return d;
}

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

/** Weeks: a number field with minus and plus. Typing is clamped to the allowed range on blur. */
function WeeksStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const c = useColors();
  const [draft, setDraft] = useState(String(value));
  const set = (n: number) => {
    const next = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, n));
    onChange(next);
    setDraft(String(next));
  };
  return (
    <View style={{ gap: spacing.space2 }}>
      <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
        Weeks
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
        <StepButton symbol="−" label="Fewer weeks" onPress={() => set(value - 1)} disabled={value <= MIN_WEEKS} />
        <TextInput
          value={draft}
          onChangeText={(t) => setDraft(t.replace(/[^0-9]/g, "").slice(0, 2))}
          onBlur={() => set(Number(draft) || value)}
          onSubmitEditing={() => set(Number(draft) || value)}
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
        <StepButton symbol="+" label="More weeks" onPress={() => set(value + 1)} disabled={value >= MAX_WEEKS} />
      </View>
      <Text variant="small" tone="inkMuted">
        {MIN_WEEKS} to {MAX_WEEKS} weeks
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
  const minStart = useMemo(today, []);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [format, setFormat] = useState<Format>("flex");
  const [playType, setPlayType] = useState<PlayType>("singles");
  const [start, setStart] = useState<Date>(nextMonday);
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);
  const [playoffs, setPlayoffs] = useState<0 | 4 | 8>(0);
  const [unplayed, setUnplayed] = useState<Unplayed>("no_result");
  const [playing, setPlaying] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nameMissing, setNameMissing] = useState(false);

  const playerName =
    user?.fullName?.trim() || user?.firstName?.trim() || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "";

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
      leagueType: playType === "singles" ? "singles" : "doubles",
      partnerMode: playType === "singles" ? null : playType,
      // Open leagues (listed in Discover, with join requests) come back once
      // Discover and join requests are built. Until then every league is private.
      visibility: "private",
      minRating: null,
      maxRating: null,
      rosterCap: null,
      startDate: dateKey(start),
      seasonWeeks: weeks,
      playoffSize: playoffs,
      unplayedRule: unplayed,
      location: location.trim() || null,
      playing,
      playerName: playing ? playerName || "Admin" : null,
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
                ? "We pair players every Monday by rating, availability, and who hasn't played whom."
                : "Everyone plays everyone once over the season."
            }
          />
          <ChoiceGroup<PlayType>
            label="Play"
            value={playType}
            onChange={setPlayType}
            options={[
              { value: "singles", label: "Singles" },
              { value: "fixed", label: "Doubles, fixed partners" },
              { value: "rotating", label: "Doubles, rotating partners" },
            ]}
          />
          <ChoiceGroup<Unplayed>
            label="Unplayed matches"
            value={unplayed}
            onChange={setUnplayed}
            options={[
              { value: "no_result", label: "No result" },
              { value: "forfeit", label: "Forfeit" },
            ]}
            hint={
              unplayed === "no_result"
                ? "Matches not played by Sunday night don't count for either player."
                : "Matches not played by Sunday night count as a forfeit."
            }
          />
        </Section>

        <Section title="Who can join">
          <Text>Players join with your invite link or code.</Text>
        </Section>

        <Section title="Season">
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.space3 }}>
            <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
              Starts
            </Text>
            {/* Native iOS date button: tap for the calendar, any day from today on. */}
            <DateTimePicker
              value={start}
              mode="date"
              display="compact"
              minimumDate={minStart}
              themeVariant={scheme === "dark" ? "dark" : "light"}
              accentColor={c.pool}
              accessibilityLabel="Season starts"
              onChange={(_: DateTimePickerEvent, date?: Date) => {
                if (date) {
                  date.setHours(0, 0, 0, 0);
                  setStart(date);
                }
              }}
            />
          </View>
          <WeeksStepper value={weeks} onChange={setWeeks} />
          <Text variant="small" tone="inkMuted" accessibilityLiveRegion="polite">
            Runs {shortDate(start)} to {shortDate(end)}
          </Text>
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
          <Switch
            value={playing}
            onValueChange={setPlaying}
            trackColor={{ true: c.court, false: c.hairlineStrong }}
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
