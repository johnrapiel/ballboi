import { describe, expect, it } from "vitest";

import { createPullRefresh, isConnectionError, noticeFor, runRefresh } from "../pullRefresh";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const states: boolean[] = [];
  const t = createPullRefresh((on) => states.push(on));
  return { states, t };
}

describe("createPullRefresh", () => {
  it("shows the spinner from the pull until the refetch settles", async () => {
    const { states, t } = setup();
    const d = deferred();
    const done = t.pull(() => d.promise);
    expect(states).toEqual([true]);
    d.resolve();
    await done;
    expect(states).toEqual([true, false]);
  });

  it("waits for every refetch in an array", async () => {
    const { states, t } = setup();
    const a = deferred();
    const b = deferred();
    const done = t.pull(() => [a.promise, b.promise]);
    a.resolve();
    await Promise.resolve();
    expect(states).toEqual([true]);
    b.resolve();
    await done;
    expect(states).toEqual([true, false]);
  });

  it("stops the spinner when a refetch fails (Airplane Mode)", async () => {
    const { states, t } = setup();
    const d = deferred();
    const done = t.pull(() => [d.promise]);
    d.reject(new Error("offline"));
    await done;
    expect(states).toEqual([true, false]);
  });

  it("stops the spinner when the work throws", async () => {
    const { states, t } = setup();
    await t.pull(() => {
      throw new Error("boom");
    });
    expect(states).toEqual([true, false]);
  });

  it("handles work that returns nothing", async () => {
    const { states, t } = setup();
    await t.pull(() => undefined);
    expect(states).toEqual([true, false]);
  });

  it("ignores a second pull while one is running, then allows the next", async () => {
    const { states, t } = setup();
    const d = deferred();
    let calls = 0;
    const first = t.pull(() => {
      calls++;
      return d.promise;
    });
    await t.pull(() => {
      calls++;
    });
    expect(calls).toBe(1);
    d.resolve();
    await first;
    await t.pull(() => {
      calls++;
    });
    expect(calls).toBe(2);
    expect(states).toEqual([true, false, true, false]);
  });

  it("never spins on its own: nothing happens without a pull", () => {
    const { states } = setup();
    expect(states).toEqual([]);
  });

  it("doesn't update a screen that has gone away", async () => {
    const { states, t } = setup();
    const d = deferred();
    const done = t.pull(() => d.promise);
    t.dispose();
    d.resolve();
    await done;
    expect(states).toEqual([true]);
    await t.pull(() => undefined);
    expect(states).toEqual([true]);
  });
});

// Finding 41 (decision 195): a failed refresh keeps the data and says why.
const ok = (data: unknown = [1]) => ({ status: "success", data, error: null });
const failed = (error: unknown, data?: unknown) => ({ status: "error", data, error });
const offline = () => new TypeError("Network request failed");
const offlineApi = () => Object.assign(new Error("You're offline."), { name: "OfflineError" });
const serverError = () => Object.assign(new Error("Internal Server Error"), { name: "ApiError", status: 500 });

describe("isConnectionError", () => {
  it("knows fetch's own failure and lib/api's OfflineError", () => {
    expect(isConnectionError(offline())).toBe(true);
    expect(isConnectionError(offlineApi())).toBe(true);
    expect(isConnectionError(new TypeError("The Internet connection appears to be offline."))).toBe(true);
  });

  it("doesn't call a server's answer offline", () => {
    expect(isConnectionError(serverError())).toBe(false);
    expect(isConnectionError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError("Network request failed")).toBe(false);
  });
});

describe("noticeFor", () => {
  const settle = (...values: unknown[]) => values.map((value) => ({ status: "fulfilled" as const, value }));

  it("says nothing when every refetch worked", () => {
    expect(noticeFor(settle(ok(), ok()))).toBeNull();
  });

  it("offline with the list still on screen: the offline notice", () => {
    expect(noticeFor(settle(failed(offline(), [{ name: "Ross" }])))).toBe("offline");
  });

  it("a server error with data on screen: Couldn't refresh", () => {
    expect(noticeFor(settle(failed(serverError(), [1])))).toBe("failed");
  });

  it("nothing on screen: no notice, the screen shows Can't load instead", () => {
    expect(noticeFor(settle(failed(offline(), undefined)))).toBeNull();
  });

  it("offline wins when one refetch is offline and another a server error", () => {
    expect(noticeFor(settle(failed(serverError(), [1]), failed(offline(), [2])))).toBe("offline");
  });

  it("counts a failure only for the query that still has data", () => {
    expect(noticeFor(settle(ok(), failed(serverError(), undefined), failed(offline(), { pages: [] })))).toBe("offline");
  });

  it("ignores rejected work and values that aren't query results", () => {
    expect(noticeFor([{ status: "rejected", reason: offline() }, ...settle(undefined, 3, { status: "error" })])).toBeNull();
  });
});

describe("runRefresh", () => {
  it("reads nested arrays, as Home's Promise.all of refetches returns", async () => {
    const notice = await runRefresh(() => [Promise.resolve(ok()), Promise.all([Promise.resolve(ok()), Promise.resolve(failed(offline(), [1]))])]);
    expect(notice).toBe("offline");
  });

  it("never throws", async () => {
    expect(
      await runRefresh(() => {
        throw new Error("boom");
      }),
    ).toBeNull();
    expect(await runRefresh(() => Promise.reject(offline()))).toBeNull();
  });
});

describe("createPullRefresh notice", () => {
  it("a pull resolves with the notice to show", async () => {
    const { t } = setup();
    expect(await t.pull(() => [Promise.resolve(failed(offline(), [1]))])).toBe("offline");
    expect(await t.pull(() => [Promise.resolve(ok())])).toBeNull();
  });

  it("an ignored pull resolves with undefined, so the notice stays as it was", async () => {
    const { t } = setup();
    const d = deferred();
    const first = t.pull(() => d.promise);
    expect(await t.pull(() => undefined)).toBeUndefined();
    d.resolve();
    expect(await first).toBeNull();
  });
});
