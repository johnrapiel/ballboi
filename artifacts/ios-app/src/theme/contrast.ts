import { colors, CONTRAST_PAIRS, type ColorScheme } from "./tokens";

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Returns every token pair that misses WCAG AA. Empty array means pass. */
export function auditContrast(): string[] {
  const failures: string[] = [];
  for (const scheme of Object.keys(colors) as ColorScheme[]) {
    for (const [fg, bg, min] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(colors[scheme][fg], colors[scheme][bg]);
      if (ratio < min) failures.push(`${scheme}: ${fg} on ${bg} = ${ratio.toFixed(2)} (needs ${min})`);
    }
  }
  return failures;
}
