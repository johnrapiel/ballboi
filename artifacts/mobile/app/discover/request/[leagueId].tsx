// Request a spot (canvas W2_RequestSpot; brief item 18). The organizer sees
// your profile with your request, and an optional note. A bottom sheet by the
// sheet rule.

import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { AccessibilityInfo, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { RatingBadge } from "@/components/RatingBadge";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Card, Field, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useAskToJoin } from "@/hooks/useDiscoverLeagues";
import { useProfile } from "@/hooks/useProfile";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { firstName } from "@/lib/discover";
import { photoUrl } from "@/lib/photos";

export default function RequestSpotSheet() {
  const params = useLocalSearchParams<{ leagueId: string; organizer?: string }>();
  const leagueId = Number(params.leagueId);
  const organizer = firstName(params.organizer ?? "the organizer");
  const { profile } = useProfile();
  const ask = useAskToJoin(leagueId);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sheet = useSheetClose(note.trim() !== "" && !ask.isPending);

  async function send() {
    setError(null);
    try {
      const r = await ask.mutateAsync(note.trim() || null);
      AccessibilityInfo.announceForAccessibility(r.kind === "waitlist" ? "You're on the waitlist" : "Request sent");
      sheet.finish();
    } catch (e) {
      setError(isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Couldn't send your request. Try again.");
    }
  }

  return (
    <SheetBody title="Request a spot" close={sheet.close}>
      <Text tone="inkMuted">{`${organizer} sees your profile with your request:`}</Text>
      {profile ? (
        <Card
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}
          accessible
          accessibilityLabel={`${profile.displayName}${profile.rating != null ? `, level ${profile.rating}` : ""}`}
        >
          <Avatar name={profile.displayName} uri={photoUrl(profile.avatarUrl)} size={44} />
          <View style={{ flex: 1, gap: spacing.space1 }}>
            <Text variant="bodyStrong">{profile.displayName}</Text>
            {profile.rating != null ? (
              <RatingBadge rating={profile.rating} source={profile.ratingSource === "verified" ? "verified" : "self"} />
            ) : null}
          </View>
        </Card>
      ) : null}
      <Field
        label={`Note to ${organizer} (optional)`}
        value={note}
        onChangeText={(t) => setNote(t.slice(0, 300))}
        multiline
        maxLength={300}
        style={{ minHeight: 72, paddingTop: spacing.space3, textAlignVertical: "top" }}
        error={!!error}
        hint={error ?? undefined}
      />
      <Button label="Send request" onPress={() => void send()} loading={ask.isPending} />
    </SheetBody>
  );
}
