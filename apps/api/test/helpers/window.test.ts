import { getWindowBucket, getWindowKey, getSecondsRemaining, WINDOW_SECONDS } from "../../src/helpers/window";

describe("getWindowBucket", () => {
  test("returns correct bucket for known timestamp", () => {
    const ms = 1700000060000;
    expect(getWindowBucket(ms)).toBe(Math.floor(ms / 60000));
  });

  test("bucket changes at window boundaries", () => {
    const bucketA = getWindowBucket(0);
    const bucketB = getWindowBucket(60000);
    expect(bucketB).toBe(bucketA + 1);
  });

  test("same bucket for timestamps within same window", () => {
    expect(getWindowBucket(1000)).toBe(getWindowBucket(59000));
  });
});

describe("getWindowKey", () => {
  test("formats key with client id and bucket", () => {
    expect(getWindowKey("client-a", 100)).toBe("ratelimit:client-a:100");
  });

  test("uses current bucket when no bucket provided", () => {
    const key = getWindowKey("client-a");
    const bucket = getWindowBucket();
    expect(key).toBe(`ratelimit:client-a:${bucket}`);
  });
});

describe("getSecondsRemaining", () => {
  test("returns WINDOW_SECONDS at window start", () => {
    const windowStart = getWindowBucket(5000) * 60000;
    expect(getSecondsRemaining(windowStart)).toBe(WINDOW_SECONDS);
  });

  test("returns 1 at last second of window", () => {
    const windowEnd = getWindowBucket(5000) * 60000 + 59999;
    expect(getSecondsRemaining(windowEnd)).toBe(1);
  });

  test("returns half at midpoint", () => {
    const midpoint = getWindowBucket(5000) * 60000 + 30000;
    expect(getSecondsRemaining(midpoint)).toBe(30);
  });
});

test("WINDOW_SECONDS is 60", () => {
  expect(WINDOW_SECONDS).toBe(60);
});
