import { toDateString, toFixed, serializeRequest } from "../../src/helpers/format";

describe("toDateString", () => {
  test("formats Date object to YYYY-MM-DD", () => {
    expect(toDateString(new Date("2024-06-15T10:30:00.000Z"))).toBe("2024-06-15");
  });

  test("formats ISO string to YYYY-MM-DD", () => {
    expect(toDateString("2024-12-31T23:59:59.999Z")).toBe("2024-12-31");
  });

  test("handles midnight", () => {
    expect(toDateString(new Date("2024-01-01T00:00:00.000Z"))).toBe("2024-01-01");
  });
});

describe("toFixed", () => {
  test("rounds to 2 decimals by default", () => {
    expect(toFixed(1.6789)).toBe(1.68);
  });

  test("rounds to specified decimals", () => {
    expect(toFixed(1.6789, 1)).toBe(1.7);
  });

  test("handles null/undefined/0", () => {
    expect(toFixed(null)).toBe(0);
    expect(toFixed(undefined)).toBe(0);
    expect(toFixed(0)).toBe(0);
  });

  test("handles string numbers", () => {
    expect(toFixed("3.14159")).toBe(3.14);
  });
});

describe("serializeRequest", () => {
  test("serializes Prisma row with bigint id and Date", () => {
    const row = {
      id: BigInt(123),
      status: "allowed",
      responseTimeMs: 2.5,
      source: "redis",
      createdAt: new Date("2024-06-15T10:30:00.000Z"),
    };
    expect(serializeRequest(row)).toEqual({
      id: "123",
      status: "allowed",
      responseTimeMs: 2.5,
      source: "redis",
      createdAt: "2024-06-15T10:30:00.000Z",
    });
  });

  test("serializes with Decimal-like responseTimeMs", () => {
    const row = {
      id: 42,
      status: "denied",
      responseTimeMs: { toNumber: () => 0.9 },
      source: "local-fallback",
      createdAt: "2024-06-15T10:30:00.000Z",
    };
    const result = serializeRequest(row);
    expect(result.responseTimeMs).toBe(0.9);
    expect(typeof result.responseTimeMs).toBe("number");
  });

  test("serializes string id", () => {
    const row = {
      id: "abc-123",
      status: "allowed",
      responseTimeMs: 1.0,
      source: "redis",
      createdAt: new Date("2024-06-15"),
    };
    expect(serializeRequest(row).id).toBe("abc-123");
  });
});
