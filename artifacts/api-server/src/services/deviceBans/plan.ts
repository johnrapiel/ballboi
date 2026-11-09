// Device ban rules (Wave 2, Session G; acceptance 38). Pure, so they're
// tested without Apple or a database.
//
// Bit 0 of Apple's two bits means "a banned account used this phone". Bit 1
// is unused.
//
// When an account checks in from a phone (every time Ball Boi opens, banned
// accounts included):
// - This account has a phone ban waiting: the phone is marked ("mark"), if it
//   isn't already. Covers a ban made while the phone wasn't known yet.
// - The phone is marked and this account's own phone ban was undone: the mark
//   is old, so it's cleared ("clear").
// - The phone is marked and this account is already banned: nothing more.
// - The phone is marked otherwise: a new account on a banned phone, so it's
//   banned too ("block").
// Other phones are never affected: only this phone's bits are read.

export type CheckInAction = "ok" | "mark" | "clear" | "block";

export function checkInAction(input: {
  phoneMarked: boolean;
  ownBanActive: boolean;
  ownBanUndone: boolean;
  accountBanned: boolean;
}): CheckInAction {
  if (input.ownBanActive) return input.phoneMarked ? "ok" : "mark";
  if (!input.phoneMarked) return "ok";
  if (input.ownBanUndone) return "clear";
  if (input.accountBanned) return "ok";
  return "block";
}

export const CAUGHT_REASON = "This iPhone was used by a banned account (device ban).";

export const BLOCKED_ERROR = "This account is banned.";

/** DeviceCheck tokens are base64 from Apple; anything else is refused before it reaches Apple. */
export function validDeviceToken(v: unknown): v is string {
  return typeof v === "string" && v.length >= 20 && v.length <= 8192 && /^[A-Za-z0-9+/=]+$/.test(v);
}

/** What the admin queue says about a phone ban. */
export function deviceBanLabel(kind: string, phoneMarked: string): string {
  if (kind === "caught") return "New account on a banned phone";
  return phoneMarked === "yes" ? "Banned, and their phone" : "Banned. Their phone gets marked next time they open Ball Boi";
}
