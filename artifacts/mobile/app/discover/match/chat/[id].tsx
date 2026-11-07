// The group chat of a filled open match (canvas W2_GroupChat, W2_DropOut;
// brief items 40, 42, 43). "Sat doubles, 1 PM" with "4 players · Beacon
// Courts"; Players in the header opens the players sheet (Remove for the
// poster, Drop out for everyone else). Lines from Ball Boi ("All 4 spots
// filled") are centered. Long-press a message to report its sender.

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActionSheetIOS, FlatList, KeyboardAvoidingView, Platform, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderIconButton } from "@/components/Choice";
import { MessageBubble } from "@/components/messages/MessageBubble";
import { Button, Text, useTypeStyle } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useGroupChat, useOpenMatch, useSendGroupMessage } from "@/hooks/useDiscoverOpenMatches";
import { useReportBlock } from "@/hooks/useReportBlock";
import type { GroupMessage } from "@/lib/discover";

export default function GroupChatScreen() {
  const c = useColors();
  const body = useTypeStyle("body");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);
  const match = useOpenMatch(id);
  const chat = useGroupChat(id);
  const send = useSendGroupMessage(id);
  const report = useReportBlock();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const m = match.data;

  const rows = useMemo(() => [...(chat.data?.messages ?? [])].reverse(), [chat.data]);

  // Read new lines out as they arrive.
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const list = chat.data?.messages ?? [];
    const last = list[list.length - 1];
    if (!last) return;
    if (seen.current != null && last.id > seen.current && !last.fromMe) {
      AccessibilityInfo.announceForAccessibility(last.senderName ? `${last.senderName}: ${last.text}` : last.text);
    }
    seen.current = last.id;
  }, [chat.data]);

  async function submit() {
    const text = draft.trim();
    if (!text) return;
    setNotice(null);
    setDraft("");
    try {
      await send.mutateAsync(text);
    } catch (e) {
      setDraft(text);
      const msg = e instanceof Error ? e.message : "Not sent. Try again.";
      setNotice(msg);
      AccessibilityInfo.announceForAccessibility(msg);
    }
  }

  function messageMenu(item: GroupMessage) {
    if (!item.senderUserId || item.fromMe) return;
    const open = () => report.open({ id: null, userId: item.senderUserId, name: item.senderName ?? "this player" });
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [`Report ${item.senderName ?? "player"}`, "Cancel"], cancelButtonIndex: 1 },
        (i) => i === 0 && open(),
      );
    } else open();
  }

  const subtitle = m ? `${m.total - m.spotsLeft} players${m.courtName ? ` · ${m.courtName}` : ""}` : "";
  const open = chat.data?.open ?? true;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.paper }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View
              accessible
              accessibilityRole="header"
              accessibilityLabel={`${m?.chatTitle ?? "Group chat"}. ${subtitle}`}
              style={{ alignItems: "center" }}
            >
              <Text variant="bodyStrong" maxFontSizeMultiplier={1.4}>
                {m?.chatTitle ?? "Group chat"}
              </Text>
              {subtitle ? (
                <Text variant="small" tone="inkMuted" maxFontSizeMultiplier={1.4}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ),
          headerRight: () => (
            <HeaderIconButton
              symbol="person.2"
              label="Players"
              hint="Who's in, and dropping out"
              onPress={() => router.push({ pathname: "/discover/match/players/[id]", params: { id: String(id) } })}
            />
          ),
        }}
      />
      {chat.isError && !chat.data ? (
        <View style={{ flex: 1, padding: spacing.space6, gap: spacing.space4, justifyContent: "center" }}>
          <Text tone="inkMuted" style={{ textAlign: "center" }}>
            {chat.error.message}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void chat.refetch()} />
        </View>
      ) : (
        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={{ paddingVertical: spacing.space3 }}
          keyboardDismissMode="interactive"
          renderItem={({ item }) =>
            item.senderName == null ? (
              <View accessible accessibilityRole="text" style={{ paddingHorizontal: spacing.space8, paddingVertical: spacing.space2 }}>
                <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
                  {item.text}
                </Text>
              </View>
            ) : (
              <View>
                {!item.fromMe ? (
                  <Text
                    variant="small"
                    tone="inkMuted"
                    style={{ paddingHorizontal: spacing.space4 + 4, marginTop: spacing.space1 }}
                    importantForAccessibility="no"
                  >
                    {item.senderName}
                  </Text>
                ) : null}
                <MessageBubble
                  text={item.text}
                  at={item.at}
                  fromMe={item.fromMe}
                  senderName={item.senderName}
                  status="sent"
                  onReport={!item.fromMe && item.senderUserId ? () => messageMenu(item) : undefined}
                  onLongPress={!item.fromMe && item.senderUserId ? () => messageMenu(item) : undefined}
                />
              </View>
            )
          }
        />
      )}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          backgroundColor: c.linen,
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space2,
          paddingBottom: insets.bottom + spacing.space2,
          gap: spacing.space2,
        }}
      >
        {notice ? (
          <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}
        {open ? (
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.space2 }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor={c.inkMuted}
              accessibilityLabel="Message"
              multiline
              maxLength={2000}
              maxFontSizeMultiplier={body.maxFontSizeMultiplier}
              style={[
                body.style,
                {
                  flex: 1,
                  minHeight: MIN_TAP,
                  maxHeight: 140,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: radius.radiusMd,
                  borderWidth: 1,
                  borderColor: c.hairlineStrong,
                  backgroundColor: c.paper,
                  color: c.ink,
                },
              ]}
            />
            <Button
              label="Send"
              onPress={() => void submit()}
              disabled={!draft.trim()}
              loading={send.isPending}
              style={{ paddingHorizontal: spacing.space4 }}
            />
          </View>
        ) : (
          <Text tone="inkMuted" style={{ textAlign: "center", paddingVertical: spacing.space3 }}>
            A spot opened again. The chat picks up when it's full.
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
