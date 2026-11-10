// When a chat should load its next page of earlier messages without being
// scrolled. Pure helper (no React Native), so it's easy to test.
//
// A chat opens on its latest page. Scrolling up loads earlier ones, but if
// the messages shown don't fill the screen there is nothing to scroll, so the
// list never asks for more and the chat looks empty above (John, Nov 10).
// The rule: keep loading until the messages fill the screen or the history
// ends. A failed page stops the loop until Try again.

export interface FillState {
  /** Height of everything in the list, from onContentSizeChange. 0 before it's measured. */
  contentHeight: number;
  /** Height of the list on screen, from onLayout. 0 before it's measured. */
  viewportHeight: number;
  /** There are earlier messages to load. */
  hasMore: boolean;
  /** A page is loading now. */
  loading: boolean;
  /** The last page failed; wait for Try again. */
  failed: boolean;
}

/** True when the chat should load another page of earlier messages now. */
export function needsMoreToFill(s: FillState): boolean {
  if (!s.hasMore || s.loading || s.failed) return false;
  if (s.viewportHeight <= 0) return false;
  return s.contentHeight < s.viewportHeight;
}
