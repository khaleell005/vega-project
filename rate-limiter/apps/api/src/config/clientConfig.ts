/**
 * clientConfig.ts — Per-client rate-limit configuration.
 *
 * Each client is identified by a string ID and has a `limitPerMinute`
 * that defines how many requests they're allowed per 60-second window.
 *
 * Unknown clients (not in the map) fall back to DEFAULT_LIMIT_PER_MINUTE (60).
 * This prevents unregistered clients from overwhelming the system while still
 * allowing them through at a conservative rate.
 *
 * NOTE: This is currently hardcoded. In a production system, this would
 * be backed by a database or config service to allow runtime updates
 * without redeployment.
 */

const CLIENT_LIMITS: Record<string, { limitPerMinute: number }> = {
  "client-a": { limitPerMinute: 100 },
  "client-b": { limitPerMinute: 5000 },
};

/** Default limit for clients not explicitly configured. */
const DEFAULT_LIMIT_PER_MINUTE = 60;

/**
 * Look up a client's per-minute limit.
 * Returns the configured limit or the default (60) for unknown clients.
 */
export function getClientLimit(clientId: string): number {
  const config = CLIENT_LIMITS[clientId];
  return config ? config.limitPerMinute : DEFAULT_LIMIT_PER_MINUTE;
}

export { CLIENT_LIMITS, DEFAULT_LIMIT_PER_MINUTE };
