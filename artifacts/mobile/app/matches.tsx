import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { DiscoverMatchesSection } from "@/components/discover/DiscoverMatches";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React, { useCallback, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetMyLeagueWeek } from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { ResultRow } from "@/components/ResultRow";
import { SeasonStats } from "@/components/SeasonStats";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { deadlineDate } from "@/lib/leagueSchedule";
import { upcomingMatches, type UpcomingMatch } from "@/lib/myMatches";

// My matches (finding 14; approved design audit, My Matches, Nov 6). Opened
// from See all on Home. A brush title, your season on one line, then light
// text tabs for Upcoming and Results, each showing only its own matches. The
// next match is a condensed version of Home's card; later ones are rows.
// Results show W or L and open Match detail. Upcoming matches open their
// league, where the score, time and messages live, as on Home.

type Tab = "upcoming" | "results";

const dayLong = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const dayShort = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** When to play, in words: the set time, or the play-by date. */
function whenLine(m: UpcomingMatch, long: boolean): string {
  if (m.scheduledAt) return long ? dayLong(m.scheduledAt) : `${dayShort(m.scheduledAt)}, ${timeOf(m.scheduledAt)}`;
  return m.playBy ? `Play by ${deadlineDate(m.playBy, m.timeZone)}` : "Time not set yet";
}

function LightTabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const c = useColors();
  const tabs: { key: Tab; label: string }[] = [
    { key: "upcoming", label: "Upcoming" },
    { key: "results", label: "Results" },
  ];
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.space6 }}>
      {tabs.map((t, i) => {
        const on = t.key === tab;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            accessibilityHint={`Tab ${i + 1} of ${tabs.length}`}
            style={({ pressed }) => ({ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            {/* Selected in ink, semibold and underlined; the other in muted text. Never color alone. */}
            <Text
              variant={on ? "bodyStrong" : "body"}
              tone={on ? "ink" : "inkMuted"}
              style={on ? { textDecorationLine: "underline", textDecorationColor: c.ink } : undefined}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The next match: a condensed version of Home's soft card, everything centred. */
function NextMatch({ m, onOpen }: { m: UpcomingMatch; onOpen: () => void }) {
  const c = useColors();
  const head = [whenLine(m, true), m.leagueName].join(" · ");
  const spoken = [`Next match. You versus ${m.opponentName}`, whenLine(m, true), m.scheduledAt ? timeOf(m.scheduledAt) : null, m.location, m.leagueName, m.stage]
    .filter(Boolean)
    .join(". ");
  return (
    <Card style={{ borderWidth: 0, paddingVertical: spacing.space4, gap: spacing.space3 }}>
      <View accessible accessibilityLabel={spoken} style={{ alignItems: "center", gap: spacing.space1 }}>
        <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
          {head}
        </Text>
        {m.scheduledAt ? (
          <Text variant="scoreRow" style={{ textAlign: "center", fontVariant: ["lining-nums", "tabular-nums"] }}>
            {timeOf(m.scheduledAt)}
          </Text>
        ) : null}
        <View style={{ marginTop: spacing.space1 }}>
          <Avatar name={m.opponentName} size={40} />
        </View>
        <Text variant="bodyStrong" style={{ textAlign: "center" }}>
          You <Text tone="inkMuted">vs.</Text> {m.opponentName}
        </Text>
        {m.location ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space1 }}>
            <SymbolView name="mappin.and.ellipse" size={16} tintColor={c.inkMuted} />
            <Text style={{ flexShrink: 1, textAlign: "center" }}>{m.location}</Text>
          </View>
        ) : null}
      </View>
      <Button label="Details" variant="secondary" accessibilityLabel={`Details for your match against ${m.opponentName}`} accessibilityHint="Opens the league" onPress={onOpen} />
    </Card>
  );
}

function UpcomingRow({ m, last, onPress }: { m: UpcomingMatch; last: boolean; onPress: () => void }) {
  const c = useColors();
  const meta = [whenLine(m, false), m.location].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.opponentName}. ${meta.replace(/·/g, ",")}. ${m.leagueName}`}
      accessibilityHint="Opens the league"
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Avatar name={m.opponentName} size={36} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{m.opponentName}</Text>
        <Text variant="small" tone="inkMuted">
          {meta}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={13} tintColor={c.inkMuted} />
    </Pressable>
  );
}

/** An empty tab: what shows up here, and a way forward. */
function Empty({ symbol, title, message, action }: { symbol: SFSymbol; title: string; message: string; action: { label: string; onPress: () => void } }) {
  const c = useColors();
  return (
    <View style={{ alignItems: "center", gap: spacing.space2, paddingVertical: spacing.space8, paddingHorizontal: spacing.space4 }}>
      <View accessible accessibilityLabel={`${title}. ${message}`} style={{ alignItems: "center", gap: spacing.space2 }}>
        <SymbolView name={symbol} size={40} tintColor={c.inkMuted} style={{ marginBottom: spacing.space2 }} />
        <Text variant="title" style={{ textAlign: "center" }}>
          {title}
        </Text>
        <Text tone="inkMuted" style={{ textAlign: "center" }}>
          {message}
        </Text>
      </View>
      <Button label={action.label} variant="secondary" onPress={action.onPress} style={{ marginTop: spacing.space3, alignSelf: "stretch" }} />
    </View>
  );
}

export default function MyMatchesScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "results" ? "results" : "upcoming");
  const weekQ = useGetMyLeagueWeek();
  const week = weekQ.data;
  const { refetch } = weekQ;
  const firstFocus = useRef(true);
  // Back from Match detail after an edit: show the latest.
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );

  const upcoming = upcomingMatches(week);
  const results = week?.results ?? [];
  const openLeague = (leagueId: number) => router.push(`/league/${leagueId}`);
  const goToLeagues = () => router.navigate("/(tabs)/leagues");
  const switchTab = (t: Tab) => {
    setTab(t);
    AccessibilityInfo.announceForAccessibility(t === "upcoming" ? `Upcoming, ${upcoming.length} matches` : `Results, ${results.length} matches`);
  };

  let body: React.ReactNode;
  if (weekQ.isLoading) {
    body = <ActivityIndicator color={c.ink} accessibilityLabel="Loading your matches" style={{ marginTop: spacing.space8 }} />;
  } else if (!week) {
    body = (
      <Card style={{ gap: spacing.space3 }}>
        <Text variant="bodyStrong">Couldn't load your matches</Text>
        <Text variant="small" tone="inkMuted">
          Check your connection and try again.
        </Text>
        <Button label="Try again" variant="secondary" loading={weekQ.isRefetching} onPress={() => void refetch()} />
      </Card>
    );
  } else {
    body = (
      <>
        <SeasonStats season={week.season} played />
        <LightTabs tab={tab} onChange={switchTab} />
        {/* Matches set up in a Discover chat (Wave 2, Session F). */}
        {tab === "upcoming" ? <DiscoverMatchesSection /> : null}
        {tab === "upcoming" ? (
          upcoming.length === 0 ? (
            <Empty
              symbol="calendar"
              title="No upcoming matches"
              message="Your next league match shows up here once its pairings go out."
              action={{ label: "Go to Leagues", onPress: goToLeagues }}
            />
          ) : (
            <View style={{ gap: spacing.space3 }}>
              <NextMatch m={upcoming[0]} onOpen={() => openLeague(upcoming[0].leagueId)} />
              {upcoming.length > 1 ? (
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  {upcoming.slice(1).map((m, n, rest) => (
                    <UpcomingRow key={m.key} m={m} last={n === rest.length - 1} onPress={() => openLeague(m.leagueId)} />
                  ))}
                </Card>
              ) : null}
            </View>
          )
        ) : results.length === 0 ? (
          <Empty
            symbol="list.bullet"
            title="No results yet"
            message="Once you or your opponent enters a score, the result shows up here."
            action={upcoming.length ? { label: "See upcoming matches", onPress: () => switchTab("upcoming") } : { label: "Go to Leagues", onPress: goToLeagues }}
          />
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {results.map((r, n) => (
              <ResultRow key={r.matchId} r={r} last={n === results.length - 1} onPress={() => router.push(`/match/${r.matchId}`)} />
            ))}
          </Card>
        )}
      </>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space4 }}
      refreshControl={<RefreshControl refreshing={weekQ.isRefetching} onRefresh={() => void refetch()} tintColor={c.ink} />}
    >
      <Text variant="brushL" accessibilityRole="header">
        My matches
      </Text>
      {weekQ.isError && week ? (
        <Card style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong">Couldn't refresh your matches</Text>
          <Text variant="small" tone="inkMuted">
            Pull down to try again.
          </Text>
        </Card>
      ) : null}
      {body}
    </ScrollView>
  );
}
