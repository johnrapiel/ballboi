import { describe, expect, it } from "vitest";

import { isApiPhoto, photoSource, photoUrl } from "@/lib/photos";

// A17: profile photos need sign-in to view, so the app sends its session
// token with every photo the API serves (components/Avatar.tsx).

describe("photo sources", () => {
  const api = photoUrl("/objects/uploads/abc")!;

  it("turns a stored photo path into the API's photo address", () => {
    expect(api.endsWith("/api/storage/objects/uploads/abc")).toBe(true);
    expect(isApiPhoto(api)).toBe(true);
  });

  it("sends the sign-in header with an API photo", () => {
    expect(photoSource(api, "tok_123")).toEqual({ uri: api, headers: { Authorization: "Bearer tok_123" } });
  });

  it("doesn't request an API photo before there's a token", () => {
    expect(photoSource(api, null)).toBeNull();
    expect(photoSource(api, undefined)).toBeNull();
  });

  it("shows a photo just picked on the phone as is, with no header", () => {
    expect(isApiPhoto("file:///var/mobile/picked.jpg")).toBe(false);
    expect(photoSource("file:///var/mobile/picked.jpg", null)).toEqual({ uri: "file:///var/mobile/picked.jpg" });
  });

  it("never sends the token to another site", () => {
    expect(photoSource("https://example.com/api/storage/objects/uploads/abc", "tok_123")).toEqual({
      uri: "https://example.com/api/storage/objects/uploads/abc",
    });
  });
});
