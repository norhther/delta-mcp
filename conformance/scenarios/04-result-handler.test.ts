/**
 * Conformance: Result handler (Phase 5)
 * Verifies: truncation, pagination, object summarization, rate-limit conversion
 */
import { describe, it, expect } from "vitest";
import {
  handleToolResult,
  handleRateLimit,
  detectAndHandleRateLimit,
} from "@mcp2/core";

describe("CS-04: Result handler", () => {
  // ── Pass-through ────────────────────────────────────────────────────────────

  it("CS-04-01: passes values under budget unchanged", () => {
    const v = { a: 1, b: "hello" };
    expect(handleToolResult(v, { maxTokens: 500 })).toBe(v);
  });

  // ── String truncation ───────────────────────────────────────────────────────

  it("CS-04-02: truncated result has required metadata fields", () => {
    const out = handleToolResult("x".repeat(10000), { maxTokens: 100 }) as any;
    expect(out.truncated).toBe(true);
    expect(typeof out.totalChars).toBe("number");
    expect(typeof out.estimatedTokens).toBe("number");
    expect(typeof out.preview).toBe("string");
    expect(typeof out.note).toBe("string");
  });

  it("CS-04-03: preview length equals maxTokens * 4 chars", () => {
    const out = handleToolResult("y".repeat(5000), { maxTokens: 50 }) as any;
    expect(out.preview).toHaveLength(200); // 50 tokens * 4 chars
  });

  // ── Pagination ──────────────────────────────────────────────────────────────

  it("CS-04-04: paginated result has required metadata fields", () => {
    const arr = Array.from({ length: 200 }, (_, i) => i);
    const out = handleToolResult(arr, { paginateAfter: 25 }) as any;
    expect(out.paginated).toBe(true);
    expect(typeof out.totalItems).toBe("number");
    expect(typeof out.page).toBe("number");
    expect(typeof out.pageSize).toBe("number");
    expect(typeof out.totalPages).toBe("number");
    expect(typeof out.hasMore).toBe("boolean");
    expect(Array.isArray(out.items)).toBe(true);
    expect(typeof out.note).toBe("string");
  });

  it("CS-04-05: page navigation returns correct slice", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i * 10);
    const p3 = handleToolResult(arr, { paginateAfter: 10, page: 3 }) as any;
    expect(p3.page).toBe(3);
    expect(p3.items[0]).toBe(20 * 10); // index 20
  });

  it("CS-04-06: last page sets hasMore=false", () => {
    const arr = Array.from({ length: 30 }, (_, i) => i);
    const last = handleToolResult(arr, { paginateAfter: 10, page: 3 }) as any;
    expect(last.hasMore).toBe(false);
    expect(last.page).toBe(3);
    expect(last.totalPages).toBe(3);
  });

  it("CS-04-07: out-of-range page clamped to last valid page", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const out = handleToolResult(arr, { paginateAfter: 10, page: 999 }) as any;
    expect(out.page).toBe(2); // only 2 pages
  });

  // ── Object summarization ────────────────────────────────────────────────────

  it("CS-04-08: summarized object has _summarized flag and metadata", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 200; i++) big[`k${i}`] = "v".repeat(50);

    const out = handleToolResult(big, { maxTokens: 30 }) as any;
    expect(out._summarized).toBe(true);
    expect(typeof out._totalKeys).toBe("number");
    expect(out._totalKeys).toBe(200);
    expect(typeof out._estimatedTokens).toBe("number");
    expect(typeof out._note).toBe("string");
  });

  // ── Rate limit ──────────────────────────────────────────────────────────────

  it("CS-04-09: handleRateLimit produces rate_limited type result", () => {
    const rl = handleRateLimit(30, "github");
    expect(rl.type).toBe("rate_limited");
    expect(rl.retryAfterSeconds).toBe(30);
    expect(rl.upstream).toBe("github");
  });

  it("CS-04-10: detectAndHandleRateLimit converts 429 error object", () => {
    const err = { status: 429, headers: { "retry-after": "60" }, message: "Limit exceeded" };
    const rl = detectAndHandleRateLimit(err, "stripe");
    expect(rl).not.toBeNull();
    expect(rl!.type).toBe("rate_limited");
    expect(rl!.retryAfterSeconds).toBe(60);
  });

  it("CS-04-11: detectAndHandleRateLimit returns null for non-429", () => {
    expect(detectAndHandleRateLimit({ status: 500 }, "api")).toBeNull();
    expect(detectAndHandleRateLimit(null, "api")).toBeNull();
  });

  it("CS-04-12: rate limit defaults to 30s when no retry-after header present", () => {
    const rl = detectAndHandleRateLimit({ status: 429 }, "api");
    expect(rl!.retryAfterSeconds).toBe(30);
  });
});
