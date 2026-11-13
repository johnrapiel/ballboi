import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Icon } from "@/components/Icon";
import React, { useState } from "react";
import { AccessibilityInfo, Alert, Pressable, TextInput, View } from "react-native";

import { CheckboxCard } from "@/components/CheckboxCard";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Card, Text, useTypeStyle } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { discoverKeys } from "@/hooks/useDiscover";
import { messagesKeys } from "@/hooks/useMessages";
import { BLOCK_EFFECTS, REPORT_REASONS, type ReportReasonCode } from "@/hooks/useReportBlock";
import { apiErrorMessage, apiFetch } from "@/lib/api";

// Report (spec: Messaging and moderation; App Store guideline 1.2; John,
// Nov 6, finding 20; F3 and F9, Nov 7). The only safety action anywhere a
// player shows: a chat, a message, a league player, a Discover player card.
// The same six reasons everywhere, in this order; "Something else" opens a
// required "Tell us what happened" field, and the others have no note. Tick
// "Also block [name]" to block them too: no messages either way, and they're
// out of Discover, search and pairing. A bottom sheet, by the sheet rule:
// brush title, Close (X) or drag down to close, asks before discarding.
//
// The route's playerId is a league player id, or "u<userId>" for a Discover
// player who has no league player record yet.

export default function ReportSheet() {
  const c = useColors();
  const body = useTypeStyle("body");
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ playerId: string; name?: string; conversationId?: string; groupId?: string; messageId?: string }>();
  const byUser = params.playerId?.startsWith("u") ?? false;
  const targetId = Number(byUser ? params.playerId.slice(1) : params.playerId);
  const name = params.name ?? "this player";
  const conversationId = params.conversationId ? Number(params.conversationId) : null;
  // A message in a group chat (F15): the same report, through the group's route.
  const groupId = params.groupId ? Number(params.groupId) : null;
  const messageId = params.messageId ?? null;
  const aboutMessage = (conversationId != null || groupId != null) && !!messageId;

  const [reason, setReason] = useState<ReportReasonCode | null>(null);
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheet = useSheetClose((reason !== null || alsoBlock || details.trim() !== "") && !sending);

  const needsDetails = reason === "other";
  const ready = reason !== null && (!needsDetails || details.trim().length > 0);
  const note = needsDetails ? details.trim() : undefined;

  /** Blocks by league player, else by account (a Discover player). */
  async function block(): Promise<boolean> {
    const res = byUser
      ? await apiFetch(`/api/discover/players/${targetId}/block`, getToken, { method: "POST" })
      : await apiFetch(`/api/players/${targetId}/block`, getToken, { method: "POST" });
    return res.ok;
  }

  async function send() {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      let blocked = false;
      if (aboutMessage) {
        const path = groupId != null ? `/api/messages/groups/${groupId}/report` : `/api/messages/${conversationId}/report`;
        const res = await apiFetch(path, getToken, {
          method: "POST",
          body: JSON.stringify({ messageId, reason, details: note }),
        });
        if (!res.ok) throw new Error(await apiErrorMessage(res, "We couldn't send your report. Try again."));
      } else if (byUser) {
        // A Discover player: report and block in one call.
        const res = await apiFetch(`/api/discover/players/${targetId}/report`, getToken, {
          method: "POST",
          body: JSON.stringify({ reason, details: note, block: alsoBlock }),
        });
        if (!res.ok) throw new Error(await apiErrorMessage(res, "We couldn't send your report. Try again."));
        blocked = ((await res.json()) as { blocked?: boolean }).blocked === true;
      } else {
        const res = await apiFetch("/api/reports", getToken, {
          method: "POST",
          body: JSON.stringify({ targetType: "player", targetId: String(targetId), reason, details: note }),
        });
        if (!res.ok) throw new Error(await apiErrorMessage(res, "We couldn't send your report. Try again."));
      }
      // A Discover player's own report already blocked them in the same call.
      if (alsoBlock && !(byUser && !aboutMessage)) blocked = await block();
      // Blocked players leave Discover, search and messages at once.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: messagesKeys.all }),
        queryClient.invalidateQueries({ queryKey: discoverKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["players", "search"] }),
      ]);
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
              accessibilityHint={r.code === "other" ? "Opens a field to tell us what happened" : undefined}
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
              <View style={{ width: 20, alignItems: "center" }}>{on ? <Icon name="checkmark" size={16} tintColor={c.ink} /> : null}</View>
            </Pressable>
          );
        })}
      </Card>

      {needsDetails ? (
        <View style={{ gap: spacing.space2 }}>
          <Text variant="bodyStrong" importantForAccessibility="no" accessibilityElementsHidden>
            Tell us what happened
          </Text>
          <TextInput
            value={details}
            onChangeText={(t) => {
              setDetails(t.slice(0, 1000));
              setError(null);
            }}
            multiline
            maxLength={1000}
            accessibilityLabel="Tell us what happened"
            accessibilityHint="Required for Something else"
            placeholderTextColor={c.inkMuted}
            style={[
              body.style,
              {
                minHeight: 88,
                paddingHorizontal: 14,
                paddingVertical: spacing.space3,
                borderRadius: radius.radiusSm,
                borderWidth: 1,
                borderColor: c.hairlineStrong,
                backgroundColor: c.linen,
                color: c.ink,
                textAlignVertical: "top",
              },
            ]}
            maxFontSizeMultiplier={body.maxFontSizeMultiplier}
          />
        </View>
      ) : null}

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
        disabled={!ready}
        loading={sending}
        accessibilityHint={reason == null ? "Pick a reason first" : needsDetails && !ready ? "Tell us what happened first" : undefined}
      />
    </SheetBody>
  );
}
