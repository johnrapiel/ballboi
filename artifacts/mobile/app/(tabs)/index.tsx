import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useGetMatches,
  useGetMyPlayers,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

type Match = {
  id: number;
  player1Id: number;
  player2Id: number;
  player1Name?: string | null;
  player2Name?: string | null;
  scheduledAt?: string | null;
  status: string;
  score?: string | null;
  winnerId?: number | null;
  season?: string | null;
  hasBallBoi?: boolean;
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown date";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function MatchCard({
  match,
  myPlayerIds,
  onPress,
}: {
  match: Match;
  myPlayerIds: number[];
  onPress: () => void;
}) {
  const colors = useColors();

  const isMyMatch =
    myPlayerIds.includes(match.player1Id) ||
    myPlayerIds.includes(match.player2Id);

  const p1 = match.player1Name ?? `Player ${match.player1Id}`;
  const p2 = match.player2Name ?? `Player ${match.player2Id}`;
  const status = match.status;
  const isCompleted = status === "completed";

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius + 4,
      padding: 16,
      marginHorizontal: 20,
      marginBottom: 12,
    },
    topRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 12,
    },
    dateText: {
      fontSize: 13,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
    },
    badges: {
      flexDirection: "row",
      gap: 6,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 100,
    },
    badgeText: {
      fontSize: 12,
      fontWeight: "600" as const,
      fontFamily: "Inter_600SemiBold",
    },
    ballBoiBadge: {
      backgroundColor: colors.primary + "22",
      borderWidth: 1,
      borderColor: colors.primary + "55",
    },
    ballBoiBadgeText: {
      color: colors.primary,
    },
    completedBadge: {
      backgroundColor: "#16a34a22",
      borderWidth: 1,
      borderColor: "#16a34a55",
    },
    completedBadgeText: {
      color: "#22c55e",
    },
    scheduledBadge: {
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    scheduledBadgeText: {
      color: colors.mutedForeground,
    },
    matchup: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    playerName: {
      flex: 1,
      fontSize: 15,
      fontWeight: "600" as const,
      color: colors.foreground,
      fontFamily: "Inter_600SemiBold",
    },
    vsText: {
      fontSize: 13,
      color: colors.mutedForeground,
      fontFamily: "Inter_500Medium",
    },
    score: {
      fontSize: 14,
      color: colors.mutedForeground,
      fontFamily: "Inter_500Medium",
      marginTop: 4,
    },
    replayRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    replayText: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: "600" as const,
      fontFamily: "Inter_600SemiBold",
    },
  });

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.8 : 1 }]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
    >
      <View style={styles.topRow}>
        <Text style={styles.dateText}>{formatDate(match.scheduledAt)}</Text>
        <View style={styles.badges}>
          {isCompleted ? (
            <View style={[styles.badge, styles.completedBadge]}>
              <Text style={[styles.badgeText, styles.completedBadgeText]}>Completed</Text>
            </View>
          ) : (
            <View style={[styles.badge, styles.scheduledBadge]}>
              <Text style={[styles.badgeText, styles.scheduledBadgeText]}>
                {status === "in_progress" ? "In Progress" : "Scheduled"}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.matchup}>
        <Text style={styles.playerName} numberOfLines={1}>{p1}</Text>
        <Text style={styles.vsText}>vs</Text>
        <Text style={[styles.playerName, { textAlign: "right" }]} numberOfLines={1}>{p2}</Text>
      </View>

      {match.score && <Text style={styles.score}>{match.score}</Text>}
      {match.season && (
        <Text style={[styles.score, { marginTop: 2 }]}>{match.season}</Text>
      )}

      {match.hasBallBoi && (
        <View style={styles.replayRow}>
          <Ionicons name="videocam" size={14} color={colors.primary} />
          <Text style={styles.replayText}>Ball Boi Replay available</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} style={{ marginLeft: "auto" }} />
        </View>
      )}
    </Pressable>
  );
}

function EmptyState({ colors }: { colors: ReturnType<typeof useColors> }) {
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 40,
    },
    iconWrap: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
    },
    title: {
      fontSize: 18,
      fontWeight: "600" as const,
      color: colors.foreground,
      marginBottom: 8,
      textAlign: "center",
      fontFamily: "Inter_600SemiBold",
    },
    subtitle: {
      fontSize: 14,
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
      fontFamily: "Inter_400Regular",
    },
  });
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name="tennisball-outline" size={36} color={colors.mutedForeground} />
      </View>
      <Text style={styles.title}>No matches yet</Text>
      <Text style={styles.subtitle}>
        Your matches will appear here once you join a league and play.
      </Text>
    </View>
  );
}

export default function MatchesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: myPlayers, isLoading: playersLoading } = useGetMyPlayers();

  const myPlayerIds = useMemo(
    () => (myPlayers ?? []).map((p) => p.id),
    [myPlayers]
  );

  const primaryPlayerId = myPlayerIds[0];

  const { data: matchesRaw, isLoading: matchesLoading, refetch } = useGetMatches(
    primaryPlayerId ? { playerId: primaryPlayerId } : undefined
  );

  const matches = useMemo(() => {
    if (!matchesRaw) return [];
    return [...matchesRaw].sort((a, b) => {
      const dateA = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
      const dateB = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
      return dateB - dateA;
    });
  }, [matchesRaw]);

  const isLoading = playersLoading || matchesLoading;

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingTop: topPad + 16,
      paddingHorizontal: 20,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    headerTitle: {
      fontSize: 22,
      fontWeight: "700" as const,
      color: colors.foreground,
      fontFamily: "Inter_700Bold",
    },
    headerSubtitle: {
      fontSize: 13,
      color: colors.mutedForeground,
      marginTop: 4,
      fontFamily: "Inter_400Regular",
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    listContent: {
      paddingTop: 16,
      paddingBottom: bottomPad + 20,
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Ionicons name="tennisball" size={20} color={colors.primary} />
          <Text style={styles.headerTitle}>My Matches</Text>
        </View>
        {myPlayers && myPlayers.length > 0 && (
          <Text style={styles.headerSubtitle}>
            {matches.length} {matches.length === 1 ? "match" : "matches"} found
          </Text>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={[
            styles.listContent,
            matches.length === 0 && { flex: 1 },
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!matches.length}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => {
                refetch();
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={<EmptyState colors={colors} />}
          renderItem={({ item }) => (
            <MatchCard
              match={item as Match}
              myPlayerIds={myPlayerIds}
              onPress={() =>
                router.push({
                  pathname: "/replay/[matchId]",
                  params: { matchId: String(item.id) },
                })
              }
            />
          )}
        />
      )}
    </View>
  );
}
