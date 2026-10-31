// First-message filter. Spec: "Filtered first messages: links, phone numbers,
// and slurs blocked until accepted." Checklist 3a: Objectionable content filter.
//
// Links and phone numbers are checked here. Slurs are matched against a term
// list loaded at runtime, never committed to the repo: in production Stream's
// blocklist and AI moderation also screen every message.

import { readFileSync } from "node:fs";

export type FilterReason = "link" | "phone" | "blocked_term";

export interface FilterResult {
  ok: boolean;
  reason?: FilterReason;
}

const TLDS =
  "com|net|org|io|co|me|app|ly|gg|tv|info|biz|us|xyz|link|site|online|club|dev|ai|to|be|so|page|cc|ws|fm|im|la|li|lol|shop|store|live";

const LINK_PATTERNS: RegExp[] = [
  /\bhttps?:\/\//i,
  /\bwww\s*\.\s*\S/i,
  // "example.com". Spaced-out dots only for the common endings, so a sentence
  // ending before "Me too" or "So..." never counts as a link.
  new RegExp(`\\b[a-z0-9-]{2,}\\.(?:${TLDS})\\b`, "i"),
  /\b[a-z0-9-]{2,}\s*(?:\.|\bdot\b)\s*(?:com|net|org|io)\b/i,
  /\b(?:t\.me|wa\.me|bit\.ly)\//i,
];

// US-style numbers (555-123-4567, (555) 123 4567, 555.123.4567, +1 555...),
// 7-digit local numbers (123-4567), and long international runs. Tennis scores
// like "6-3 6-4 7-6(4)" never match: their groups are single digits.
const PHONE_PATTERNS: RegExp[] = [
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/,
  /\b\d{3}[\s.-]\d{4}\b/,
  /\+\d[\d\s.-]{7,}\d/,
  /\b\d{10,}\b/,
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

/** Lowercase, strip accents and look-alike digits, collapse repeated letters. */
export function normalizeTerm(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[013457@$!]/g, (ch) => LEET[ch] ?? ch)
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1");
}

/** The words of a message, plus spaced-out letters joined back up ("b a d" → "bad"). */
export function candidateWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[013457@$!]/g, (ch) => LEET[ch] ?? ch)
    .split(/[^a-z]+/)
    .filter(Boolean);
  const out = words.map((w) => w.replace(/(.)\1+/g, "$1"));
  let run = "";
  for (const w of [...words, ""]) {
    if (w.length === 1) run += w;
    else {
      if (run.length > 2) out.push(run.replace(/(.)\1+/g, "$1"));
      run = "";
    }
  }
  return out;
}

export class FirstMessageFilter {
  private terms: Set<string>;

  constructor(terms: Iterable<string> = []) {
    this.terms = new Set([...terms].map(normalizeTerm).filter((t) => t.length > 1));
  }

  /**
   * Loads one term per line from MESSAGING_BLOCKED_TERMS_FILE when it's set.
   * Lines starting with # are comments. Missing file: links and phones only.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env, warn: (msg: string) => void = () => {}): FirstMessageFilter {
    const file = env.MESSAGING_BLOCKED_TERMS_FILE;
    if (!file) return new FirstMessageFilter();
    try {
      const lines = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      return new FirstMessageFilter(lines);
    } catch {
      warn(`MESSAGING_BLOCKED_TERMS_FILE could not be read: ${file}`);
      return new FirstMessageFilter();
    }
  }

  get termCount(): number {
    return this.terms.size;
  }

  check(text: string): FilterResult {
    if (LINK_PATTERNS.some((p) => p.test(text))) return { ok: false, reason: "link" };
    if (PHONE_PATTERNS.some((p) => p.test(text))) return { ok: false, reason: "phone" };
    if (this.terms.size) {
      for (const w of candidateWords(text)) {
        if (this.terms.has(w) || (w.endsWith("s") && this.terms.has(w.slice(0, -1))) || (w.endsWith("es") && this.terms.has(w.slice(0, -2)))) {
          return { ok: false, reason: "blocked_term" };
        }
      }
    }
    return { ok: true };
  }
}

/** What the app shows. Plain words, no hint about which word tripped it. */
export const FILTER_MESSAGES: Record<FilterReason, string> = {
  link: "First messages can't include links. Remove the link and try again.",
  phone: "First messages can't include phone numbers. Share contact details once they reply.",
  blocked_term: "That message can't be sent. Keep first messages friendly.",
};
