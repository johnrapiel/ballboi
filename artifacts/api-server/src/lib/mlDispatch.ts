// What the API sends the ML server to analyze a recording.
//
// A match interrupted by an unanswered call is recorded in more than one
// piece ("segments", Wave 1 review Q3). The first piece is the session's
// videoObjectPath; the rest are in metadata.segmentPaths, in order. The ML
// server joins them into one video before analysis, so the match gets one
// analysis and one replay; only the seconds the phone rang are missing.

/** The pieces after the first, in recording order. */
export function segmentPathsOf(metadata: unknown): string[] {
  const m = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const s = m.segmentPaths;
  return Array.isArray(s) ? s.filter((p): p is string => typeof p === "string" && p.startsWith("/objects/")) : [];
}

/**
 * The video fields of an /analyze-match-batch request. `video_url` stays the
 * first piece, so an ML server that doesn't know `video_urls` still works for
 * single-piece recordings.
 */
export function mlVideoFields(
  apiBaseUrl: string,
  firstPath: string,
  extraPaths: string[] = [],
): { video_url: string; video_urls?: string[] } {
  const url = (p: string) => `${apiBaseUrl}/api/storage${p}`;
  if (extraPaths.length === 0) return { video_url: url(firstPath) };
  return { video_url: url(firstPath), video_urls: [firstPath, ...extraPaths].map(url) };
}
