// Links inside chat messages, as pure helpers (no React Native), so they're
// easy to test. Used by MessageBubble in direct, group, league and doubles chats.
//
// - http and https links are tappable, and so is a bare ballboi.tennis link
//   ("ballboi.tennis/join/QQBU4MBY"), the way people paste invite links.
// - A Ball Boi link the app has a screen for opens in the app (today:
//   ballboi.tennis/join/CODE opens the league's join screen). Every other link
//   opens in Safari.

import { cleanCode } from "./joinLink";

export interface LinkPart {
  text: string;
  /** Set when this part is a link: the address to open, always with https:// or http://. */
  url?: string;
}

// An http(s) address, or a bare ballboi.tennis one, up to the next space.
const LINK = /\bhttps?:\/\/[^\s<>"]+|\b(?:www\.)?ballboi\.tennis(?:\/[^\s<>"]*)?/gi;
// Punctuation that ends a sentence, not the link: "Try ballboi.tennis/join/AB12."
const TRAILING = /[.,!?;:'"’”)\]}]+$/;

/** Splits a message into plain text and links, in order. Plain text is never lost. */
export function linkParts(text: string): LinkPart[] {
  const out: LinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    let raw = match[0];
    // Keep a closing bracket when the link opened one: en.wikipedia.org/wiki/Tennis_(sport)
    const trail = raw.match(TRAILING)?.[0] ?? "";
    if (trail) {
      let cut = trail.length;
      if (trail.startsWith(")") && (raw.match(/\(/g)?.length ?? 0) >= (raw.match(/\)/g)?.length ?? 0)) cut = 0;
      raw = raw.slice(0, raw.length - cut);
    }
    // A bare "ballboi.tennis" glued to a word ("myballboi.tennis") isn't a link.
    if (!/^https?:\/\//i.test(raw) && start > 0 && /[\w@.-]/.test(text[start - 1])) continue;
    if (!/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(raw) && !/^(?:www\.)?ballboi\.tennis/i.test(raw)) continue;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: raw, url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

/** True when a message has at least one link. */
export function hasLinks(text: string): boolean {
  return linkParts(text).some((p) => p.url);
}

export type LinkTarget = { kind: "app"; path: string } | { kind: "web"; url: string };

/**
 * Where tapping a link goes: a screen in the app for a Ball Boi link the app
 * handles, otherwise the web (Safari).
 */
export function linkTarget(url: string): LinkTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "web", url };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "ballboi.tennis" || host === "www.ballboi.tennis") {
    const join = parsed.pathname.match(/^\/join\/([A-Za-z0-9-]+)\/?$/);
    const code = join ? cleanCode(join[1]) : "";
    if (code) return { kind: "app", path: `/join/${code}` };
  }
  return { kind: "web", url };
}

/** What VoiceOver says for a link's action: "Open link ballboi.tennis/join/QQBU4MBY". */
export function linkActionLabel(url: string): string {
  return `Open link ${url.replace(/^https?:\/\//i, "").replace(/\/$/, "")}`;
}
