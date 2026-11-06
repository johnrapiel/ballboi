import { SymbolView } from "expo-symbols";
import React, { useState } from "react";
import { ScrollView, TextInput, View, useWindowDimensions } from "react-native";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { isSixAll, showsTiebreak, sixAllPrompt, type ScoreDraft, type SetEntry } from "@/lib/scoreEntry";

// The score boxes shared by Enter score (league matches and admin
// corrections) and the Quick match score sheet (approved canvas: Enter
// score). Names stay pinned on the left while the sets scroll sideways when
// there are more than fit. A set typed 6-6, or 7-6, shows its tiebreak boxes
// under the grid; at 6-6 they're needed to save (finding 5).

const digits = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 2);

function ScoreBox({
  value,
  onChange,
  label,
  disabled,
  width,
  height,
  small,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
  width: number;
  height: number;
  small?: boolean;
}) {
  const c = useColors();
  return (
    <TextInput
      value={disabled ? "" : value}
      onChangeText={(t) => onChange(digits(t))}
      editable={!disabled}
      placeholder={disabled ? "–" : undefined}
      placeholderTextColor={c.inkMuted}
      keyboardType="number-pad"
      maxLength={2}
      selectTextOnFocus
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      maxFontSizeMultiplier={1.5}
      textAlign="center"
      style={[
        type.scoreRow,
        {
          fontSize: small ? 24 : 30,
          lineHeight: undefined,
          width,
          height,
          padding: 0,
          borderRadius: radius.radiusMd,
          borderWidth: 1,
          borderColor: disabled ? c.hairline : c.hairlineStrong,
          backgroundColor: disabled ? "transparent" : c.linen,
          color: c.ink,
        },
      ]}
    />
  );
}

export function ScoreGrid({
  sets,
  onChange,
  firstName,
  secondName,
  activeSets,
  firstPossessive,
  secondPossessive,
}: {
  sets: SetEntry[];
  onChange: (set: number, patch: Partial<SetEntry>) => void;
  /** The top row, "You" or player 1 for an admin. */
  firstName: string;
  secondName: string;
  /** Sets in play. Columns after it are drawn greyed out (the third set before one set all). */
  activeSets: number;
  /** "Your", or "Sam's", for VoiceOver labels. */
  firstPossessive: string;
  secondPossessive: string;
}) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(Math.max(fontScale, 1), 1.5);
  const boxW = Math.round(56 * scale);
  const boxH = Math.max(MIN_TAP, Math.round(48 * scale));
  const [headH, setHeadH] = useState(0);
  const [rowH, setRowH] = useState<{ me: number; them: number }>({ me: boxH, them: boxH });
  const heightOf = (side: "me" | "them") => Math.max(boxH, rowH[side]);

  const names = (
    <View style={{ flexShrink: 1, flexGrow: 1, flexBasis: 0, minWidth: 72 }}>
      <View style={{ height: headH }} />
      {(["me", "them"] as const).map((side) => (
        <View
          key={side}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            setRowH((prev) => (Math.abs(prev[side] - h) > 1 && h > boxH ? { ...prev, [side]: h } : prev));
          }}
          style={{ minHeight: heightOf(side), justifyContent: "center", marginTop: side === "them" ? spacing.space2 : 0 }}
        >
          <Text variant="bodyStrong" importantForAccessibility="no" accessibilityElementsHidden>
            {side === "me" ? firstName : secondName}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={{ gap: spacing.space3 }}>
      <View style={{ flexDirection: "row", gap: spacing.space3 }}>
        {names}
        <ScrollView horizontal alwaysBounceHorizontal={false} showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
          <View style={{ flexDirection: "row", gap: spacing.space2 }}>
            {sets.map((s, i) => {
              const off = i >= activeSets;
              const n = i + 1;
              const offNote = off ? ". Only needed if you split the first two sets" : "";
              return (
                <View key={i} style={{ width: boxW }}>
                  <View
                    onLayout={i === 0 ? (e) => setHeadH(e.nativeEvent.layout.height) : undefined}
                    style={{ paddingBottom: spacing.space1 }}
                    importantForAccessibility="no-hide-descendants"
                    accessibilityElementsHidden
                  >
                    <Text variant="section" tone="inkMuted" style={{ textAlign: "center" }}>
                      {`Set ${n}`}
                    </Text>
                  </View>
                  {(["me", "them"] as const).map((side) => (
                    <View
                      key={side}
                      style={{ height: heightOf(side), justifyContent: "center", marginTop: side === "them" ? spacing.space2 : 0 }}
                    >
                      <ScoreBox
                        value={s[side]}
                        onChange={(v) => onChange(i, { [side]: v })}
                        disabled={off}
                        width={boxW}
                        height={boxH}
                        label={`Set ${n}, ${side === "me" ? firstPossessive : secondPossessive} games${off ? "" : `: ${s[side] || "empty"}`}${offNote}`}
                      />
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {sets.slice(0, activeSets).map((s, i) =>
        showsTiebreak(s) ? (
          <View
            key={`tb${i}`}
            accessibilityRole="none"
            style={{
              gap: spacing.space3,
              padding: spacing.space4,
              borderRadius: radius.radiusMd,
              borderWidth: 1,
              borderColor: c.ink,
              backgroundColor: c.linen,
            }}
          >
            <Text variant="bodyStrong" accessibilityLiveRegion={isSixAll(s) ? "polite" : "none"}>
              {isSixAll(s) ? sixAllPrompt(i + 1) : `Set ${i + 1} tiebreak`}
            </Text>
            {!isSixAll(s) ? (
              <Text variant="small" tone="inkMuted">
                Optional. Add it if you played one.
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.space3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
                <Text variant="small" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
                  {firstName}
                </Text>
                <ScoreBox
                  small
                  value={s.tbMe}
                  onChange={(v) => onChange(i, { tbMe: v })}
                  width={Math.round(48 * scale)}
                  height={boxH}
                  label={`Set ${i + 1} tiebreak, ${firstPossessive} points: ${s.tbMe || "empty"}`}
                />
              </View>
              <Text tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
                –
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
                <ScoreBox
                  small
                  value={s.tbThem}
                  onChange={(v) => onChange(i, { tbThem: v })}
                  width={Math.round(48 * scale)}
                  height={boxH}
                  label={`Set ${i + 1} tiebreak, ${secondPossessive} points: ${s.tbThem || "empty"}`}
                />
                <Text variant="small" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
                  {secondName}
                </Text>
              </View>
            </View>
          </View>
        ) : null,
      )}
    </View>
  );
}

/** "6-4, 7-6(5)" as it reads: en dashes, a space before the tiebreak. */
export const displayScore = (score: string) => score.replace(/-/g, "–").replace(/\(/g, " (");

/**
 * The line under the sets: who wins, worked out from the score, as a large
 * serif line with a check, or what's still needed. Announced as it changes.
 */
export function ScoreResult({
  draft,
  winner,
  prompt,
  error,
}: {
  draft: ScoreDraft;
  /** "You win", "Sam wins". */
  winner: string;
  /** What to show while the sets don't decide a winner yet. */
  prompt: string;
  /** A save that didn't go through. */
  error?: string | null;
}) {
  const c = useColors();
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: spacing.space1 }}>
      {draft.ok ? (
        <View
          accessible
          accessibilityLabel={`${winner}, ${draft.score.replace(/\((\d+)\)/g, ", tiebreak $1")}`}
          style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.space2 }}
        >
          <SymbolView name="checkmark" size={20} tintColor={c.ink} />
          <Text variant="title">{winner}</Text>
          <Text variant="title" style={{ fontVariant: ["lining-nums", "tabular-nums"] }}>
            {displayScore(draft.score)}
          </Text>
        </View>
      ) : (
        <Text variant={draft.message ? "bodyStrong" : "body"} tone={draft.message ? "ink" : "inkMuted"}>
          {draft.message ?? prompt}
        </Text>
      )}
      {error ? (
        <Text variant="small" tone="danger" accessibilityRole="alert">
          {`Not saved. ${error}`}
        </Text>
      ) : null}
    </View>
  );
}
