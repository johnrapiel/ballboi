// One season's results, from a Seasons row on Career (decision 147): the
// season's name as the title, its record, then its results as Profile's
// Results rows (W or L with the letter, the score from your side). League
// results open Match detail; Discover and Quick match results have none.

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetMyCareer } from "@workspace/api-client-react";

import { EmptyTab } from "@/components/card/MatchTabs";
import { useEditHeader } from "@/components/profile/editHeader";
import { ResultRow } from "@/components/ResultRow";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { careerResultRow, seasonRecord, seasonResults } from "@/lib/career";

export default function CareerSeasonScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const header = useEditHeader("");
  const { key } = useLocalSearchParams<{ key: string }>();
  const q = useGetMyCareer();
  const season = q.data?.seasons.find((s) => s.key === key);
  const results = q.data ? seasonResults(q.data, key ?? "") : [];
  const rec = season ? seasonRecord(season) : null;

  return (
    <>
      <Stack.Screen options={header} />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space4 }}
      >
        {q.isLoading ? (
          <ActivityIndicator color={c.ink} accessibilityLabel="Loading this season" />
        ) : !season || !rec ? (
          <EmptyTab title="Couldn't find this season" message="Go back to Career and pick it again." />
        ) : (
          <>
            <Text variant="headingL" accessibilityRole="header">
              {season.name}
            </Text>
            <Text tone="inkMuted" accessibilityLabel={`Record this season: ${rec.spoken}`}>
              {`Record ${rec.text}`}
            </Text>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {results.map((r, n) => (
                <ResultRow key={r.matchId} r={careerResultRow(r)} last={n === results.length - 1} onPress={r.league ? () => router.push(`/match/${r.matchId}`) : undefined} />
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </>
  );
}
