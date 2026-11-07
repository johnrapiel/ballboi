import { Image } from "expo-image";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useCallback, useRef } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, Share, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetMyMatch, type MatchDetail } from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { BrushRing } from "@/components/BrushRing";
import { IconButton } from "@/components/Choice";
import { ROUND_SINGULAR } from "@/components/league/Bracket";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { correctionLine } from "@/lib/leagueSchedule";
import { durationLabel, durationSpoken, resultSentence, scoreFootnote, setRows } from "@/lib/myMatches";
import { isRetiredScore, WALKOVER_SCORE } from "@/lib/tennisScore";

// Match detail (finding 6, John, Nov 6; approved design audit, Match detail).
// Opened from Home's recent results and My matches. Plain match details like
// Home's card (date and time, league, court), the score alone with the brush
// ring on the winner, and Ball Boi Replay once an analysis has finished
// (Wave 2 fills the replay in). More options holds Share and Report only.
//
// Finding 7: for 24 hours after the score is entered, either player sees a
// small pencil next to the score ("Edit score", 44pt). It opens Enter score
// prefilled. After that it's locked; the footnote points to the league admin.

const BALL = {
  day: require("@/assets/images/tabs/tab-ballboi-on.png"),
  night: require("@/assets/images/tabs/tab-ballboi-on-dark.png"),
};

function whenLine(d: MatchDetail): string | null {
  const iso = d.scheduledAt ?? d.completedAt;
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const day = at.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return d.scheduledAt ? `${day} · ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : day;
}

function stageLine(d: MatchDetail): string {
  const stage = d.playoffRound
    ? `Playoffs · ${ROUND_SINGULAR[d.playoffRound as keyof typeof ROUND_SINGULAR] ?? "Playoff"}`
    : d.roundNumber != null
      ? `Round ${d.roundNumber}`
      : null;
  return [d.leagueName, stage].filter(Boolean).join(" · ");
}

const sideName = (s: MatchDetail["you"]) => s.players.map((p) => p.name).join(" & ") || "Player";

/** One player's row: avatar, name (ringed if they won), then their games in each set. */
function ScoreLine({ name, won, games, other, tiebreaks, sets }: { name: string; won: boolean; games: number[]; other: number[]; tiebreaks: (number | null)[]; sets: number }) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const cell = Math.round(36 * Math.min(fontScale, 1.5));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2, minHeight: 52 }}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
        <Avatar name={name} size={32} />
        <View style={{ flexShrink: 1, paddingHorizontal: won ? spacing.space2 : 0, paddingVertical: won ? spacing.space1 : 0 }}>
          {won ? (
            <BrushRing size={0} style={{ alignItems: "flex-start" }}>
              <Text variant="bodyStrong">{name}</Text>
            </BrushRing>
          ) : (
            <Text variant="bodyStrong">{name}</Text>
          )}
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
      <SymbolView name="pencil" size={18} tintColor={c.ink} />
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

  const opponent = d?.opponents.players[0];
  const them = d ? sideName(d.opponents) : "";
  const you = d ? sideName(d.you) : "";
  const youWon = !!d?.you.won;
  const sentence = d?.played && d.score ? resultSentence({ you, them, score: d.score, youWon }) : null;

  function moreOptions() {
    if (!d) return;
    const options: { label: string; run: () => void }[] = [
      {
        label: "Share",
        run: () =>
          void Share.share({
            message: sentence ? `${sentence} · ${d.leagueName}` : `${you} vs. ${them} · ${d.leagueName}`,
          }).catch(() => {}),
      },
    ];
    if (opponent?.hasAccount) {
      options.push({
        label: `Report ${opponent.name}`,
        run: () => router.push({ pathname: "/report/[playerId]", params: { playerId: String(opponent.playerId), name: opponent.name } }),
      });
    }
    const labels = options.map((o) => o.label);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...labels, "Cancel"], cancelButtonIndex: labels.length },
        (i) => {
          if (i < options.length) options[i].run();
        },
      );
      return;
    }
    Alert.alert("More options", undefined, [...options.map((o) => ({ text: o.label, onPress: o.run })), { text: "Cancel", style: "cancel" as const }]);
  }

  const header = (
    <Stack.Screen
      options={{
        headerRight: d ? () => <IconButton symbol="ellipsis" label="More options" onPress={moreOptions} /> : undefined,
      }}
    />
  );

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
        {header}
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading match" />
      </View>
    );
  }

  if (!d) {
    const status = (q.error as { status?: number } | null)?.status;
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4, paddingBottom: insets.bottom + spacing.space4 }}>
        {header}
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
  const retired = isRetiredScore(d.score);
  const when = whenLine(d);
  const stage = stageLine(d);
  const notes = [
    d.voided ? "Cancelled when a player left the league." : null,
    walkover ? `${youWon ? you : them} won by walkover.` : null,
    retired ? `${youWon ? them : you} retired.` : null,
    correctionLine(d),
    !d.correctedBy && d.editedBy ? `Score edited by ${d.editedBy}` : null,
    d.inGrace ? "Grace week: counts for Ball Boi stats, not standings." : null,
  ].filter((n): n is string => !!n);
  const footnote = scoreFootnote(d);
  const scoreSpoken = d.played
    ? `Final score. ${sentence}.`
    : d.voided
      ? "Cancelled."
      : "Not played yet.";
  const replayMeta = d.replay
    ? [durationLabel(d.replay.durationSeconds), `${d.replay.shotCount} ${d.replay.shotCount === 1 ? "shot" : "shots"}`].filter(Boolean).join(" · ")
    : null;
  const replaySpoken = d.replay
    ? ["Ball Boi Replay", durationSpoken(d.replay.durationSeconds), `${d.replay.shotCount} shots`].filter(Boolean).join(". ")
    : "";
  const editScore = () =>
    router.push({ pathname: "/league/[leagueId]/score/[matchId]", params: { leagueId: String(d.leagueId), matchId: String(d.matchId), edit: "1" } });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space4 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void refetch()} tintColor={c.ink} />}
    >
      {header}
      {/* The screen's name for VoiceOver; the nav bar title stays empty, as designed. */}
      <View accessible accessibilityRole="header" accessibilityLabel={`Match against ${them}`} style={{ position: "absolute", width: 1, height: 1 }} />

      <Card style={{ borderWidth: 0, paddingVertical: spacing.space6, gap: spacing.space4 }}>
        <View accessible accessibilityLabel={[when, stage, d.location].filter(Boolean).join(". ")} style={{ alignItems: "center", gap: 2 }}>
          {when ? <Text style={{ textAlign: "center", fontVariant: ["lining-nums", "tabular-nums"] }}>{when}</Text> : null}
          <Text style={{ textAlign: "center" }}>{stage}</Text>
          {d.location ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space1 }}>
              <SymbolView name="mappin.and.ellipse" size={16} tintColor={c.inkMuted} />
              <Text style={{ flexShrink: 1, textAlign: "center" }}>{d.location}</Text>
            </View>
          ) : null}
        </View>

        <View style={{ height: 1, backgroundColor: c.hairline }} />

        {d.played && !walkover ? (
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
            <View accessible accessibilityLabel={`${scoreSpoken}${notes.length ? ` ${notes.join(". ")}.` : ""}`}>
            <ScoreLine name={you} won={youWon} games={youGames} other={themGames} tiebreaks={tbs} sets={sets} />
            <View style={{ height: 1, backgroundColor: c.hairline }} />
            <ScoreLine name={them} won={!youWon} games={themGames} other={youGames} tiebreaks={tbs} sets={sets} />
            </View>
          </View>
        ) : (
          <View accessible accessibilityLabel={`${scoreSpoken}${notes.length ? ` ${notes.join(". ")}.` : ""}`} style={{ alignItems: "center", gap: spacing.space1 }}>
            <Text variant="bodyStrong" style={{ textAlign: "center" }}>
              {`You vs. ${them}`}
            </Text>
            <Text tone="inkMuted" style={{ textAlign: "center" }}>
              {d.voided ? "Cancelled" : walkover ? (youWon ? "You won by walkover" : `${them} won by walkover`) : "Not played yet"}
            </Text>
          </View>
        )}

        {notes.length ? (
          <View style={{ gap: 2 }}>
            <View style={{ gap: 2 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              {notes
                .filter((n) => !walkover || !n.includes("walkover"))
                .map((n) => (
                  <Text key={n} variant="small" tone="inkMuted">
                    {n}
                  </Text>
                ))}
            </View>
          </View>
        ) : null}
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
            <SymbolView name="chevron.right" size={13} tintColor={c.inkMuted} />
          </Card>
        </Pressable>
      ) : null}

      {footnote ? (
        <Text variant="small" tone="inkMuted" style={{ paddingHorizontal: spacing.space1 }}>
          {footnote}
        </Text>
      ) : null}
    </ScrollView>
  );
}
