import { describe, expect, it } from "vitest";

import {
  badgeText,
  chatButtonLabel,
  insertMention,
  leagueMessageActions,
  leagueRowLabel,
  mentionQuery,
  mentionSegments,
  pinsTitle,
  spokenGroupMessage,
  suggestMentions,
} from "../leagueChat";

// League chat (decisions 145 and 146): @mentions, the Admin label for
// VoiceOver, the league row, the Chat button and the admin menu.

const members = [
  { name: "John Rapiel", me: true },
  { name: "Sam Patel" },
  { name: "Ana Ruiz" },
  { name: "Samira Khan" },
];

describe("@ suggestions", () => {
  it("opens on an @ that starts a word, never in an email address", () => {
    expect(mentionQuery("Hey @")).toEqual({ query: "", start: 4 });
    expect(mentionQuery("@sa")).toEqual({ query: "sa", start: 0 });
    expect(mentionQuery("Hey @Sam P")).toEqual({ query: "Sam P", start: 4 });
    expect(mentionQuery("mail sam@ex.com")).toBeNull();
    expect(mentionQuery("@Sam Patel see you")).toBeNull();
    expect(mentionQuery("no at here")).toBeNull();
  });

  it("follows the caret, not the end of the text", () => {
    expect(mentionQuery("@an and more", 3)).toEqual({ query: "an", start: 0 });
  });

  it("suggests league members by any word of their name, never you", () => {
    expect(suggestMentions("sa", members).map((m) => m.name)).toEqual(["Sam Patel", "Samira Khan"]);
    expect(suggestMentions("ruiz", members).map((m) => m.name)).toEqual(["Ana Ruiz"]);
    expect(suggestMentions("", members).map((m) => m.name)).toEqual(["Ana Ruiz", "Sam Patel", "Samira Khan"]);
    expect(suggestMentions("john", members)).toEqual([]);
  });

  it("puts the full name in, with a space after it", () => {
    expect(insertMention("Hey @sa", 4, 7, "Sam Patel")).toEqual({ text: "Hey @Sam Patel ", caret: 15 });
    expect(insertMention("@an see you", 0, 3, "Ana Ruiz")).toEqual({ text: "@Ana Ruiz see you", caret: 10 });
  });
});

describe("showing mentions", () => {
  it("marks only the names the server says it mentions", () => {
    expect(mentionSegments("@Sam Patel and @Bob, Thursday?", ["Sam Patel"])).toEqual([
      { text: "@Sam Patel", mention: true },
      { text: " and @Bob, Thursday?", mention: false },
    ]);
    expect(mentionSegments("thanks @john rapiel", ["You"], "John Rapiel")).toEqual([
      { text: "thanks ", mention: false },
      { text: "@john rapiel", mention: true },
    ]);
    expect(mentionSegments("plain", [])).toEqual([{ text: "plain", mention: false }]);
  });

  it("reads the Admin label and mentions to VoiceOver", () => {
    expect(spokenGroupMessage({ senderName: "John Rapiel", text: "Courts closed", admin: true })).toBe("John Rapiel, Admin, Courts closed");
    expect(spokenGroupMessage({ senderName: "Sam Patel", text: "@John Rapiel hi", mentionsMe: true, mentions: ["You"] })).toBe(
      "Sam Patel, @John Rapiel hi. Mentions you",
    );
    expect(spokenGroupMessage({ senderName: "Sam Patel", text: "@Ana Ruiz hi", mentions: ["Ana Ruiz"] })).toBe("Sam Patel, @Ana Ruiz hi. Mentions Ana Ruiz");
  });
});

describe("rows and buttons", () => {
  it("reads a league chat's row as a group, with its unread count", () => {
    const g = { title: "Spring Ladder", unread: 3, canSend: true, lastMessage: { text: "Round 4 pairings are out.", fromMe: false, senderName: null } };
    expect(leagueRowLabel(g, "5:02 PM")).toBe("League chat, Spring Ladder. 3 unread. Round 4 pairings are out.. 5:02 PM");
    expect(leagueRowLabel({ ...g, unread: 0, lastMessage: null, canSend: false }, null)).toBe("League chat, Spring Ladder. No messages yet. Read only");
  });

  it("labels the Chat button and its badge", () => {
    expect(chatButtonLabel(0)).toBe("Chat");
    expect(chatButtonLabel(4)).toBe("Chat, 4 unread");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(120)).toBe("99+");
    expect(pinsTitle(1)).toBe("1 pinned post");
    expect(pinsTitle(3)).toBe("3 pinned posts");
  });
});

describe("the long-press menu", () => {
  const sender = { admin: false, muted: false, playerId: 4 };
  it("gives members Report only", () => {
    expect(leagueMessageActions({ isAdmin: false, fromMe: false, system: false, pinned: false, pinsFull: false, sender })).toEqual(["report"]);
    expect(leagueMessageActions({ isAdmin: false, fromMe: true, system: false, pinned: false, pinsFull: false, sender: null })).toEqual([]);
  });

  it("gives admins pins and moderation", () => {
    expect(leagueMessageActions({ isAdmin: true, fromMe: false, system: false, pinned: false, pinsFull: false, sender })).toEqual([
      "pin",
      "report",
      "delete",
      "mute",
      "remove",
    ]);
    expect(leagueMessageActions({ isAdmin: true, fromMe: false, system: false, pinned: true, pinsFull: true, sender: { ...sender, muted: true } })).toEqual([
      "unpin",
      "report",
      "delete",
      "unmute",
      "remove",
    ]);
  });

  it("never offers Pin past 3, or moderation on Ball Boi's posts, another admin or yourself", () => {
    expect(leagueMessageActions({ isAdmin: true, fromMe: false, system: true, pinned: false, pinsFull: true, sender: null })).toEqual([]);
    expect(leagueMessageActions({ isAdmin: true, fromMe: false, system: false, pinned: false, pinsFull: false, sender: { ...sender, admin: true } })).toEqual([
      "pin",
      "report",
      "delete",
    ]);
    expect(leagueMessageActions({ isAdmin: true, fromMe: true, system: false, pinned: false, pinsFull: false, sender: null })).toEqual(["pin"]);
  });
});
