import { View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useGetMySchedule } from "@workspace/api-client-react";
import { Button, Card, EmptyState, Loading, Screen, Text } from "@/components/ui";
import { space, useTheme } from "@/theme";

const TIPS = [
  "Mount your phone behind the baseline, as high as you can.",
  "Turn it sideways so the whole court fits in frame.",
  "Ball Boi finds the court lines for you. No tapping corners.",
];

export default function BallBoiTab() {
  const { c } = useTheme();
  const router = useRouter();
  const schedule = useGetMySchedule();
  const match = schedule.data?.match ?? null;

  return (
    <Screen>
      <View style={{ gap: space.sm }}>
        <Text variant="title" accessibilityRole="header">Record with Ball Boi</Text>
        <Text muted>Film your match. Ball Boi tracks every shot and builds a replay with stats you can scrub through.</Text>
      </View>

      <Card>
        {TIPS.map((tip) => (
          <View key={tip} style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
            <Ionicons name="checkmark-circle" size={20} color={c.success} accessibilityElementsHidden importantForAccessibility="no" />
            <Text style={{ flex: 1 }}>{tip}</Text>
          </View>
        ))}
      </Card>

      {schedule.isLoading ? (
        <Loading label="Finding your next match" />
      ) : match ? (
        <Card>
          <Text variant="label" muted>NEXT MATCH</Text>
          <Text variant="headline">vs {match.opponentName}</Text>
          <Button
            label="Record this match"
            icon={<Ionicons name="videocam" size={20} color={c.onPrimary} />}
            accessibilityHint="Opens the camera to start recording"
            onPress={() => router.push({ pathname: "/record", params: { matchId: String(match.matchId), opponent: match.opponentName } })}
          />
        </Card>
      ) : (
        <EmptyState title="No match to record" body="Ball Boi attaches recordings to a scheduled match so your stats land in your league." />
      )}
    </Screen>
  );
}
