import { Icon } from "@/components/Icon";
import React from "react";
import { Pressable, View } from "react-native";

import type { LeagueWeekLeague } from "@workspace/api-client-react";

import { Card, Chip, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { leagueLine, ordinal } from "@/lib/myMatches";

// Leagues on Home (finding 14; approved design audit, Home and "In two
// leagues"). With one league, its standings: the top three plus your row,
// wins and losses only, titled with the league's name, See all opening the
// league. With two or more, "Your leagues" lists each one and opens its page.

const rowStyle = (c: ReturnType<typeof useColors>, last: boolean) => ({
  minHeight: 52,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: spacing.space3,
  paddingHorizontal: spacing.space4,
  paddingVertical: spacing.space3,
  borderBottomWidth: last ? 0 : 1,
  borderBottomColor: c.hairline,
});

function SectionHead({ title, onSeeAll, seeAllLabel }: { title: string; onSeeAll?: () => void; seeAllLabel?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.space3, marginTop: spacing.space2, paddingHorizontal: spacing.space1 }}>
      <Text variant="section" tone="inkMuted" accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      {onSeeAll ? <SeeAll onPress={onSeeAll} accessibilityLabel={seeAllLabel ?? "See all"} /> : null}
    </View>
  );
}

/** The "See all" text button beside a section label: 44pt, underlined so it reads as a link. */
export function SeeAll({ onPress, accessibilityLabel }: { onPress: () => void; accessibilityLabel: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={spacing.space1}
      style={({ pressed }) => ({ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", alignItems: "flex-end", opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ textDecorationLine: "underline" }}>See all</Text>
    </Pressable>
  );
}

function Standings({ league, onOpen }: { league: LeagueWeekLeague; onOpen: () => void }) {
  const c = useColors();
  return (
    <>
      <SectionHead title={league.leagueName} onSeeAll={onOpen} seeAllLabel={`See all standings for ${league.leagueName}`} />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {league.rows.length === 0 ? (
          <View style={rowStyle(c, true)}>
            <Text tone="inkMuted">Standings show up here after the first scores are in.</Text>
          </View>
        ) : (
          league.rows.map((r, n) => (
            <View
              key={r.playerId}
              accessible
              accessibilityLabel={`${ordinal(r.rank)}, ${r.you ? "you, " : ""}${r.playerName}, ${r.wins} wins, ${r.losses} losses`}
              style={[rowStyle(c, n === league.rows.length - 1), r.you ? { backgroundColor: c.sand } : null]}
            >
              <Text tone={r.you ? "ink" : "inkMuted"} style={{ minWidth: 24, fontVariant: ["lining-nums", "tabular-nums"] }}>
                {r.rank}
              </Text>
              <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}>
                <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
                  {r.playerName}
                </Text>
                {r.you ? <Chip label="You" tone="ink" /> : null}
              </View>
              <Text style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>{`${r.wins}–${r.losses}`}</Text>
            </View>
          ))
        )}
      </Card>
    </>
  );
}

function YourLeagues({ leagues, onOpen }: { leagues: LeagueWeekLeague[]; onOpen: (leagueId: number) => void }) {
  const c = useColors();
  return (
    <>
      <SectionHead title="Your leagues" />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {leagues.map((l, n) => (
          <Pressable
            key={l.leagueId}
            onPress={() => onOpen(l.leagueId)}
            accessibilityRole="button"
            accessibilityLabel={`${l.leagueName}. ${leagueLine(l).replace(/·/g, ",").replace(/–/g, " and ")}`}
            accessibilityHint="Opens the league"
            style={({ pressed }) => [rowStyle(c, n === leagues.length - 1), { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{l.leagueName}</Text>
              <Text variant="small" tone="inkMuted" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
                {leagueLine(l)}
              </Text>
            </View>
            <Icon name="chevron.right" size={13} tintColor={c.inkMuted} />
          </Pressable>
        ))}
      </Card>
    </>
  );
}

export function HomeLeagues({ leagues, onOpen }: { leagues: LeagueWeekLeague[]; onOpen: (leagueId: number) => void }) {
  if (leagues.length === 0) return null;
  if (leagues.length === 1) return <Standings league={leagues[0]} onOpen={() => onOpen(leagues[0].leagueId)} />;
  return <YourLeagues leagues={leagues} onOpen={onOpen} />;
}

export { SectionHead };
