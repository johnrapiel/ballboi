// Base64 to bytes, for the small JPEG the court check decodes. Hermes has no
// Buffer, and atob gives a string, so this is done by hand.
// Pure TypeScript, no React Native: tested in lib/__tests__/courtAim.test.ts.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  t["-".charCodeAt(0)] = 62; // URL-safe alphabet too
  t["_".charCodeAt(0)] = 63;
  return t;
})();

/** Decodes base64 (with or without a data: prefix, padding or line breaks). */
export function base64ToBytes(input: string): Uint8Array {
  const comma = input.startsWith("data:") ? input.indexOf(",") : -1;
  const s = comma >= 0 ? input.slice(comma + 1) : input;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = LOOKUP[s.charCodeAt(i) & 255];
    if (v < 0) continue; // padding, whitespace
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (value >> bits) & 255;
    }
  }
  return out.subarray(0, n);
}
