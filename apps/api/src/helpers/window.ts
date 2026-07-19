const WINDOW_SECONDS = 60;

export function getWindowBucket(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / (WINDOW_SECONDS * 1000));
}

export function getWindowKey(clientId: string, bucket?: number): string {
  const b = bucket ?? getWindowBucket();
  return `ratelimit:${clientId}:${b}`;
}

export function getSecondsRemaining(nowMs: number = Date.now()): number {
  const bucket = getWindowBucket(nowMs);
  const windowStartMs = bucket * WINDOW_SECONDS * 1000;
  return Math.max(0, WINDOW_SECONDS - Math.floor((nowMs - windowStartMs) / 1000));
}

export { WINDOW_SECONDS };
