// @mentions in league chats (decision 145). Typing @ in the app suggests
// league members and inserts their full name ("@Sam Patel"), the way iOS
// Messages does. The server finds mentions in the text itself, so a mention
// only ever reaches someone actually in the chat.

export interface Mentionable {
  userId: string;
  name: string;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * The accounts a message mentions: "@" plus a member's full name, any case,
 * not followed by another letter or digit. Longer names match first, so
 * "@Sam Patel" mentions Sam Patel and not also a member named Sam.
 */
export function findMentions(text: string, people: Mentionable[]): string[] {
  const lower = text.toLocaleLowerCase();
  const taken: boolean[] = new Array(text.length).fill(false);
  const found: string[] = [];
  const byLength = [...people].filter((p) => p.name.trim()).sort((a, b) => b.name.trim().length - a.name.trim().length);
  for (const p of byLength) {
    const needle = `@${p.name.trim().toLocaleLowerCase()}`;
    let from = 0;
    while (from <= lower.length - needle.length) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      const end = at + needle.length;
      const next = text[end];
      const free = !taken.slice(at, end).some(Boolean);
      if (free && (next === undefined || !WORD_CHAR.test(next))) {
        for (let i = at; i < end; i++) taken[i] = true;
        if (!found.includes(p.userId)) found.push(p.userId);
      }
      from = at + 1;
    }
  }
  return found;
}
