// Day labels on recording cards (Wave 1 review D19). Pure: no React Native.
//
// The label comes from when the match was recorded, not when it finished
// uploading, so a match recorded last night and uploaded this morning reads
// Yesterday.

/** "Today", "Yesterday", or "Oct 21", in the phone's own time zone. */
export function recordedDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
