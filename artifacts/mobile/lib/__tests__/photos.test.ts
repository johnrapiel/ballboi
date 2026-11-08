import { describe, expect, it } from "vitest";

import { avatarUri, isApiPhoto, photoSource, photoUrl } from "@/lib/photos";

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

// Profile photos show everywhere (John, Nov 8): Avatar takes whatever a
// screen has, the raw stored path included, so no screen can forget photoUrl().
describe("avatarUri", () => {
  const api = photoUrl("/objects/uploads/abc")!;

  it("turns the raw stored path into the API's photo address", () => {
    expect(avatarUri("/objects/uploads/abc")).toBe(api);
  });

  it("leaves an address that's already built alone", () => {
    expect(avatarUri(api)).toBe(api);
    expect(avatarUri("https://img.example.com/a.jpg")).toBe("https://img.example.com/a.jpg");
  });

  it("shows a photo just picked on the phone as is", () => {
    expect(avatarUri("file:///var/mobile/picked.jpg")).toBe("file:///var/mobile/picked.jpg");
    expect(avatarUri("ph://ABC-123")).toBe("ph://ABC-123");
  });

  it("is no photo (initials) when there isn't one or it isn't a photo path", () => {
    expect(avatarUri(null)).toBeNull();
    expect(avatarUri(undefined)).toBeNull();
    expect(avatarUri("")).toBeNull();
    expect(avatarUri("/somewhere/else.jpg")).toBeNull();
    expect(avatarUri("not a path")).toBeNull();
  });
});
