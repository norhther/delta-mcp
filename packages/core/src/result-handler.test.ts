import { describe, it, expect } from "vitest";
import {
  handleToolResult,
  handleRateLimit,
  detectAndHandleRateLimit,
} from "./result-handler/summarizer.js";

describe("Result handler — Phase 5 conformance", () => {
  // ── Pass-through ────────────────────────────────────────────────────────────

  it("passes small objects through unchanged", () => {
    const result = { items: [1, 2, 3] };
    expect(handleToolResult(result)).toBe(result);
  });

  it("passes small strings through unchanged", () => {
    expect(handleToolResult("hello")).toBe("hello");
  });

  it("passes small arrays through unchanged", () => {
    const arr = [1, 2, 3];
    expect(handleToolResult(arr)).toBe(arr);
  });

  it("passes primitives unchanged", () => {
    expect(handleToolResult(42)).toBe(42);
    expect(handleToolResult(true)).toBe(true);
    expect(handleToolResult(null)).toBe(null);
  });

  // ── String truncation ───────────────────────────────────────────────────────

  it("truncates strings exceeding maxTokens", () => {
    const big = "x".repeat(10000);
    const out = handleToolResult(big, { maxTokens: 100 }) as any;
    expect(out.truncated).toBe(true);
    expect(out.totalChars).toBe(10000);
    expect(out.estimatedTokens).toBe(2500);
    expect(out.preview).toHaveLength(400); // 100 tokens * 4 chars
    expect(out.note).toContain("truncated");
  });

  it("truncated result includes enough info to request more", () => {
    const out = handleToolResult("x".repeat(5000), { maxTokens: 50 }) as any;
    expect(out.note).toMatch(/token/i);
    expect(out.totalChars).toBeGreaterThan(0);
  });

  // ── Array pagination ────────────────────────────────────────────────────────

  it("paginates arrays exceeding paginateAfter", () => {
    const arr = Array.from({ length: 200 }, (_, i) => i);
    const out = handleToolResult(arr, { paginateAfter: 50 }) as any;
    expect(out.paginated).toBe(true);
    expect(out.items).toHaveLength(50);
    expect(out.totalItems).toBe(200);
    expect(out.totalPages).toBe(4);
    expect(out.hasMore).toBe(true);
    expect(out.page).toBe(1);
  });

  it("returns correct page when page param set", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const p2 = handleToolResult(arr, { paginateAfter: 25, page: 2 }) as any;
    expect(p2.page).toBe(2);
    expect(p2.items[0]).toBe(25); // second page starts at index 25
    expect(p2.hasMore).toBe(true);
  });

  it("last page has hasMore=false", () => {
    const arr = Array.from({ length: 50 }, (_, i) => i);
    const last = handleToolResult(arr, { paginateAfter: 25, page: 2 }) as any;
    expect(last.hasMore).toBe(false);
    expect(last.totalPages).toBe(2);
  });

  it("clamps out-of-bounds page to last page", () => {
    const arr = Array.from({ length: 30 }, (_, i) => i);
    const out = handleToolResult(arr, { paginateAfter: 10, page: 99 }) as any;
    expect(out.page).toBe(3); // clamped to last page
  });

  // ── Object summarization ────────────────────────────────────────────────────

  it("summarizes objects exceeding token budget", () => {
    const bigObj: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) bigObj[`key_${i}`] = "value_".repeat(20);

    const out = handleToolResult(bigObj, { maxTokens: 50 }) as any;
    expect(out._summarized).toBe(true);
    expect(out._totalKeys).toBe(100);
    expect(out._estimatedTokens).toBeGreaterThan(50);
  });

  it("object summary previews string values (truncated at 100 chars)", () => {
    const obj = { longProp: "a".repeat(200), shortProp: "hello" };
    const out = handleToolResult(obj, { maxTokens: 5 }) as any;
    expect(out._summarized).toBe(true);
    // Preview should be truncated version, not full 200-char value
    if (out.longProp) expect(out.longProp.length).toBeLessThanOrEqual(104); // 100 + "…"
  });

  // ── Rate limit handling ─────────────────────────────────────────────────────

  it("handleRateLimit produces reasoner-friendly result not an error", () => {
    const rl = handleRateLimit(30, "github-api");
    expect(rl.type).toBe("rate_limited");
    expect(rl.retryAfterSeconds).toBe(30);
    expect(rl.upstream).toBe("github-api");
  });

  it("handleRateLimit includes optional message", () => {
    const rl = handleRateLimit(60, "openai", { message: "RPM limit reached" });
    expect(rl.message).toBe("RPM limit reached");
  });

  it("detectAndHandleRateLimit converts 429 error objects", () => {
    const err = { status: 429, headers: { "retry-after": "45" }, message: "Too many requests" };
    const rl = detectAndHandleRateLimit(err, "stripe");
    expect(rl).not.toBeNull();
    expect(rl!.type).toBe("rate_limited");
    expect(rl!.retryAfterSeconds).toBe(45);
    expect(rl!.upstream).toBe("stripe");
  });

  it("detectAndHandleRateLimit returns null for non-429 errors", () => {
    expect(detectAndHandleRateLimit({ status: 500 }, "api")).toBeNull();
    expect(detectAndHandleRateLimit(null, "api")).toBeNull();
    expect(detectAndHandleRateLimit("string error", "api")).toBeNull();
  });

  it("detectAndHandleRateLimit falls back to 30s when no retry-after header", () => {
    const rl = detectAndHandleRateLimit({ status: 429 }, "myapi");
    expect(rl!.retryAfterSeconds).toBe(30);
  });
});
