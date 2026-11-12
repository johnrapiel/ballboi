import { describe, expect, it } from "vitest";

import { createPullRefresh } from "../pullRefresh";

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
