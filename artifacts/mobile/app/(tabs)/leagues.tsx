import { useUser } from "@clerk/expo";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Icon } from "@/components/Icon";
import { areaLabel } from "@/lib/leagueArea";
import { textTapSlop } from "@/lib/tapTarget";
import React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";

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
} from "@workspace/api-client-react";

import { IconButton } from "@/components/Choice";
import { EmptyState } from "@/components/EmptyState";
import { discoverState } from "@/hooks/useDiscoverFilters";
import { TabScreen } from "@/components/TabHeader";
import { Button, Card, Chip, Pill, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { formatLabel, isPastLeague, leagueCardText, myStanding, ordinal, pastLabel, type MyStanding } from "@/lib/leagues";

// Leagues tab (spec: Leagues; approved canvas: Leagues, John, Nov 5). Notes
// about deleted leagues, your current leagues as soft cards with your season
// on one line, leagues you've asked to join (decision 30), finished and ended
// leagues under Past leagues (decision 31) as chevron rows, and a "Got an
// invite code?" text link that opens the invite code sheet (app/league/join.tsx).
// Open leagues are found in Discover, not here. Start a league opens from the
// + button and from the empty state.

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
  // Finding 27, decision 183: Singles or Doubles in the pill, no "Active", and
  // a league that hasn't started shows its start date. Finding 28: the stats
  // row always shows, with a dash for each value until there's one.
  const card = leagueCardText(league, areaLabel(league.area) ?? league.location);
  const stats = card.started ? standing : null;
  const dash = "–";
  const spoken = [
    card.spoken,
    !card.started
      ? "Not started yet"
      : stats
      ? `You're ranked ${ordinal(stats.rank)} at ${stats.wins} and ${stats.losses}, ${
          stats.lead > 0 ? `${wins(stats.lead)} ahead` : stats.behind > 0 ? `${wins(stats.behind)} behind 1st` : "level with 1st"
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
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.space2 }}>
          <Text variant="title" style={{ flexShrink: 1 }}>
            {league.name}
          </Text>
          <Pill label={card.pill} />
        </View>
        {card.info ? (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.space1 }}>
            {card.starts ? (
              <View style={{ paddingTop: 2 }}>
                <Icon name="calendar" size={14} tintColor={c.inkMuted} />
              </View>
            ) : null}
            <Text variant="small" tone="inkMuted" style={{ flex: 1 }}>
              {card.info}
            </Text>
          </View>
        ) : null}
        <View
          style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: c.hairline, paddingTop: spacing.space3, marginTop: spacing.space1 }}
        >
          <Stat first label="Your rank" value={stats ? ordinal(stats.rank) : dash} />
          <Stat label="Record" value={stats ? `${stats.wins}–${stats.losses}` : dash} />
          {stats && stats.lead > 0 ? (
            <Stat label="Ahead by" value={wins(stats.lead)} />
          ) : (
            <Stat label="Behind 1st" value={stats ? wins(stats.behind) : dash} />
          )}
        </View>
      </Card>
    </Pressable>
  );
}

function PastLeagueRow({ league, standing, onPress, last }: { league: League; standing: MyStanding; onPress: () => void; last: boolean }) {
  const c = useColors();
  const sub = [areaLabel(league.area) ?? league.location, formatLabel(league.format), standing ? `Finished ${ordinal(standing.rank)}` : pastLabel(league)]
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
      <Icon name="chevron.right" size={14} tintColor={c.inkMuted} />
    </Pressable>
  );
}

// "Tuesday Flex was deleted by its organizer" (C10). One line; the player clears it.
function NoticeRow({ message, onClear, clearing }: { message: string; onClear: () => void; clearing: boolean }) {
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
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
        // 44pt target from hitSlop, so the card keeps equal padding (decision 192).
        hitSlop={textTapSlop("button")}
        style={({ pressed }) => ({ alignItems: "center", justifyContent: "center", opacity: pressed || clearing ? 0.6 : 1 })}
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
  const bottom = useScreenBottomInset({ tab: true });
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

  const pull = usePullToRefresh(() => [
    leaguesQ.refetch(),
    playersQ.refetch(),
    noticesQ.refetch(),
    requestsQ.refetch(),
    ...standingsQs.map((q) => q.refetch()),
  ]);

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
            paddingBottom: bottom.paddingBottom,
            gap: spacing.space6,
            flexGrow: 1,
          }}
          scrollIndicatorInsets={bottom.scrollIndicatorInsets}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
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
