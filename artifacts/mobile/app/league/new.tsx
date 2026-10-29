import { useUser } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createLeague,
  createLeagueInvite,
  getGetLeaguesQueryKey,
  getGetMyPlayersQueryKey,
  type CreateLeagueBody,
} from "@workspace/api-client-react";

import { ChoiceGroup } from "@/components/Choice";
import { Card, Field, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// Start a league (spec: Leagues > Setup and Onboarding > Run a league;
// canvas: Admin · Create league). Anyone can start one and becomes its admin.

type Format = "flex" | "round_robin";
type PlayType = "singles" | "fixed" | "rotating";
type Unplayed = "no_result" | "forfeit";

/** The next six Mondays. Pairings go out Monday mornings, so seasons start on one. */
function upcomingMondays(count = 6): Date[] {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const daysToMonday = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + daysToMonday);
  return Array.from({ length: count }, (_, i) => {
    const m = new Date(d);
    m.setDate(d.getDate() + i * 7);
    return m;
  });
}

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function HeaderButton({ label, onPress, bold, disabled }: { label: string; onPress: () => void; bold?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", opacity: disabled ? 0.4 : 1 }}
    >
      <Text variant={bold ? "bodyStrong" : "body"}>{label}</Text>
    </Pressable>
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

  const mondays = useMemo(() => upcomingMondays(), []);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [format, setFormat] = useState<Format>("flex");
  const [playType, setPlayType] = useState<PlayType>("singles");
  const [start, setStart] = useState(dateKey(mondays[0]));
  const [weeks, setWeeks] = useState(8);
  const [playoffs, setPlayoffs] = useState<0 | 4 | 8>(0);
  const [unplayed, setUnplayed] = useState<Unplayed>("no_result");
  const [playing, setPlaying] = useState(true);
  const [saving, setSaving] = useState(false);

  const playerName =
    user?.fullName?.trim() || user?.firstName?.trim() || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "";

  const canCreate = name.trim().length > 0 && !saving;

  async function create() {
    if (!canCreate) return;
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
      startDate: start,
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
          headerRight: () => <HeaderButton label="Create" bold onPress={create} disabled={!canCreate} />,
        }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space6 }}
        keyboardShouldPersistTaps="handled"
      >
        <Section title="League">
          <Field label="Name" value={name} onChangeText={setName} placeholder="Tuesday Night 3.5" maxLength={60} autoFocus />
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
          <ChoiceGroup<string>
            label="Starts"
            value={start}
            onChange={setStart}
            options={mondays.map((m) => ({ value: dateKey(m), label: shortDate(m) }))}
          />
          <ChoiceGroup<number>
            label="Weeks"
            value={weeks}
            onChange={setWeeks}
            options={[6, 7, 8, 9, 10, 11, 12].map((w) => ({ value: w, label: String(w) }))}
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
          <Switch
            value={playing}
            onValueChange={setPlaying}
            trackColor={{ true: c.court, false: c.hairlineStrong }}
            accessibilityLabel="I'm playing in this league"
          />
        </Card>
      </ScrollView>
    </>
  );
}
