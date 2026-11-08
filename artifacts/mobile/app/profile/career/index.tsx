// Career (spec decision 147, John, Nov 8), opened from See all on Profile's
// This season. Top to bottom:
// 1. The title "Career" (50% ink serif).
// 2. All-time numbers, one VoiceOver group: Record, Played, Best streak,
//    Sets won, Games won, Tiebreaks.
// 2b. Milestones (decision 150): each earned badge with its title and the
//    date it was earned.
// 3. Seasons: each season you played in with its record; a row opens that
//    season's results.
// 4. Head-to-head: everyone you've played, "Sam Patel · 2-1", opening their
//    card. Blocked players never show.
// League, Discover and confirmed Quick matches count; unconfirmed Quick
// matches (G2), cancelled matches and walkovers' games don't. Ball Boi
// career stats aren't here yet: they join once they pass their accuracy
// bars (G1), as their own section under the numbers (see lib/career.ts).

import { Stack, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetMyCareer } from "@workspace/api-client-react";

import { EmptyTab } from "@/components/card/MatchTabs";
import { MilestoneBadge } from "@/components/MilestoneBadge";
import { StatGrid } from "@/components/card/StatGrid";
import { useEditHeader } from "@/components/profile/editHeader";
import { SettingsRow, SettingsSection } from "@/components/SettingsList";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { careerCells, careerSpoken, headToHeadRow, seasonRecord } from "@/lib/career";
import { earnedLine, knownMilestones, MILESTONE_TITLES } from "@/lib/milestones";

export default function CareerScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const header = useEditHeader("");
  const q = useGetMyCareer();
  const career = q.data;
  const milestones = knownMilestones(career?.milestones);

  return (
    <>
      <Stack.Screen options={header} />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{
          padding: spacing.space4,
          paddingBottom: insets.bottom + spacing.space8,
          gap: spacing.space6,
        }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.ink} />}
      >
        <Text variant="headingL" accessibilityRole="header">
          Career
        </Text>

        {q.isLoading ? (
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading your career" />
        ) : !career ? (
          <Card style={{ gap: spacing.space3 }}>
            <Text variant="bodyStrong" accessibilityRole="alert">
              {isOfflineError(q.error) ? OFFLINE_MESSAGE : "Couldn't load your career"}
            </Text>
            <Button label="Try again" variant="secondary" loading={q.isRefetching} onPress={() => void q.refetch()} />
          </Card>
        ) : career.played === 0 && !milestones.length ? (
          <EmptyTab
            title="No results yet"
            message="Once you play a league, Discover or Quick match and a score is entered, your career starts here."
          />
        ) : (
          <>
            {career.played > 0 ? <StatGrid cells={careerCells(career)} spoken={careerSpoken(career)} columns={3} /> : null}

            {/* Ball Boi career stats go here once they pass their accuracy bars (G1). */}

            {milestones.length ? (
              <SettingsSection title="Milestones">
                {milestones.map((m, i) => (
                  <View
                    key={m.kind}
                    accessible
                    accessibilityLabel={`${MILESTONE_TITLES[m.kind]}, ${earnedLine(m.earnedAt).toLowerCase()}`}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.space3,
                      minHeight: 64,
                      paddingHorizontal: spacing.space4,
                      paddingVertical: spacing.space2,
                      borderBottomWidth: i === milestones.length - 1 ? 0 : 1,
                      borderBottomColor: c.hairline,
                    }}
                  >
                    <MilestoneBadge kind={m.kind} size={44} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{MILESTONE_TITLES[m.kind]}</Text>
                      <Text variant="small" tone="inkMuted">
                        {earnedLine(m.earnedAt)}
                      </Text>
                    </View>
                  </View>
                ))}
              </SettingsSection>
            ) : null}

            {career.seasons.length ? (
              <SettingsSection title="Seasons">
                {career.seasons.map((s, i) => {
                  const rec = seasonRecord(s);
                  return (
                    <SettingsRow
                      key={s.key}
                      title={s.name}
                      value={rec.text}
                      accessibilityLabel={`${s.name}, ${rec.spoken}`}
                      last={i === career.seasons.length - 1}
                      accessibilityHint="Opens this season's results"
                      onPress={() =>
                        router.push({
                          pathname: "/profile/career/season",
                          params: { key: s.key },
                        })
                      }
                    />
                  );
                })}
              </SettingsSection>
            ) : null}

            {career.headToHead.length > 0 ? (
              <SettingsSection title="Head-to-head">
                {career.headToHead.map((h, i) => {
                  const row = headToHeadRow(h);
                  const userId = h.userId;
                  return (
                    <SettingsRow
                      key={`${userId ?? "x"}-${h.name}`}
                      title={h.name}
                      value={`${h.wins}-${h.losses}`}
                      accessibilityLabel={row.spoken}
                      last={i === career.headToHead.length - 1}
                      accessibilityHint={userId != null ? "Opens their player card" : undefined}
                      onPress={
                        userId != null
                          ? () =>
                              router.push({
                                pathname: "/discover/player/[userId]",
                                params: { userId: String(userId) },
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </SettingsSection>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
