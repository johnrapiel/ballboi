import { describe, expect, it } from "vitest";

import { readDeviceCheckToken, type DeviceCheckNative } from "@/lib/deviceCheck/token";

// Node's fs, without pulling Node's types into the app's TypeScript (as in courtFrames.test.ts).
// @ts-ignore -- node:fs has no types in the React Native project; vitest runs in Node.
const fs: { existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string } = await import("node:fs");
const { existsSync, readFileSync } = fs;

const fake = (over: Partial<DeviceCheckNative> = {}): DeviceCheckNative => ({
  isSupported: () => true,
  generateTokenAsync: async () => "QUJDREVGR0hJSktMTU5PUFFSU1RVVldY",
  ...over,
});

describe("DeviceCheck token", () => {
  it("gives the phone's token where DeviceCheck works", async () => {
    expect(await readDeviceCheckToken(fake())).toBe("QUJDREVGR0hJSktMTU5PUFFSU1RVVldY");
  });

  it("gives null without the native module (Expo Go, older builds)", async () => {
    expect(await readDeviceCheckToken(null)).toBeNull();
    expect(await readDeviceCheckToken(undefined)).toBeNull();
  });

  it("gives null on a phone without DeviceCheck, without asking for a token", async () => {
    let asked = false;
    const native = fake({
      isSupported: () => false,
      generateTokenAsync: async () => {
        asked = true;
        return "x";
      },
    });
    expect(await readDeviceCheckToken(native)).toBeNull();
    expect(asked).toBe(false);
  });

  it("never throws", async () => {
    const rejects = fake({ generateTokenAsync: () => Promise.reject(new Error("Apple said no")) });
    const throwsSync = fake({
      isSupported: () => {
        throw new Error("boom");
      },
    });
    expect(await readDeviceCheckToken(rejects)).toBeNull();
    expect(await readDeviceCheckToken(throwsSync)).toBeNull();
  });

  it("gives null for an empty or odd answer", async () => {
    expect(await readDeviceCheckToken(fake({ generateTokenAsync: async () => "" }))).toBeNull();
    expect(await readDeviceCheckToken(fake({ generateTokenAsync: async () => null as unknown as string }))).toBeNull();
  });
});

// The first version's Swift sat in ios/, which .gitignore drops, so it was
// never committed. These checks fail if the native files go missing again.
describe("DeviceCheck native module files", () => {
  const dir = `${process.cwd()}/modules/device-check/`;
  const config = JSON.parse(readFileSync(dir + "expo-module.config.json", "utf8"));

  it("points autolinking at a committed podspec, outside ios/", () => {
    const podspec: string = config.apple.podspecPath;
    expect(podspec.startsWith("ios/")).toBe(false);
    expect(existsSync(dir + podspec)).toBe(true);
    expect(readFileSync(dir + podspec, "utf8")).toContain("s.source_files   = '**/*.swift'");
  });

  it("has the Swift module the config and index.ts name", () => {
    const [moduleClass] = config.apple.modules as string[];
    const swiftPath = dir + `apple/${moduleClass}.swift`;
    expect(existsSync(swiftPath)).toBe(true);
    const swift = readFileSync(swiftPath, "utf8");
    expect(swift).toContain(`class ${moduleClass}: Module`);
    expect(swift).toContain('Name("BallBoiDeviceCheck")');
    expect(swift).toContain('Function("isSupported")');
    expect(swift).toContain('AsyncFunction("generateTokenAsync")');
    expect(readFileSync(dir + "index.ts", "utf8")).toContain('requireOptionalNativeModule<DeviceCheckNative>("BallBoiDeviceCheck")');
  });
});
