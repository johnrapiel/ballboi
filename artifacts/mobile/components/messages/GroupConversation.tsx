import { Stack, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { useActionSheet } from "@/components/ActionSheet";
import type { IconName } from "@/components/Icon";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderIconButton, PlainIconButton } from "@/components/Choice";
import { Icon } from "@/components/Icon";
import { BUBBLE_AVATAR, MessageBubble, type BubbleStatus } from "@/components/messages/MessageBubble";
import { Button, Text, useTypeStyle } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import {
  MessagesApiError,
  groupPage,
  useGroupMembers,
  useGroupThread,
  useMessagesActions,
  useFillScreen,
  useOlderMessages,
  type GroupMember,
  type GroupMessage,
} from "@/hooks/useMessages";
import { useReportBlock } from "@/hooks/useReportBlock";
import {
  insertMention,
  leagueMessageActions,
  mentionQuery,
  mentionSegments,
  pinsTitle,
  spokenGroupMessage,
  suggestMentions,
  type LeagueMessageAction,
} from "@/lib/leagueChat";
import { newClientMessageId } from "@/lib/messages";

// A group chat (F15, John, Nov 8): an open match's chat once its last spot
// fills (canvas W2_GroupChat, W2_DropOut). It runs on the same messaging
// service as Messages and shows there, with the same safety:
// - Long-press any player's message (or the VoiceOver action) to report it;
//   the server keeps a snapshot of the chat with the report.
// - A first message from someone outside your leagues can't carry links,
//   phone numbers or emails; the server says why and the text comes back.
// - Players you have a block with are left out of your view.
// - Lines from Ball Boi ("All 4 spots filled") are centered.
// Players in the header opens the players sheet (Remove for the poster, Drop
// out for everyone else). While a spot is open again, or after a cancel, the
// chat is read only with the reason in words.
//
// A league's chat (decisions 145 and 146) is the same screen, titled with the
// league name, plus:
// - Up to 3 posts admins pinned, in a collapsible bar at the top. A pinned
//   post shows a filled pin to everyone, and an admin's own posts carry a pin
//   button beside them: outline to pin, filled to unpin (finding 24). Members'
//   posts are pinned from the long-press menu.
// - Admin posts carry the Admin label (brush shield icon and the word).
// - Typing @ suggests league members, the way iOS Messages does; mentions
//   show in bold and VoiceOver reads them.
// - Admins get Pin, Delete, Mute and Remove from league in the long-press
//   menu, also a VoiceOver action ("More actions"). Each one lands in the
//   moderation queue on the server.
// - An ended league's chat is read only, with the reason above the composer.

interface Pending {
  clientId: string;
  text: string;
  at: string;
  status: Exclude<BubbleStatus, "sent">;
}

type Row = {
  key: string;
  text: string;
  at: string;
  fromMe: boolean;
  status: BubbleStatus;
  /** Null: a line from Ball Boi. */
  senderName: string | null;
  message?: GroupMessage;
  clientId?: string;
};

export function GroupConversation({
  groupId,
  fallbackTitle,
  fallbackOpenMatchId,
}: {
  /** Null while the open match is still finding its chat. */
  groupId: number | null;
  fallbackTitle?: string;
  fallbackOpenMatchId?: number;
}) {
  const c = useColors();
  const body = useTypeStyle("body");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const thread = useGroupThread(groupId);
  const history = useOlderMessages<GroupMessage>(groupId, thread.data, groupPage);
  // Short chats: keep loading earlier pages until they fill the screen.
  const fill = useFillScreen(history);
  const actions = useMessagesActions();
  const report = useReportBlock();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);

  const group = thread.data?.group;
  const title = group?.title ?? fallbackTitle ?? "Group chat";
  const openMatchId = group?.openMatchId ?? fallbackOpenMatchId ?? null;
  const subtitle = group ? `${group.memberCount} ${group.memberCount === 1 ? "player" : "players"}` : "";

  // League chats (decision 145).
  const league = group?.kind === "league";
  const leagueId = group?.leagueId ?? null;
  const isAdmin = league && !!group?.isAdmin;
  const pins = thread.data?.pins ?? [];
  const [pinsOpen, setPinsOpen] = useState(false);
  // The pin button's tap, shown straight away until the chat reloads (finding 24).
  const [pinFlip, setPinFlip] = useState<Record<string, boolean>>({});
  const isPinned = (id: string) => pinFlip[id] ?? pins.some((p) => p.id === id);
  const membersQ = useGroupMembers(league ? groupId : null);
  const members = membersQ.data ?? [];
  const myName = members.find((m) => m.me)?.name;
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  // Set only right after picking a mention, to put the caret after the name; typing stays uncontrolled.
  const [caretAfterMention, setCaretAfterMention] = useState<{ start: number; end: number } | undefined>(undefined);
  const mention = league ? mentionQuery(draft, selection.start) : null;
  const suggestions = mention ? suggestMentions(mention.query, members) : [];

  // Read new lines out as they arrive.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const messages = thread.data?.messages;
    if (!messages) return;
    if (!seen.current) {
      seen.current = new Set(messages.map((m) => m.id));
      return;
    }
    const fresh = messages.filter((m) => !seen.current!.has(m.id));
    fresh.forEach((m) => seen.current!.add(m.id));
    const incoming = fresh.filter((m) => !m.fromMe);
    if (incoming.length === 1) {
      const m = incoming[0];
      const from = m.admin ? `New admin post from ${m.senderName}` : `New message from ${m.senderName}`;
      AccessibilityInfo.announceForAccessibility(m.senderName ? `${from}: ${m.text}${m.mentionsMe ? ". Mentions you" : ""}` : m.text);
    } else if (incoming.length > 1) AccessibilityInfo.announceForAccessibility(`${incoming.length} new messages in ${title}`);
  }, [thread.data?.messages, title]);

  const serverMessages = useMemo(() => {
    const latest = thread.data?.messages ?? [];
    if (!history.older.length) return latest;
    const shown = new Set(history.older.map((m) => m.id));
    return [...history.older, ...latest.filter((m) => !shown.has(m.id))];
  }, [thread.data?.messages, history.older]);

  const rows: Row[] = useMemo(() => {
    const sent: Row[] = serverMessages.map((m) => ({
      key: m.id,
      text: m.text,
      at: m.at,
      fromMe: m.fromMe,
      status: "sent",
      senderName: m.senderName,
      message: m,
    }));
    // A pending message disappears once the server has it (its id ends with our client id).
    const waiting = pending
      .filter((p) => !serverMessages.some((m) => m.id.endsWith(`-${p.clientId}`)))
      .map<Row>((p) => ({ key: p.clientId, text: p.text, at: p.at, fromMe: true, status: p.status, senderName: "You", clientId: p.clientId }));
    // Inverted list: newest first.
    return [...sent, ...waiting].sort((a, b) => a.at.localeCompare(b.at)).reverse();
  }, [serverMessages, pending]);

  const showNotice = (text: string) => {
    setNotice(text);
    AccessibilityInfo.announceForAccessibility(text);
  };

  async function deliver(clientId: string, text: string) {
    if (!groupId) return;
    setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, status: "sending" } : p)));
    try {
      await actions.sendToGroup(groupId, text, clientId);
      await thread.refetch();
    } catch (e) {
      const err = e as MessagesApiError;
      if (err.status === 0 || err.status >= 500) {
        // Connection trouble: a failed bubble to retry, and VoiceOver hears it.
        setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, status: "failed" } : p)));
        AccessibilityInfo.announceForAccessibility("Message not sent. Double-tap it to retry.");
        return;
      }
      // The server said no (the filter, or the chat closed): put the text back and say why.
      setPending((list) => list.filter((p) => p.clientId !== clientId));
      setDraft((d) => (d ? d : text));
      showNotice(err.message);
      if (err.code === "closed") void thread.refetch();
    }
  }

  const send = () => {
    const text = draft.trim();
    if (!text || !groupId) return;
    const clientId = newClientMessageId();
    setNotice(null);
    setDraft("");
    setPending((list) => [...list, { clientId, text, at: new Date().toISOString(), status: "sending" }]);
    void deliver(clientId, text);
  };

  const retry = (clientId: string) => {
    const p = pending.find((x) => x.clientId === clientId);
    if (p) void deliver(clientId, p.text);
  };

  const canReport = (m?: GroupMessage) => !!m && !m.fromMe && m.senderName !== null && (m.senderPlayerId !== null || m.senderUserId !== null);

  const reportMessage = (m: GroupMessage) => {
    if (!groupId || !canReport(m)) return;
    report.open({ id: m.senderPlayerId, userId: m.senderUserId, name: m.senderName ?? "this player" }, { groupId, messageId: m.id });
  };

  const senderOf = (m: GroupMessage): GroupMember | undefined =>
    members.find((p) => !p.me && ((m.senderUserId !== null && p.userId === m.senderUserId) || (m.senderUserId === null && m.senderPlayerId !== null && p.playerId === m.senderPlayerId)));

  const done = (text: string) => {
    AccessibilityInfo.announceForAccessibility(text);
    void thread.refetch();
    void membersQ.refetch();
  };
  const failed = (e: unknown) => Alert.alert("That didn't work", (e as Error).message);

  const runLeagueAction = (m: GroupMessage, action: LeagueMessageAction) => {
    if (!groupId) return;
    const name = m.senderName ?? "this player";
    const sender = senderOf(m);
    const member = { userId: sender?.userId ?? m.senderUserId, playerId: sender?.playerId ?? m.senderPlayerId };
    switch (action) {
      case "pin":
        actions.pin(groupId, m.id).then(() => done("Pinned"), failed);
        return;
      case "unpin":
        actions.unpin(groupId, m.id).then(() => done("Unpinned"), failed);
        return;
      case "report":
        reportMessage(m);
        return;
      case "delete":
        Alert.alert("Delete this message?", "It's removed for everyone in the chat and sent to Ball Boi's moderators.", [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => void actions.adminDelete(groupId, m.id).then(() => done("Message deleted"), failed) },
        ]);
        return;
      case "mute":
        actions.mute(groupId, member).then(() => done(`${name} is muted in this chat`), failed);
        return;
      case "unmute":
        actions.unmute(groupId, member).then(() => done(`${name} can send again`), failed);
        return;
      case "remove":
        if (!leagueId || !sender?.playerId) return;
        Alert.alert(
          `Remove ${name} from ${title}?`,
          "Their played matches stay. Their remaining matches are cancelled and they leave the standings and this chat. Ball Boi's moderators are told.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Remove",
              style: "destructive",
              onPress: () => void actions.removeFromLeague(leagueId, sender.playerId!).then(() => done(`${name} removed from the league`), failed),
            },
          ],
        );
        return;
    }
  };

  const actionLabel = (m: GroupMessage, action: LeagueMessageAction): string => {
    const name = m.senderName ?? "this player";
    return {
      pin: "Pin post",
      unpin: "Unpin post",
      report: "Report message",
      delete: "Delete message",
      mute: `Mute ${name}`,
      unmute: `Unmute ${name}`,
      remove: `Remove ${name} from league`,
    }[action];
  };

  // The pin button on an admin's own post (finding 24). Long press keeps Pin and Unpin too.
  const togglePin = (m: GroupMessage) => {
    if (!groupId || m.id in pinFlip) return;
    const pinned = isPinned(m.id);
    if (!pinned && pins.length >= 3) {
      Alert.alert("Only 3 posts can be pinned", "Unpin one first, then pin this one.");
      return;
    }
    setPinFlip((f) => ({ ...f, [m.id]: !pinned }));
    const clear = () =>
      setPinFlip((f) => {
        const { [m.id]: _gone, ...rest } = f;
        return rest;
      });
    (pinned ? actions.unpin(groupId, m.id) : actions.pin(groupId, m.id))
      .then(async () => {
        AccessibilityInfo.announceForAccessibility(pinned ? "Unpinned" : "Pinned");
        await thread.refetch();
        clear();
      })
      .catch((e) => {
        clear();
        failed(e);
      });
  };

  const leagueActions = (m: GroupMessage): LeagueMessageAction[] => {
    const sender = senderOf(m);
    return leagueMessageActions({
      isAdmin,
      fromMe: m.fromMe,
      system: m.senderName === null,
      pinned: isPinned(m.id),
      pinsFull: pins.length >= 3,
      sender: sender ? { admin: sender.admin, muted: sender.muted, playerId: sender.playerId } : null,
    }).filter((a) => a !== "report" || canReport(m));
  };

  // A league chat's long press: Report for everyone, plus pins and moderation
  // for admins. A bottom sheet (decision 186); Delete and Remove still confirm.
  const sheet = useActionSheet();
  const actionIcon: Record<LeagueMessageAction, IconName> = {
    pin: "pin",
    unpin: "pin.fill",
    report: "exclamationmark.circle",
    delete: "trash",
    mute: "speaker.slash.fill",
    unmute: "speaker.wave.2.fill",
    remove: "minus.circle",
  };
  const leagueMenu = (m: GroupMessage) => {
    const list = leagueActions(m);
    if (!list.length) return;
    sheet.show({
      people: [{ name: m.senderName ?? "Ball Boi", photo: m.senderAvatarUrl }],
      rows: list.map((a) => ({
        label: actionLabel(m, a),
        icon: actionIcon[a],
        destructive: a === "delete" || a === "remove",
        onPress: () => runLeagueAction(m, a),
      })),
    });
  };

  const pickMention = (name: string) => {
    if (!mention) return;
    const next = insertMention(draft, mention.start, selection.start, name);
    setDraft(next.text);
    setSelection({ start: next.caret, end: next.caret });
    setCaretAfterMention({ start: next.caret, end: next.caret });
  };

  // Long press: Report is the only action (finding 20).
  const messageMenu = (m: GroupMessage) =>
    sheet.show({
      people: [{ name: m.senderName ?? "Player", photo: m.senderAvatarUrl }],
      rows: [{ label: "Report message", icon: "exclamationmark.circle", onPress: () => reportMessage(m) }],
    });

  const canSend = group?.canSend ?? false;
  const loading = groupId === null || thread.isPending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.paper }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      {sheet.element}
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerTintColor: c.ink,
          headerStyle: { backgroundColor: c.paper },
          headerTitle: () => (
            <View accessible accessibilityRole="header" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} style={{ alignItems: "center", maxWidth: 240 }}>
              <Text variant="bodyStrong" numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="small" tone="inkMuted" numberOfLines={1} maxFontSizeMultiplier={1.4}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ),
          headerRight: leagueId
            ? () => (
                <HeaderIconButton
                  symbol="trophy"
                  label="League"
                  hint="Opens the league page"
                  onPress={() => router.push({ pathname: "/league/[leagueId]", params: { leagueId: String(leagueId) } })}
                />
              )
            : group?.matchId
            ? () => (
                // D6: a doubles league match's chat opens the match.
                <HeaderIconButton
                  symbol="sportscourt"
                  label="Match"
                  hint="Opens the match, where any of you can enter the score"
                  onPress={() => router.push({ pathname: "/match/[matchId]", params: { matchId: String(group.matchId) } })}
                />
              )
            : openMatchId
            ? () => (
                <HeaderIconButton
                  symbol="person.2"
                  label="Players"
                  hint="Who's in, and dropping out"
                  onPress={() => router.push({ pathname: "/discover/match/players/[id]", params: { id: String(openMatchId) } })}
                />
              )
            : undefined,
        }}
      />

      {league && pins.length ? (
        <View style={{ borderBottomWidth: 1, borderBottomColor: c.hairline, backgroundColor: c.linen }}>
          <Pressable
            onPress={() => setPinsOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel={pinsTitle(pins.length)}
            accessibilityHint={pinsOpen ? "Hides the pinned posts" : "Shows the pinned posts"}
            accessibilityState={{ expanded: pinsOpen }}
            style={({ pressed }) => ({
              minHeight: MIN_TAP,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.space2,
              paddingHorizontal: spacing.space4,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Icon name="pin" size={18} tintColor={c.ink} />
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={pinsOpen ? undefined : 1}>
              {pinsOpen ? pinsTitle(pins.length) : `${pinsTitle(pins.length)}: ${pins[pins.length - 1].text}`}
            </Text>
            <Icon name="chevron.right" size={16} tintColor={c.inkMuted} style={{ transform: [{ rotate: pinsOpen ? "270deg" : "90deg" }] }} />
          </Pressable>
          {pinsOpen
            ? pins.map((p) => (
                <View
                  key={p.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.space2,
                    paddingLeft: spacing.space4 + 26,
                    paddingRight: spacing.space2,
                    paddingVertical: spacing.space2,
                    borderTopWidth: 1,
                    borderTopColor: c.hairline,
                  }}
                >
                  <View accessible accessibilityRole="text" style={{ flex: 1, gap: 2 }}>
                    <Text variant="small" tone="inkMuted">
                      {p.senderName === null ? "Ball Boi" : p.admin ? `${p.senderName} · Admin` : p.senderName}
                    </Text>
                    <Text>{p.text}</Text>
                  </View>
                  {isAdmin ? (
                    <Pressable
                      onPress={() => runLeagueAction(p, "unpin")}
                      accessibilityRole="button"
                      accessibilityLabel={`Unpin "${p.text.slice(0, 60)}"`}
                      style={({ pressed }) => ({ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
                    >
                      <Text variant="small" tone="ink" style={{ textDecorationLine: "underline" }}>
                        Unpin
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            : null}
        </View>
      ) : null}

      {thread.isError && !thread.data ? (
        <View style={{ flex: 1, padding: spacing.space6, gap: spacing.space4, alignItems: "center", justifyContent: "center" }}>
          <Text tone="inkMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
            {thread.error.message}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void thread.refetch()} />
        </View>
      ) : loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={c.ink} accessibilityLabel="Loading the group chat" />
      ) : (
        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingVertical: spacing.space3 }}
          keyboardDismissMode="interactive"
          // Inverted: the end is the top, where earlier messages load.
          onEndReached={history.hasMore ? history.loadMore : undefined}
          onEndReachedThreshold={0.5}
          onLayout={fill.onLayout}
          onContentSizeChange={fill.onContentSizeChange}
          ListFooterComponent={
            history.loading ? (
              <ActivityIndicator style={{ paddingVertical: spacing.space4 }} color={c.ink} accessibilityLabel="Loading earlier messages" />
            ) : history.error && history.hasMore ? (
              <View style={{ alignItems: "center", gap: spacing.space2, paddingVertical: spacing.space4 }}>
                <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
                  Earlier messages didn't load. {history.error}
                </Text>
                <Button label="Try again" variant="secondary" onPress={history.loadMore} />
              </View>
            ) : undefined
          }
          renderItem={({ item, index }) => {
            if (item.senderName === null) {
              const m = item.message;
              const canAct = league && !!m && leagueActions(m).length > 0;
              return (
                <Pressable
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={item.text}
                  accessibilityActions={canAct ? [{ name: "more", label: "More actions" }] : undefined}
                  onAccessibilityAction={canAct ? () => leagueMenu(m!) : undefined}
                  onLongPress={canAct ? () => leagueMenu(m!) : undefined}
                  delayLongPress={350}
                  style={{ paddingHorizontal: spacing.space8, paddingVertical: spacing.space2 }}
                >
                  <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
                    {item.text}
                  </Text>
                </Pressable>
              );
            }
            // The sender's name over their first message in a run (the row after is the one before in time).
            // Keyed by account, so two players with the same name still each get theirs.
            const before = rows[index + 1];
            const who = (r?: Row) => (r ? (r.fromMe ? "me" : `${r.message?.senderUserId ?? r.message?.senderPlayerId ?? ""}:${r.senderName}`) : null);
            const m = item.message;
            const adminPost = league && !!m?.admin;
            // An admin post always shows its label, yours included (decision 145).
            const showName = (!item.fromMe && (!before || before.senderName === null || who(before) !== who(item))) || adminPost;
            const more = league && m ? leagueActions(m) : [];
            const senderName = item.fromMe ? "You" : item.senderName;
            return (
              <View>
                {showName ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      alignSelf: item.fromMe ? "flex-end" : "flex-start",
                      gap: spacing.space1,
                      // Others' names line up with their bubbles, past the photo column.
                      paddingLeft: item.fromMe ? spacing.space4 + 4 : spacing.space4 + BUBBLE_AVATAR + spacing.space2 + 4,
                      paddingRight: spacing.space4 + 4,
                      marginTop: spacing.space2,
                    }}
                    importantForAccessibility="no-hide-descendants"
                    accessibilityElementsHidden
                  >
                    {!item.fromMe ? (
                      <Text variant="small" tone="inkMuted">
                        {item.senderName}
                      </Text>
                    ) : null}
                    {adminPost ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                        {!item.fromMe ? (
                          <Text variant="small" tone="inkMuted">
                            ·
                          </Text>
                        ) : null}
                        <Icon name="checkmark.shield" size={14} tintColor={c.ink} />
                        <Text variant="section" tone="ink">
                          Admin
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <MessageBubble
                  text={item.text}
                  at={item.at}
                  fromMe={item.fromMe}
                  senderName={senderName}
                  status={item.status}
                  onRetry={item.clientId ? () => retry(item.clientId!) : undefined}
                  onReport={canReport(m) ? () => reportMessage(m!) : undefined}
                  onLongPress={league ? (more.length ? () => leagueMenu(m!) : undefined) : canReport(m) ? () => messageMenu(m!) : undefined}
                  onMore={league && isAdmin && more.length ? () => leagueMenu(m!) : undefined}
                  segments={league && m?.mentions?.length ? mentionSegments(item.text, m.mentions, myName) : undefined}
                  spoken={league && m ? spokenGroupMessage({ ...m, senderName }) : undefined}
                  // The pin beside the message (finding 24): a button on an admin's own post, a filled pin on any pinned post.
                  pin={
                    league && m && item.status === "sent"
                      ? { pinned: isPinned(m.id), onToggle: isAdmin && item.fromMe ? () => togglePin(m) : undefined, busy: m.id in pinFlip }
                      : undefined
                  }
                  // Their photo beside the first message of each run, next to their name.
                  avatar={item.fromMe ? undefined : { name: item.senderName ?? "Player", uri: m?.senderAvatarUrl, show: !before || before.senderName === null || who(before) !== who(item) }}
                />
              </View>
            );
          }}
          ListEmptyComponent={
            // Inverted lists flip their children; flip the empty state back.
            <View style={{ transform: [{ scaleY: -1 }], padding: spacing.space8, alignItems: "center" }}>
              <Text tone="inkMuted" style={{ textAlign: "center" }}>
                {league ? "Say hi to your league. Type @ to mention someone." : "Say hi and settle the details."}
              </Text>
            </View>
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
        {canSend && suggestions.length ? (
          // @ suggestions (decision 145), like iOS Messages: league members whose name starts with what you typed.
          <View accessibilityLabel="Mention suggestions" style={{ borderRadius: radius.radiusLg, borderWidth: 1, borderColor: c.hairline, backgroundColor: c.paper, overflow: "hidden" }}>
            {suggestions.map((p, i) => (
              <Pressable
                key={`${p.userId ?? p.playerId ?? p.name}-${i}`}
                onPress={() => pickMention(p.name)}
                accessibilityRole="button"
                accessibilityLabel={`Mention ${p.name}`}
                style={({ pressed }) => ({
                  minHeight: MIN_TAP,
                  justifyContent: "center",
                  paddingHorizontal: spacing.space3,
                  borderTopWidth: i ? 1 : 0,
                  borderTopColor: c.hairline,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text variant="bodyStrong">{p.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {group && !canSend ? (
          <Text tone="inkMuted" style={{ textAlign: "center", paddingVertical: spacing.space3 }}>
            {group.sendBlockedReason ?? "This chat is closed."}
          </Text>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.space2 }}>
            <TextInput
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                if (notice) setNotice(null);
              }}
              selection={caretAfterMention}
              onSelectionChange={
                league
                  ? (e) => {
                      setSelection(e.nativeEvent.selection);
                      setCaretAfterMention(undefined);
                    }
                  : undefined
              }
              editable={!!group}
              placeholder="Message"
              placeholderTextColor={c.inkMuted}
              accessibilityLabel={`Message ${title}`}
              multiline
              maxLength={2000}
              maxFontSizeMultiplier={body.maxFontSizeMultiplier}
              style={[
                body.style,
                {
                  flex: 1,
                  minHeight: MIN_TAP,
                  maxHeight: 140,
                  paddingHorizontal: spacing.space3,
                  paddingTop: 11,
                  paddingBottom: 11,
                  borderRadius: radius.radiusLg,
                  borderWidth: 1,
                  borderColor: c.hairlineStrong,
                  backgroundColor: c.paper,
                  color: c.ink,
                },
              ]}
            />
            {/* Send is a plain brush icon, like the direct chat (design system: Buttons and icons, kind 2). */}
            <PlainIconButton symbol="arrow.up.circle" label="Send" onPress={send} disabled={!draft.trim() || !group} size={26} />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
