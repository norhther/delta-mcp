import type { RateLimitResult } from "../protocol/types.js";

export interface ResultHandlerOptions {
  maxTokens?: number; // approx chars before summarization kicks in
  paginateAfter?: number;
}

const DEFAULT_MAX_TOKENS = 2000; // ~500 tokens at 4 chars/token

/**
 * Keeps large tool results out of context.
 * Summarize/paginate before routing through LLM context — the other half
 * of the token-efficiency story (tool-definition bloat is the first half).
 */
export function handleToolResult(
  result: unknown,
  opts: ResultHandlerOptions = {}
): unknown {
  const maxChars = (opts.maxTokens ?? DEFAULT_MAX_TOKENS) * 4;

  if (typeof result === "string" && result.length > maxChars) {
    return summarizeString(result, maxChars);
  }

  if (Array.isArray(result) && result.length > (opts.paginateAfter ?? 50)) {
    return paginateArray(result, opts.paginateAfter ?? 50);
  }

  return result;
}

/** Convert upstream 429 into a reasoner-friendly result, not a crash */
export function handleRateLimit(
  retryAfterSeconds: number,
  upstream: string
): RateLimitResult {
  return {
    type: "rate_limited",
    retryAfterSeconds,
    upstream,
  };
}

function summarizeString(s: string, maxChars: number): Record<string, unknown> {
  return {
    truncated: true,
    totalChars: s.length,
    preview: s.slice(0, maxChars),
    note: `Result truncated to ~${Math.round(maxChars / 4)} tokens. Request with pagination params for full data.`,
  };
}

function paginateArray(arr: unknown[], pageSize: number): Record<string, unknown> {
  return {
    paginated: true,
    totalItems: arr.length,
    page: 1,
    pageSize,
    items: arr.slice(0, pageSize),
    note: `Showing ${pageSize} of ${arr.length} items. Pass page param for more.`,
  };
}
