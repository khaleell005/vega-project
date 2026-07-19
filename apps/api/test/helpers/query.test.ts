import { buildRequestWhere } from "../../src/helpers/query";

describe("buildRequestWhere", () => {
  test("returns clientId only when no filters", () => {
    expect(buildRequestWhere({ clientId: "a" })).toEqual({ clientId: "a" });
  });

  test("adds status filter", () => {
    expect(buildRequestWhere({ clientId: "a", status: "denied" })).toEqual({
      clientId: "a",
      status: "denied",
    });
  });

  test("adds source filter", () => {
    expect(buildRequestWhere({ clientId: "a", source: "redis" })).toEqual({
      clientId: "a",
      source: "redis",
    });
  });

  test("adds maxLatency filter", () => {
    expect(buildRequestWhere({ clientId: "a", maxLatency: 5 })).toEqual({
      clientId: "a",
      responseTimeMs: { lte: 5 },
    });
  });

  test("combines all filters", () => {
    expect(
      buildRequestWhere({
        clientId: "a",
        status: "allowed",
        source: "local-fallback",
        maxLatency: 10,
      })
    ).toEqual({
      clientId: "a",
      status: "allowed",
      source: "local-fallback",
      responseTimeMs: { lte: 10 },
    });
  });

  test("ignores NaN maxLatency", () => {
    expect(buildRequestWhere({ clientId: "a", maxLatency: NaN })).toEqual({
      clientId: "a",
    });
  });

  test("ignores undefined optional params", () => {
    expect(buildRequestWhere({ clientId: "a", status: undefined, source: undefined })).toEqual({
      clientId: "a",
    });
  });
});
