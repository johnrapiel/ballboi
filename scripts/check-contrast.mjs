#!/usr/bin/env node
// Checks every color pairing the app relies on against WCAG 2.2 AA,
// in both Day and Night themes, using the design system tokens.
// Exits 1 if any pair falls short. Runs as part of `pnpm test`.
//
// Text needs 4.5:1. Control borders and focus rings need 3:1 (WCAG 1.4.11).
// Add a pair here whenever a screen puts a new color on a new surface.
// A background written "a@b" is token a laid over token b (for translucent
// fills like the heatmap steps).
//
// It also guards WCAG 1.4.1: pairs that can't be told apart by color alone
// must keep the non-color cue the design system README documents for them.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(resolve(root, "docs/design-system/tokens.json"), "utf8"));

const TEXT = 4.5;
const NON_TEXT = 3;

// [foreground, background, minimum ratio, what it's used for]
const PAIRS = [
  ["ink", "paper", TEXT, "body text on the page"],
  ["ink", "linen", TEXT, "body text on cards"],
  ["ink", "sand", TEXT, "text in wells and chips"],
  ["ink-muted", "paper", TEXT, "meta text on the page"],
  ["ink-muted", "linen", TEXT, "meta text on cards"],
  ["ink-muted", "sand", TEXT, "meta text in wells"],
  ["on-ink", "ink", TEXT, "primary button label"],
  ["court", "paper", TEXT, "links, wins and live on the page"],
  ["court", "linen", TEXT, "links, wins and live on cards"],
  ["court", "sand", TEXT, "court text in wells"],
  ["danger", "paper", TEXT, "error text on the page"],
  ["danger", "linen", TEXT, "error text on cards"],
  ["on-ink", "court", TEXT, "label on the live chip"],
  ["on-ink", "danger", TEXT, "label on a destructive button"],
  ["hairline-strong", "paper", NON_TEXT, "input and secondary button borders"],
  ["hairline-strong", "linen", NON_TEXT, "input borders on cards"],
  ["focus", "paper", NON_TEXT, "focus ring on the page"],
  ["focus", "linen", NON_TEXT, "focus ring on cards"],
  // Increase Contrast replacements (useColors swaps these in).
  ["ink-muted-hc", "paper", TEXT, "meta text on the page, Increase Contrast"],
  ["ink-muted-hc", "linen", TEXT, "meta text on cards, Increase Contrast"],
  ["ink-muted-hc", "sand", TEXT, "meta text in wells, Increase Contrast"],
  ["hairline-strong-hc", "paper", NON_TEXT, "control borders, Increase Contrast"],
  ["hairline-strong-hc", "linen", NON_TEXT, "control borders on cards, Increase Contrast"],
  // Charts and replay.
  ["ink", "sand", NON_TEXT, "replay court lines and player marks"],
  ["court", "sand", NON_TEXT, "winner check on the replay court"],
  ["danger", "sand", NON_TEXT, "error cross on the replay court"],
  ["ink", "heat-1@sand", TEXT, "heatmap count on the lowest bin"],
  ["ink", "heat-2@sand", TEXT, "heatmap count on the second bin"],
  ["on-ink", "heat-3@sand", TEXT, "heatmap count on the middle bin"],
  ["on-ink", "heat-4@sand", TEXT, "heatmap count on the fourth bin"],
  ["on-ink", "heat-5@sand", TEXT, "heatmap count on the top bin"],
];

// Pairs that fall under 3:1 against each other, so color can't separate
// them. Each must keep its cue, written in docs/design-system/README.md.
// [color a, color b, phrase the README must contain, why]
const CUES = [
  ["court", "ink", "Underlined (`TextLink`)", "links inside ink text"],
  ["court", "danger", "A cross, and the word", "wins vs errors (a red-green pair)"],
];

const themes = tokens.color.themes.map((t) => t.id);
const byName = new Map(tokens.color.tokens.map((t) => [t.name, t]));

function raw(name, theme) {
  const t = byName.get(name);
  if (!t) throw new Error(`Unknown color token: ${name}`);
  const v = typeof t.value === "string" ? t.value : t.value[theme] ?? t.value[themes[0]];
  const alias = /^\{(.+)\}$/.exec(v);
  return alias ? raw(alias[1], theme) : v;
}

function parse(c) {
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)).concat(1);
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(",").map((x) => Number.parseFloat(x));
    return [r, g, b, a];
  }
  throw new Error(`Unsupported color: ${c}`);
}

// Translucent colors (hairlines) are blended onto the surface they sit on.
function over([r, g, b, a], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

function surface(name, theme) {
  const [top, base] = name.split("@");
  if (!base) return parse(raw(top, theme));
  return over(parse(raw(top, theme)), parse(raw(base, theme)));
}

let failures = 0;
for (const theme of themes) {
  for (const [fgName, bgName, min, use] of PAIRS) {
    const bg = surface(bgName, theme);
    const fg = over(parse(raw(fgName, theme)), bg);
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failures++;
    const line = `${ok ? "pass" : "FAIL"}  ${theme.padEnd(5)}  ${r.toFixed(2).padStart(5)}:1 (needs ${min}:1)  ${fgName} on ${bgName}: ${use}`;
    (ok ? console.log : console.error)(line);
  }
}

const readme = readFileSync(resolve(root, "docs/design-system/README.md"), "utf8");
for (const [a, b, phrase, use] of CUES) {
  const worst = Math.min(...themes.map((t) => ratio(surface(a, t), surface(b, t))));
  if (worst >= NON_TEXT) continue; // color alone is enough; no cue needed
  const ok = readme.includes(phrase);
  if (!ok) failures++;
  const line = `${ok ? "pass" : "FAIL"}  cue    ${worst.toFixed(2).padStart(5)}:1 under 3:1, so ${a} vs ${b} (${use}) needs its cue: "${phrase}"`;
  (ok ? console.log : console.error)(line);
}

if (failures) {
  console.error(`\n${failures} color pair(s) fail WCAG AA. Fix the design system tokens, then run scripts/sync-design-tokens.mjs.`);
  process.exit(1);
}
console.log(`\nAll ${PAIRS.length * themes.length} color pairs meet WCAG AA in every theme, and every color-only pair keeps its cue.`);
