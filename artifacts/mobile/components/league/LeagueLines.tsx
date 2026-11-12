import { router } from "expo-router";
import React from "react";
import { Pressable, View } from "react-native";

import { useGetMyPartner } from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Text, TextLink } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { partnerLine } from "@/lib/doubles";

// Plain lines under the league name instead of cards (finding 31, decision
// 185, John, Nov 12): your partner, and for admins the pairings waiting for
// review. Each link is its own 44pt target and VoiceOver link; the lines wrap
// at large text sizes.

/** Link text with a 44pt target, for a line that isn't a sentence. */
function LineLink({ label, spoken, hint, onPress }: { label: string; spoken?: string; hint?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={spoken ?? label}
      accessibilityHint={hint}
      style={({ pressed }) => ({ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", maxWidth: "100%", opacity: pressed ? 0.6 : 1 })}
    >
      <TextLink onPress={onPress} accessible={false}>
        {label}
      </TextLink>
    </Pressable>
  );
}

const row = { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.space2 } as const;

/**
 * Fixed-partner doubles only: "Partner: Ryan O'Connor" (the name opens their
 * player card), or "No partner yet · Team up" where Team up opens the Team up
 * sheet. Rotating-partner leagues and non-members see nothing.
 */
export function PartnerLine({ leagueId }: { leagueId: number }) {
  const c = useColors();
  const q = useGetMyPartner(leagueId);
  const v = q.data;
  const line = v ? partnerLine(v) : null;
  if (!v || !line) return null;

  if (line.kind === "partner") {
    const p = v.partner!;
    const openCard = p.userId != null ? () => router.push({ pathname: "/discover/player/[userId]", params: { userId: String(p.userId) } }) : null;
    return (
      <View style={row}>
        <Avatar name={p.name} uri={p.photoUrl} size={28} />
        <Text tone="inkMuted">Partner:</Text>
        {openCard ? (
          <LineLink label={p.name} spoken={`Partner, ${p.name}`} hint="Opens their player card" onPress={openCard} />
        ) : (
          <Text style={{ flexShrink: 1 }}>{p.name}</Text>
        )}
      </View>
    );
  }

  const openSheet = () => router.push({ pathname: "/league/[leagueId]/partner", params: { leagueId: String(leagueId) } });
  return (
    <View style={row}>
      <Icon name="person.2" size={20} tintColor={c.inkMuted} />
      <Text tone="inkMuted" style={{ flexShrink: 1 }}>{`${line.lead} ·`}</Text>
      <LineLink label="Team up" hint="Opens your options for finding a partner" onPress={openSheet} />
    </View>
  );
}

/** Admins, when a round's pairings wait: "Round 4 pairings are ready. Review". */
export function PairingsLine({ roundNumber, onReview }: { roundNumber: number; onReview: () => void }) {
  return (
    <View style={row}>
      <Text style={{ flexShrink: 1 }}>{`Round ${roundNumber} pairings are ready.`}</Text>
      <LineLink label="Review" spoken={`Review round ${roundNumber} pairings`} onPress={onReview} />
    </View>
  );
}
