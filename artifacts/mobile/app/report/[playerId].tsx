import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useState } from "react";
import { AccessibilityInfo, Alert, Pressable, View } from "react-native";

import { CheckboxCard } from "@/components/CheckboxCard";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { messagesKeys } from "@/hooks/useMessages";
import { BLOCK_EFFECTS, REPORT_REASONS, type ReportReasonCode } from "@/hooks/useReportBlock";
import { apiErrorMessage, apiFetch } from "@/lib/api";

// Report (spec: Messaging and moderation; App Store guideline 1.2; John,
// Nov 6, finding 20). The only safety action anywhere a player shows. Pick a
// reason, and tick "Also block [name]" to block them too: no messages either
// way, and they're out of search and pairing. A bottom sheet, by the sheet
// rule: brush title, no Cancel, drag down to close, asks before discarding.

export default function ReportSheet() {
  const c = useColors();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ playerId: string; name?: string; conversationId?: string; messageId?: string }>();
  const playerId = Number(params.playerId);
  const name = params.name ?? "this player";
  const conversationId = params.conversationId ? Number(params.conversationId) : null;
  const messageId = params.messageId ?? null;
  const aboutMessage = conversationId != null && !!messageId;

  const [reason, setReason] = useState<ReportReasonCode | null>(null);
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheet = useSheetClose((reason !== null || alsoBlock) && !sending);

  async function send() {
    if (!reason || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = aboutMessage
        ? await apiFetch(`/api/messages/${conversationId}/report`, getToken, { method: "POST", body: JSON.stringify({ messageId, reason }) })
        : await apiFetch("/api/reports", getToken, {
            method: "POST",
            body: JSON.stringify({ targetType: "player", targetId: String(playerId), reason }),
          });
      if (!res.ok) throw new Error(await apiErrorMessage(res, "We couldn't send your report. Try again."));
      let blocked = false;
      if (alsoBlock) {
        const b = await apiFetch(`/api/players/${playerId}/block`, getToken, { method: "POST" });
        blocked = b.ok;
      }
      await queryClient.invalidateQueries({ queryKey: messagesKeys.all });
      const said = blocked
        ? `Report sent, and ${name} is blocked.`
        : alsoBlock
          ? `Report sent, but ${name} couldn't be blocked. Try again from Report.`
          : "Report sent.";
      AccessibilityInfo.announceForAccessibility(said);
      Alert.alert(
        blocked ? `Report sent. ${name} is blocked.` : "Report sent",
        `Thanks for letting us know. We review every report within 24 hours.${blocked ? ` ${BLOCK_EFFECTS}` : alsoBlock ? ` ${name} couldn't be blocked. Try again from Report.` : ""}`,
      );
      sheet.finish();
    } catch (e) {
      setError((e as Error).message || "Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <SheetBody title="Report" close={sheet.close}>
      <Text tone="inkMuted">
        {aboutMessage ? `Why are you reporting this message from ${name}?` : `Why are you reporting ${name}?`}
      </Text>

      <Card style={{ padding: 0, overflow: "hidden" }} accessibilityRole="radiogroup" accessibilityLabel="Reason">
        {REPORT_REASONS.map((r, i) => {
          const on = reason === r.code;
          return (
            <Pressable
              key={r.code}
              onPress={() => {
                setReason(r.code);
                setError(null);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={r.label}
              style={({ pressed }) => ({
                minHeight: 52,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.space3,
                paddingHorizontal: spacing.space4,
                paddingVertical: spacing.space3,
                borderBottomWidth: i === REPORT_REASONS.length - 1 ? 0 : 1,
                borderBottomColor: c.hairline,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text variant={on ? "bodyStrong" : "body"} style={{ flex: 1 }}>
                {r.label}
              </Text>
              {/* A check, not color, marks the reason picked. */}
              <View style={{ width: 20, alignItems: "center" }}>{on ? <SymbolView name="checkmark" size={16} tintColor={c.ink} /> : null}</View>
            </Pressable>
          );
        })}
      </Card>

      <CheckboxCard
        title={`Also block ${name}`}
        description={`${BLOCK_EFFECTS} They aren't told. You can unblock from your chat with them.`}
        checked={alsoBlock}
        onPress={() => setAlsoBlock((v) => !v)}
      />

      {error ? (
        <Text variant="small" tone="danger" accessibilityRole="alert">
          {`Not sent. ${error}`}
        </Text>
      ) : null}

      <Button
        label={alsoBlock ? "Send report and block" : "Send report"}
        variant={alsoBlock ? "destructive" : "primary"}
        onPress={() => void send()}
        disabled={!reason}
        loading={sending}
        accessibilityHint={reason ? undefined : "Pick a reason first"}
      />
    </SheetBody>
  );
}
