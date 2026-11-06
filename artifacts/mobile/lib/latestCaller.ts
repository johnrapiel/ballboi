// Finding #1: `useAuth()` from @clerk/expo returns a new `getToken` function
// on every render. Screens that load data in an effect keyed on `getToken`
// re-ran the effect after every render, and each load set state, which
// rendered again: `/api/users/me` every 10 to 15 ms while a screen was open.
//
// The fix is one function that never changes but always calls the newest
// `getToken`. This file is the pure part, so it can be tested in Node.

/**
 * Returns a function whose identity never changes and which always calls
 * whatever `latest()` returns at call time.
 */
export function latestCaller<A extends unknown[], R>(latest: () => (...args: A) => R): (...args: A) => R {
  return (...args: A) => latest()(...args);
}
