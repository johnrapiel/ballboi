export function isMlServiceUnreachable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (
    err instanceof TypeError ||
    err.name === "AbortError" ||
    err.name === "TimeoutError" ||
    err.message.includes("fetch failed") ||
    err.message.includes("ECONNREFUSED") ||
    err.message.includes("ENOTFOUND") ||
    err.message.includes("ETIMEDOUT")
  ) {
    return true;
  }
  const httpMatch = err.message.match(/ML service returned (\d+)/);
  if (httpMatch) {
    const status = parseInt(httpMatch[1], 10);
    return status === 502 || status === 503 || status === 504;
  }
  return false;
}
