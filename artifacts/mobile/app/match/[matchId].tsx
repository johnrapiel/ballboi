import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/components/Icon";
import React, { useCallback, useRef } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getGetLeagueQueryKey, useGetLeague, useGetMyMatch, type MatchDetail } from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { ROUND_SINGULAR } from "@/components/league/Bracket";
import { NextMatchCard } from "@/components/NextMatchCard";
import { DoublesNote } from "@/components/record/DoublesMatchCard";
import { Button, Card, Text } from "@/components/ui";
import { MarkedName, WinnerNames } from "@/components/WinnerNames";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useProfile } from "@/hooks/useProfile";
import { useUpcomingMatches } from "@/hooks/useUpcomingMatches";
import { useUpcomingMessage } from "@/hooks/useUpcomingMessage";
import { correctionLine, LATE_NOTE, LATE_ROUND_RESULT, lateDateLine } from "@/lib/leagueSchedule";
import { durationLabel, durationSpoken, matchSourceLine, scoreFootnote, setRows } from "@/lib/myMatches";
import { isDoubleDefault, isRetiredScore, WALKOVER_SCORE } from "@/lib/tennisScore";
import { clockTime } from "@/lib/timeFormat";
import { openRecorder } from "@/lib/recording/start";
import { cardWhen } from "@/lib/upcoming";
import { upcomingActions, upcomingFromDetail } from "@/lib/upcomingDetail";
import { winnerMark } from "@/lib/winnerMark";

// Match detail (finding 6, John, Nov 6; approved design audit, Match detail).
// Decision 151 (John, Nov 8): every match you played, league, Discover or
// Quick match, with this one layout. Opened from Profile's Results, Career's
// seasons, Home and your own rows on other players' cards. Plain match
// details like Home's card (date and time, the court, and where it came
// from: the league, "Discover" or "Quick match"), the score alone with the
// winner's name marked by the brush underline (John, Nov 8), and Ball Boi Replay once an analysis has finished
// (Wave 2 fills the replay in). No More options button (Wave 2 finding 26,
// John, Nov 12): match results aren't shared outside the app (decision 177),
// and Report lives on the player card and in chats, so the header has only
// back.
//
// Finding 7: for 24 hours after the score is entered, either player sees a
// small pencil next to the score ("Edit score", 44pt). It opens Enter score
// prefilled. After that it's locked; in a league the footnote points to the
// admin, and a Discover or Quick match just says "Scores lock 24 hours after
// they're entered." A Discover or Quick edit never touches standings.
//
// Design audit (John, Nov 7: the audit overrides anything built that doesn't
// match it): the score card is the same D2 card as Home's next match, with the standard
// light hairline border (Nov 7), and
// holds only the details and the score. Notes such as "Score edited by" sit
// below it with the footnote, not inside the card.
//
// Finding 9 (John, Nov 11): a match not played yet shows Home's next-match
// card instead (NextMatchCard): when, where, both photos, "You vs. Marcus",
// the league pill, then Record with Ball Boi (singles), Message and Enter
// score. Where the league lets players set the time, "Set a match time" or
// "Change time" is link text under the date line (Wave 2 finding 25). A doubles match keeps
// the note on why Ball Boi can't record it. A Discover or Quick match gets
// Record on match day and Message. Played matches are unchanged.

const BALL = {
  day: require("@/assets/images/tabs/tab-ballboi-on.png"),
  night: require("@/assets/images/tabs/tab-ballboi-on-dark.png"),
};

function whenLine(d: MatchDetail): string | null {
  // A late match: its saved time while still ahead, else "Play by" the end of its extra week (decision 152).
  if (d.lateUntil) return lateDateLine(d.scheduledAt, d.lateUntil, d.timeZone);
  const iso = d.scheduledAt ?? d.completedAt;
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const day = at.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return d.scheduledAt ? `${day} · ${clockTime(at)}` : day;
}

function stageLine(d: MatchDetail): string {
  return matchSourceLine(d, (round) => ROUND_SINGULAR[round as keyof typeof ROUND_SINGULAR]);
}

const sideName = (s: MatchDetail["you"]) => s.players.map((p) => p.name).join(" & ") || "Player";
/** A singles player's photo; doubles sides keep their initials. */
const sidePhoto = (s: MatchDetail["you"]) => (s.players.length === 1 ? (s.players[0].avatarUrl ?? null) : null);

/** One player's row: avatar, name (marked if they won), then their games in each set. */
function ScoreLine({ name, photo, won, games, other, tiebreaks, sets }: { name: string; photo?: string | null; won: boolean; games: number[]; other: number[]; tiebreaks: (number | null)[]; sets: number }) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const cell = Math.round(36 * Math.min(fontScale, 1.5));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2, minHeight: 52 }}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
        <Avatar name={name} uri={photo} size={32} />
        <View style={{ flexShrink: 1 }}>
          {/* Winner mark (John, Nov 8): bold with the brush underline, the loser muted. */}
          <MarkedName name={name} look={won ? "winner" : "loser"} />
        </View>
      </View>
      {Array.from({ length: sets }, (_, i) => {
        const g = games[i];
        const tookSet = g != null && other[i] != null && g > other[i];
        return (
          <View key={i} style={{ width: cell, alignItems: "center", flexDirection: "row", justifyContent: "center" }}>
            <Text variant="scoreRow" tone={tookSet ? "ink" : "inkMuted"}>
              {g ?? ""}
            </Text>
            {tiebreaks[i] != null && !tookSet ? (
              <Text variant="small" tone="inkMuted" style={{ alignSelf: "flex-start" }}>
                {tiebreaks[i]}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** The small pencil next to the score: "Edit score" for VoiceOver, a 44pt target. */
function EditPencil({ onPress }: { onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Edit score"
      accessibilityHint="Opens Enter score with this score filled in"
      style={({ pressed }) => ({ width: MIN_TAP, height: MIN_TAP, marginLeft: -spacing.space3, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name="pencil" size={18} tintColor={c.ink} />
    </Pressable>
  );
}

export default function MatchDetailScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const { matchId: raw } = useLocalSearchParams<{ matchId: string }>();
  const matchId = Number(raw);
  const q = useGetMyMatch(matchId);
  const d = q.data;
  const { refetch } = q;
  const pull = usePullToRefresh(() => refetch());
  const firstFocus = useRef(true);
  // Back from Enter score after an edit: show the new score.
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );

  // Finding 9: the same card and actions as Home for a match not played yet.
  const upcomingQ = useUpcomingMatches();
  const pullUpcoming = usePullToRefresh(() => [refetch(), upcomingQ.refetch()]);
  const { profile } = useProfile();
  const { message: upcomingMessage } = useUpcomingMessage();
  const upcoming = !!d && !d.played && !d.voided;
  const leagueId = d?.leagueId ?? 0;
  const leagueQ = useGetLeague(leagueId, { query: { enabled: upcoming && d?.leagueId != null, queryKey: getGetLeagueQueryKey(leagueId) } });

  const them = d ? sideName(d.opponents) : "";
  const you = d ? sideName(d.you) : "";
  const youWon = !!d?.you.won;

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading match" />
      </View>
    );
  }

  if (!d) {
    const status = (q.error as { status?: number } | null)?.status;
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4, paddingBottom: insets.bottom + spacing.space4 }}>
        <Card style={{ gap: spacing.space3 }}>
          <Text variant="bodyStrong" accessibilityRole="header">
            Couldn't load this match
          </Text>
          <Text variant="small" tone="inkMuted">
            {status === 404 || status === 403 ? "It may have been removed, or it isn't one of your matches." : "Check your connection and try again."}
          </Text>
          {status === 404 || status === 403 ? (
            <Button label="Go back" variant="secondary" onPress={() => router.back()} />
          ) : (
            <Button label="Try again" variant="secondary" loading={q.isRefetching} onPress={() => void refetch()} />
          )}
        </Card>
      </View>
    );
  }

  const rows = setRows(d.score);
  const sets = Math.max(rows.length, d.played ? 2 : 0);
  const youGames = rows.map((r) => r.you);
  const themGames = rows.map((r) => r.them);
  const tbs = rows.map((r) => r.tiebreak);
  const walkover = d.score?.trim() === WALKOVER_SCORE;
  // Doubles (John, Nov 9): both teams a player short, so no winner and no sets.
  const doubleDefault = isDoubleDefault(d.score);
  const retired = isRetiredScore(d.score);
  const when = whenLine(d);
  const stage = stageLine(d);
  const notes = [
    d.voided ? "Cancelled when a player left the league." : null,
    walkover ? `${youWon ? you : them} won by walkover.` : null,
    doubleDefault ? "Both teams were a player short, so neither team gets the win." : null,
    retired ? `${youWon ? them : you} retired.` : null,
    correctionLine(d),
    !d.correctedBy && d.editedBy ? `Score edited by ${d.editedBy}` : null,
    d.lateUntil ? LATE_NOTE : d.inGrace ? LATE_ROUND_RESULT : null,
  ].filter((n): n is string => !!n);
  const footnote = scoreFootnote(d);
  // The walkover line already shows in the card when there's no score.
  const shownNotes = notes.filter((n) => !walkover || !n.includes("walkover"));
  // Winner mark (John, Nov 8): "[Winner] won [score]", the score from their side.
  const mark = winnerMark({
    player1Name: you,
    player2Name: them,
    score: d.played && !d.voided ? d.score : null,
    winner: d.played && !d.voided && d.score && !doubleDefault ? (youWon ? 1 : 2) : null,
    status: d.voided ? "Cancelled" : "Not played yet",
  });
  const scoreSpoken = d.played && !d.voided ? `Final score. ${mark.spoken}.` : `${you} versus ${them}. ${mark.spoken}.`;
  const replayMeta = d.replay
    ? [durationLabel(d.replay.durationSeconds), `${d.replay.shotCount} ${d.replay.shotCount === 1 ? "shot" : "shots"}`].filter(Boolean).join(" · ")
    : null;
  const replaySpoken = d.replay
    ? ["Ball Boi Replay", durationSpoken(d.replay.durationSeconds), `${d.replay.shotCount} shots`].filter(Boolean).join(". ")
    : "";
  // A league score is edited in the league's Enter score; a Discover or Quick
  // match's in its own sheet, which never touches standings (decision 151).
  const editScore = () =>
    d.leagueId != null
      ? router.push({ pathname: "/league/[leagueId]/score/[matchId]", params: { leagueId: String(d.leagueId), matchId: String(d.matchId), edit: "1" } })
      : router.push({ pathname: "/match/edit-score/[matchId]", params: { matchId: String(d.matchId) } });

  if (upcoming) {
    // Home's own item knows the Play by date; otherwise build it from this match.
    const item =
      upcomingQ.items.find((i) => i.matchId === d.matchId && i.kind !== "open") ??
      upcomingFromDetail(d, stage);
    // Match time: only in a league with no fixed weekly time (as on the league page).
    const actions = upcomingActions(item, { matchTimeAllowed: !!leagueQ.data && leagueQ.data.matchDay == null });
    const cardOpponent = item.opponentName ?? them;
    const cardWhenLabel = cardWhen(item);
    const leagueIdForActions = d.leagueId;
    // The late note is on the card; any other note sits under it.
    const upcomingNotes = shownNotes.filter((n) => n !== LATE_NOTE);
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space4 }}
        refreshControl={
          <RefreshControl
            refreshing={pullUpcoming.refreshing}
            onRefresh={pullUpcoming.onRefresh}
            tintColor={c.ink}
          />
        }
      >
        <View accessible accessibilityRole="header" accessibilityLabel={`Match against ${cardOpponent}`} style={{ position: "absolute", width: 1, height: 1 }} />
        <NextMatchCard
          dateLabel={cardWhenLabel.dateLabel}
          time={cardWhenLabel.time}
          myName={profile?.displayName ?? "You"}
          myPhoto={profile?.avatarUrl ?? sidePhoto(d.you)}
          opponentPhoto={item.opponentPhoto}
          opponentName={cardOpponent}
          partnerName={item.partnerName}
          opponentNames={item.opponentNames}
          location={item.location ?? d.location}
          league={item.context}
          note={item.grace ? LATE_NOTE : null}
          record={
            actions.record
              ? {
                  label: "Record with Ball Boi",
                  hint: `Records your match against ${cardOpponent}`,
                  onPress: () => openRecorder(router, { matchId: d.matchId, opponentName: cardOpponent, leagueId: d.leagueId }),
                }
              : null
          }
          message={upcomingMessage(item)}
          details={
            actions.enterScore && leagueIdForActions != null
              ? {
                  label: "Enter score",
                  hint: `For your match against ${cardOpponent}`,
                  onPress: () => router.push({ pathname: "/league/[leagueId]/score/[matchId]", params: { leagueId: String(leagueIdForActions), matchId: String(d.matchId) } }),
                }
              : null
          }
          timeLink={
            actions.matchTime && leagueIdForActions != null
              ? {
                  hasTime: !!item.scheduledAt,
                  onPress: () => router.push({ pathname: "/league/[leagueId]/time/[matchId]", params: { leagueId: String(leagueIdForActions), matchId: String(d.matchId) } }),
                }
              : null
          }
          footer={actions.doublesNote ? <DoublesNote matchId={d.matchId} /> : null}
        />
        {upcomingNotes.map((n) => (
          <Text key={n} variant="small" tone="inkMuted" style={{ paddingHorizontal: spacing.space1 }}>
            {n}
          </Text>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space4 }}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink} />}
    >
      {/* The screen's name for VoiceOver; the nav bar title stays empty, as designed. */}
      <View accessible accessibilityRole="header" accessibilityLabel={`Match against ${them}`} style={{ position: "absolute", width: 1, height: 1 }} />

      <Card
        style={{
          paddingTop: 22,
          paddingHorizontal: 20,
          paddingBottom: 20,
          gap: spacing.space4,
        }}
      >
        <View accessible accessibilityLabel={[when, stage, d.location].filter(Boolean).join(". ")} style={{ alignItems: "center", gap: 2 }}>
          {when ? <Text style={{ textAlign: "center", fontVariant: ["lining-nums", "tabular-nums"] }}>{when}</Text> : null}
          <Text style={{ textAlign: "center" }}>{stage}</Text>
          {d.location ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space1 }}>
              <Icon name="mappin.and.ellipse" size={16} tintColor={c.inkMuted} />
              <Text style={{ flexShrink: 1, textAlign: "center" }}>{d.location}</Text>
            </View>
          ) : null}
        </View>

        <View style={{ height: 1, backgroundColor: c.hairline }} />

        {d.played && !walkover && !doubleDefault ? (
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2, minHeight: MIN_TAP }}>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
                {/* Finding 7: the pencil sits right by the score, only during the 24 hours. */}
                {d.editUntil ? <EditPencil onPress={editScore} /> : null}
              </View>
              {Array.from({ length: sets }, (_, i) => (
                <Text key={i} variant="small" tone="inkMuted" accessibilityElementsHidden importantForAccessibility="no" style={{ width: Math.round(36 * Math.min(fontScale, 1.5)), textAlign: "center" }}>
                  {i + 1}
                </Text>
              ))}
            </View>
            <View accessible accessibilityLabel={scoreSpoken}>
            <ScoreLine name={you} photo={sidePhoto(d.you)} won={youWon} games={youGames} other={themGames} tiebreaks={tbs} sets={sets} />
            <View style={{ height: 1, backgroundColor: c.hairline }} />
            <ScoreLine name={them} photo={sidePhoto(d.opponents)} won={!youWon} games={themGames} other={youGames} tiebreaks={tbs} sets={sets} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
            {/* A doubles W/O or double default can be edited for 24 hours too (John, Nov 9). */}
            {d.editUntil ? <EditPencil onPress={editScore} /> : null}
            <View accessible accessibilityLabel={scoreSpoken} style={{ flex: 1, alignItems: "center" }}>
              <WinnerNames player1Name={you} player2Name={them} mark={mark} />
            </View>
            {/* Balances the pencil so the names stay centered. */}
            {d.editUntil ? <View style={{ width: MIN_TAP - spacing.space3 }} /> : null}
          </View>
        )}

      </Card>

      {d.replay ? (
        <Pressable
          onPress={() => router.push(`/replay/${d.matchId}`)}
          accessibilityRole="button"
          accessibilityLabel={replaySpoken}
          accessibilityHint="Opens the replay"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
            <Image source={c.scheme === "dark" ? BALL.night : BALL.day} style={{ width: 44, height: 44 }} contentFit="contain" accessible={false} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">Ball Boi Replay</Text>
              {replayMeta ? (
                <Text variant="small" tone="inkMuted">
                  {replayMeta}
                </Text>
              ) : null}
            </View>
            <Icon name="chevron.right" size={13} tintColor={c.inkMuted} />
          </Card>
        </Pressable>
      ) : null}

      {shownNotes.length || footnote ? (
        <View style={{ gap: 2, paddingHorizontal: spacing.space1 }}>
          {shownNotes.map((n) => (
            <Text key={n} variant="small" tone="inkMuted">
              {n}
            </Text>
          ))}
          {footnote ? (
            <Text variant="small" tone="inkMuted">
              {footnote}
            </Text>
          ) : null}
        </View>
      ) : null}

    </ScrollView>
  );
}
