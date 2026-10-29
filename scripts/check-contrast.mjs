#!/usr/bin/env node
// Checks every color pairing the app relies on against WCAG 2.2 AA,
// in both Day and Night themes, using the design system tokens.
// Exits 1 if any pair falls short. Runs as part of `pnpm test`.
//
// Text needs 4.5:1. Control borders and focus rings need 3:1 (WCAG 1.4.11).
// Add a pair here whenever a screen puts a new color on a new surface.

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

let failures = 0;
for (const theme of themes) {
  for (const [fgName, bgName, min, use] of PAIRS) {
    const bg = parse(raw(bgName, theme));
    const fg = over(parse(raw(fgName, theme)), bg);
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failures++;
    const line = `${ok ? "pass" : "FAIL"}  ${theme.padEnd(5)}  ${r.toFixed(2).padStart(5)}:1 (needs ${min}:1)  ${fgName} on ${bgName}: ${use}`;
    (ok ? console.log : console.error)(line);
  }
}

if (failures) {
  console.error(`\n${failures} color pair(s) fail WCAG AA. Fix the design system tokens, then run scripts/sync-design-tokens.mjs.`);
  process.exit(1);
}
console.log(`\nAll ${PAIRS.length * themes.length} color pairs meet WCAG AA in every theme.`);
