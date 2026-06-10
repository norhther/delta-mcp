/**
 * Result handler example — demonstrates how Delta-MCP automatically handles
 * large results that would otherwise blow up the LLM context window:
 *
 *   - Truncation:   string over budget → preview + metadata
 *   - Pagination:   array over page size → page 1 of N + hasMore flag
 *   - Summarization: object with too many keys → top-level preview
 *   - Rate limits:  upstream 429 → structured result the model can reason about
 *
 * Run: npx tsx examples/result-handler/index.ts
 */
import { handleToolResult, detectAndHandleRateLimit } from "@delta-mcp/core";

const opts = { maxTokens: 200, paginateAfter: 5 };

// ── 1. Truncation ─────────────────────────────────────────────────────────────
// Strings over the token budget are replaced with a preview + metadata.
// The model sees the file is large and can decide whether to request a chunk.
const longString = "Lorem ipsum dolor sit amet. ".repeat(500);
const truncated = handleToolResult(longString, opts);
console.log("1) Truncation (string over maxTokens):");
console.log(JSON.stringify(truncated, null, 2));
console.log();

// ── 2. Pagination — page 1 ────────────────────────────────────────────────────
// Arrays over paginateAfter are split into pages.
// page / pageSize come from the model's tool call args — no server code needed.
const records = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `Record ${i + 1}` }));
const page1 = handleToolResult(records, { ...opts, page: 1, pageSize: 5 });
console.log("2) Pagination page 1/10 (array over paginateAfter):");
console.log(JSON.stringify(page1, null, 2));
console.log();

// ── 3. Pagination — page 2 ────────────────────────────────────────────────────
// Model sees hasMore: true and requests the next page by passing page: 2.
const page2 = handleToolResult(records, { ...opts, page: 2, pageSize: 5 });
console.log("3) Pagination page 2/10:");
console.log(JSON.stringify(page2, null, 2));
console.log();

// ── 4. Object summarization ───────────────────────────────────────────────────
// Objects with too many keys get a top-level key preview + total count.
const bigConfig = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key_${i}`, `value_${i}`]));
const summarized = handleToolResult(bigConfig, opts);
console.log("4) Object summarization (100 keys → preview):");
console.log(JSON.stringify(summarized, null, 2));
console.log();

// ── 5. Rate limit handling ────────────────────────────────────────────────────
// A 429 from an upstream API becomes a structured result instead of a crash.
// The model can read retryAfterSeconds and schedule a retry itself.
const rateLimitErr = Object.assign(new Error("Too Many Requests"), {
  status: 429,
  headers: { "retry-after": "30" },
});
const rlResult = detectAndHandleRateLimit(rateLimitErr, "call_rate_limited_api");
console.log("5) Rate limit → structured result (model can retry after delay):");
console.log(JSON.stringify(rlResult, null, 2));
