import { useUser } from "@clerk/expo";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetLeagueStandingsQueryOptions,
  useDismissMyJoinRequest,
  useDismissMyLeagueNotice,
  useGetLeagues,
  useGetMyJoinRequests,
  useGetMyLeagueNotices,
  useGetMyPlayers,
  type League,
  type MyJoinRequest,
  type Standing,
} from "@workspace/api-client-react";

import { IconButton } from "@/components/Choice";
import { EmptyState } from "@/components/EmptyState";
import { discoverState } from "@/hooks/useDiscoverFilters";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Chip, Pill, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { formatLabel, isPastLeague, ordinal, pastLabel, playersLabel, playTypeLabel, statusLabel } from "@/lib/leagues";

// Leagues tab (spec: Leagues; approved canvas: Leagues, John, Nov 5). Notes
// about deleted leagues, your current leagues as soft cards with your season
// on one line, leagues you've asked to join (decision 30), finished and ended
// leagues under Past leagues (decision 31) as chevron rows, and a "Got an
// invite code?" text link that opens the invite code sheet (app/league/join.tsx).
// Open leagues are found in Discover, not here. Start a league opens from the
// + button and from the empty state.

// Standings rank on wins, then head to head (John, Nov 6), so "behind" counts wins.
type MyStanding = { rank: number; wins: number; losses: number; behind: number; lead: number } | null;

function myStanding(standings: Standing[] | undefined, myPlayerId: number | undefined): MyStanding {
  if (!standings || myPlayerId === undefined) return null;
  const mine = standings.find((s) => s.playerId === myPlayerId);
  if (!mine) return null;
  const leader = standings.reduce((max, s) => Math.max(max, s.wins), 0);
  const nextBest = standings.filter((s) => s.playerId !== myPlayerId).reduce((max, s) => Math.max(max, s.wins), 0);
  return { rank: mine.rank, wins: mine.wins, losses: mine.losses, behind: leader - mine.wins, lead: mine.wins - nextBest };
}

const wins = (n: number) => `${n} ${n === 1 ? "win" : "wins"}`;

// The season sits on one line split by hairlines, the same pattern as My
// matches, so the league card stays a single surface (approved Leagues).
function Stat({ label, value, first }: { label: string; value: string; first?: boolean }) {
  const c = useColors();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        paddingLeft: first ? 0 : spacing.space3,
        paddingRight: spacing.space3,
        gap: 2,
        borderLeftWidth: first ? 0 : 1,
        borderLeftColor: c.hairline,
      }}
    >
      <Text variant="section" tone="inkMuted" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="scoreRow" style={{ fontSize: 26, lineHeight: 30 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function LeagueCard({ league, standing, onPress }: { league: League; standing: MyStanding; onPress: () => void }) {
  const c = useColors();
  const details = [league.location, playersLabel(league.playerCount), formatLabel(league.format)].filter(Boolean).join(" · ");
  const spoken = [
    league.name,
    statusLabel(league.status),
    details,
    playTypeLabel(league.leagueType),
    standing
      ? `You're ranked ${ordinal(standing.rank)} at ${standing.wins} and ${standing.losses}, ${
          standing.lead > 0 ? `${wins(standing.lead)} ahead` : standing.behind > 0 ? `${wins(standing.behind)} behind 1st` : "level with 1st"
        }`
      : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the league"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={{ gap: spacing.space3 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.space2 }}>
          <Text variant="title" style={{ flexShrink: 1 }}>
            {league.name}
          </Text>
          <Pill label={statusLabel(league.status)} />
        </View>
        {details ? (
          <Text variant="small" tone="inkMuted">
            {details}
          </Text>
        ) : null}
        {standing ? (
          <View
            style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: c.hairline, paddingTop: spacing.space3, marginTop: spacing.space1 }}
          >
            <Stat first label="Your rank" value={ordinal(standing.rank)} />
            <Stat label="Record" value={`${standing.wins}–${standing.losses}`} />
            {standing.lead > 0 ? (
              <Stat label="Ahead by" value={wins(standing.lead)} />
            ) : (
              <Stat label="Behind 1st" value={wins(standing.behind)} />
            )}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

function PastLeagueRow({ league, standing, onPress, last }: { league: League; standing: MyStanding; onPress: () => void; last: boolean }) {
  const c = useColors();
  const sub = [league.location, formatLabel(league.format), standing ? `Finished ${ordinal(standing.rank)}` : pastLabel(league)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${league.name}. ${sub}. ${pastLabel(league)}`}
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
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{league.name}</Text>
        <Text variant="small" tone="inkMuted">
          {sub}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={14} tintColor={c.inkMuted} />
    </Pressable>
  );
}

// "Tuesday Flex was deleted by its organizer" (C10). One line; the player clears it.
function NoticeRow({ message, onClear, clearing }: { message: string; onClear: () => void; clearing: boolean }) {
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, paddingVertical: spacing.space2 }}>
      <Text variant="body" style={{ flex: 1 }}>
        {message}
      </Text>
      <Pressable
        onPress={onClear}
        disabled={clearing}
        accessibilityRole="button"
        accessibilityLabel="Clear"
        accessibilityHint={message}
        accessibilityState={{ disabled: clearing, busy: clearing }}
        style={({ pressed }) => ({ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", opacity: pressed || clearing ? 0.6 : 1 })}
      >
        <Text variant="button">Clear</Text>
      </Pressable>
    </Card>
  );
}

// A league you've asked to join (decision 30). Pending shows "Requested"
// (or "Waitlist" for an Open league's next season) until the organizer
// decides. Declined becomes a one-line note the player clears.
function RequestRow({
  request,
  onDismiss,
  dismissing,
  last,
}: {
  request: MyJoinRequest;
  onDismiss: () => void;
  dismissing: boolean;
  last: boolean;
}) {
  const c = useColors();
  const declined = request.status === "declined";
  const label = request.kind === "waitlist" ? "Waitlist" : "Requested";
  const sub = declined
    ? `The organizer didn't add you this season.`
    : request.kind === "waitlist"
      ? "You'll get a spot when next season opens."
      : "Waiting for the organizer. You'll hear back here.";
  return (
    <View
      style={{
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space3,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.hairline,
      }}
    >
      <View accessible accessibilityLabel={`${request.leagueName}. ${declined ? "Not added" : label}. ${sub}`} style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{request.leagueName}</Text>
        <Text variant="small" tone="inkMuted">
          {sub}
        </Text>
      </View>
      {declined ? (
        <Pressable
          onPress={onDismiss}
          disabled={dismissing}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${request.leagueName}`}
          accessibilityState={{ disabled: dismissing, busy: dismissing }}
          hitSlop={8}
          style={({ pressed }) => ({ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", opacity: pressed || dismissing ? 0.6 : 1 })}
        >
          <Text variant="button">Clear</Text>
        </Pressable>
      ) : (
        <Chip label={label} />
      )}
    </View>
  );
}

// A quiet text link, not a card, so it never reads as a sibling of the
// leagues (approved Leagues). The press area is still a full 44pt.
function InviteCodeLink({ onPress }: { onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Got an invite code?"
      accessibilityHint="Opens a sheet to join a league with a code"
      style={({ pressed }) => ({ alignSelf: "flex-start", minHeight: 44, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Text variant="body" style={{ textDecorationLine: "underline", textDecorationColor: c.hairlineStrong }}>
        Got an invite code?
      </Text>
    </Pressable>
  );
}

export default function LeaguesScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useUser();

  const leaguesQ = useGetLeagues(user?.id ? { clerkUserId: user.id } : undefined);
  const playersQ = useGetMyPlayers();
  const noticesQ = useGetMyLeagueNotices();
  const clearNotice = useDismissMyLeagueNotice();
  const notices = noticesQ.data ?? [];
  const requestsQ = useGetMyJoinRequests();
  const dismiss = useDismissMyJoinRequest();
  const leagues = leaguesQ.data ?? [];
  const memberOf = new Set(leagues.map((l) => l.id));
  const requests = (requestsQ.data ?? []).filter((r) => !memberOf.has(r.leagueId));
  const clearRequest = (requestId: number) =>
    dismiss.mutate({ requestId }, { onSettled: () => void requestsQ.refetch() });

  const standingsQs = useQueries({
    queries: leagues.map((l) => getGetLeagueStandingsQueryOptions(l.id)),
  });

  const standingFor = (league: League, i: number) =>
    myStanding(standingsQs[i]?.data, playersQ.data?.find((p) => p.leagueId === league.id)?.id);

  const open = (league: League) =>
    router.push({ pathname: "/league/[leagueId]", params: { leagueId: String(league.id) } });

  const indexed = leagues.map((league, i) => ({ league, i }));
  const current = indexed.filter(({ league }) => !isPastLeague(league));
  const past = indexed.filter(({ league }) => isPastLeague(league));

  const refreshing = leaguesQ.isRefetching;
  const refresh = () => {
    void leaguesQ.refetch();
    void playersQ.refetch();
    void noticesQ.refetch();
    void requestsQ.refetch();
    standingsQs.forEach((q) => void q.refetch());
  };

  const startLeague = () => router.push("/league/new");
  // Discover's Open leagues tab (Wave 2, Session F).
  const findOpenLeague = () => {
    discoverState.setTab("leagues");
    router.push("/(tabs)/discover");
  };

  return (
    <TabScreen title="Leagues" action={<IconButton symbol="plus" label="Start a league" onPress={startLeague} />}>
      {leaguesQ.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading your leagues" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.space4,
            paddingBottom: insets.bottom + 120,
            gap: spacing.space6,
            flexGrow: 1,
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.ink} />}
        >
          {leaguesQ.isError ? (
            <Card style={{ gap: spacing.space2 }}>
              <Text variant="bodyStrong">Couldn't load your leagues</Text>
              <Text variant="small" tone="inkMuted">
                Pull down to try again.
              </Text>
            </Card>
          ) : null}

          {notices.map((n) => (
            <NoticeRow
              key={n.id}
              message={n.message}
              clearing={clearNotice.isPending && clearNotice.variables?.noticeId === n.id}
              onClear={() => clearNotice.mutate({ noticeId: n.id }, { onSettled: () => void noticesQ.refetch() })}
            />
          ))}

          {!leaguesQ.isError && leagues.length === 0 && requests.length === 0 ? (
            <View style={{ minHeight: 240, gap: spacing.space4 }}>
              <EmptyState roundel title="No leagues yet" message="Start one for your group, or find an Open league near you and ask for a spot." />
              <Button label="Start a league" onPress={startLeague} />
              <Button label="Find an Open league" variant="secondary" onPress={findOpenLeague} accessibilityHint="Opens Open leagues in Discover" />
            </View>
          ) : null}

          {current.length > 0 ? (
            <View style={{ gap: spacing.space3 }}>
              {current.map(({ league, i }) => (
                <LeagueCard key={league.id} league={league} standing={standingFor(league, i)} onPress={() => open(league)} />
              ))}
            </View>
          ) : null}

          {requests.length > 0 ? (
            <View style={{ gap: spacing.space2 }}>
              <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
                Requested
              </Text>
              <Card style={{ padding: 0 }}>
                {requests.map((r, n) => (
                  <RequestRow
                    key={r.id}
                    request={r}
                    onDismiss={() => clearRequest(r.id)}
                    dismissing={dismiss.isPending && dismiss.variables?.requestId === r.id}
                    last={n === requests.length - 1}
                  />
                ))}
              </Card>
            </View>
          ) : null}

          {past.length > 0 ? (
            <View style={{ gap: spacing.space2 }}>
              <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ paddingHorizontal: spacing.space1 }}>
                Past leagues
              </Text>
              <Card style={{ padding: 0 }}>
                {past.map(({ league, i }, n) => (
                  <PastLeagueRow
                    key={league.id}
                    league={league}
                    standing={standingFor(league, i)}
                    onPress={() => open(league)}
                    last={n === past.length - 1}
                  />
                ))}
              </Card>
            </View>
          ) : null}

          <InviteCodeLink onPress={() => router.push("/league/join")} />
        </ScrollView>
      )}
    </TabScreen>
  );
}
