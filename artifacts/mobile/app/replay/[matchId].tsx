// Replay placeholder. Opened from ballboi://replay/<matchId>.
//
// Spec (Ball Boi > Replay; Video and training data): the replay is a simulated
// court, never match video, and every stat is hidden until it passes its
// accuracy bar. The old Replit screen played the match video, so it's gone.
// Until the simulated replay is built (Wave 2), this screen says where the
// match is, so the link never opens a dead screen or a video.

import { useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useGetBallBoiReplay } from "@workspace/api-client-react";

export default function ReplayScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const id = Number(matchId);
  const { data, isLoading, isError, refetch, isRefetching } = useGetBallBoiReplay(id);

  let body: React.ReactNode;
  if (isLoading) {
    body = <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />;
  } else if (isError) {
    body = (
      <>
        <EmptyState
          symbol="exclamationmark.circle"
          title="Couldn't load this match"
          message="Check your connection and try again."
        />
        <Button label="Try again" variant="secondary" loading={isRefetching} onPress={() => refetch()} />
      </>
    );
  } else if (!data?.session) {
    body = (
      <EmptyState
        symbol="sportscourt"
        title="No replay for this match"
        message="Record a match with Ball Boi to get a replay."
      />
    );
  } else if (data.session.processingStatus !== "completed") {
    body = (
      <EmptyState
        symbol="hourglass"
        title="Analyzing"
        message="We'll let you know when your replay is ready."
      />
    );
  } else {
    body = (
      <EmptyState
        symbol="sportscourt"
        title="Replay is coming"
        message="Ball Boi has analyzed this match. The replay will show here in an upcoming update."
      />
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.paper,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.space4,
        paddingBottom: insets.bottom + spacing.space8,
      }}
    >
      {body}
    </View>
  );
}
