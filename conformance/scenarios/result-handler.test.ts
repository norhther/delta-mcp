import { describe, it, expect } from "vitest";
import { handleToolResult, handleRateLimit } from "@mcp2/core";

describe("Result handler — Phase 5 conformance", () => {
  it("passes small results through unchanged", () => {
    const result = { items: [1, 2, 3] };
    expect(handleToolResult(result)).toBe(result);
  });

  it("truncates strings exceeding maxTokens threshold", () => {
    const big = "x".repeat(10000);
    const out = handleToolResult(big, { maxTokens: 100 }) as any;
    expect(out.truncated).toBe(true);
    expect(out.totalChars).toBe(10000);
  });

  it("paginates large arrays", () => {
    const arr = Array.from({ length: 200 }, (_, i) => i);
    const out = handleToolResult(arr, { paginateAfter: 50 }) as any;
    expect(out.paginated).toBe(true);
    expect(out.items).toHaveLength(50);
    expect(out.totalItems).toBe(200);
  });

  it("rate limit becomes reasoner-friendly result, not error", () => {
    const rl = handleRateLimit(30, "github-api");
    expect(rl.type).toBe("rate_limited");
    expect(rl.retryAfterSeconds).toBe(30);
    expect(rl.upstream).toBe("github-api");
  });
});
