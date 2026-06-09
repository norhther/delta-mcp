import type { RateLimitResult } from "../protocol/types.js";

export interface ResultHandlerOptions {
  /** Approximate token budget. Results exceeding this are summarized. Default: 500 */
  maxTokens?: number;
  /** Array length before pagination. Default: 50 */
  paginateAfter?: number;
  /** For paginated requests — which page to return (1-indexed) */
  page?: number;
  /** Override page size for this call */
  pageSize?: number;
}

export interface TruncatedResult {
  truncated: true;
  totalChars: number;
  estimatedTokens: number;
  preview: string;
  note: string;
}

export interface PaginatedResult {
  paginated: true;
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  items: unknown[];
  note: string;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_PAGE_SIZE = 50;

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / CHARS_PER_TOKEN);
}

/**
 * Result handler — keeps large tool outputs out of LLM context.
 *
 * Handles:
 * - Strings over budget → truncated with preview
 * - Arrays over page size → paginated with navigation metadata
 * - Objects over budget → deep summarization (keys + value previews)
 * - Rate limits → reasoner-friendly result (see handleRateLimit)
 *
 * All truncation/pagination metadata gives the model enough to
 * request the rest in a follow-up call with explicit params.
 */
export function handleToolResult(
  result: unknown,
  opts: ResultHandlerOptions = {}
): unknown {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const pageSize = opts.pageSize ?? opts.paginateAfter ?? DEFAULT_PAGE_SIZE;
  const page = opts.page ?? 1;

  // Strings
  if (typeof result === "string") {
    if (result.length > maxChars) return truncateString(result, maxChars, maxTokens);
    return result;
  }

  // Arrays — paginate before token check (structure matters more than raw size)
  if (Array.isArray(result)) {
    if (result.length > pageSize) return paginateArray(result, page, pageSize);
    // Small array that's still too large in tokens
    if (estimateTokens(result) > maxTokens) return truncateJson(result, maxChars, maxTokens);
    return result;
  }

  // Objects — check token budget, then deep-summarize if over
  if (typeof result === "object" && result !== null) {
    if (estimateTokens(result) > maxTokens) return summarizeObject(result as Record<string, unknown>, maxChars, maxTokens);
    return result;
  }

  return result;
}

/** Convert upstream 429 into a reasoner-friendly result, not an error */
export function handleRateLimit(
  retryAfterSeconds: number,
  upstream: string,
  opts: { message?: string } = {}
): RateLimitResult {
  return {
    type: "rate_limited",
    retryAfterSeconds,
    upstream,
    ...(opts.message && { message: opts.message }),
  };
}

/**
 * Detect rate-limit from common upstream response shapes.
 * Converts to RateLimitResult so the agent loop doesn't crash.
 */
export function detectAndHandleRateLimit(
  error: unknown,
  upstream: string
): RateLimitResult | null {
  if (!error || typeof error !== "object") return null;

  const e = error as Record<string, unknown>;
  const status = (e["status"] ?? e["statusCode"]) as number | undefined;
  if (status !== 429) return null;

  const retryRaw =
    (e["headers"] as Record<string, string> | undefined)?.["retry-after"] ??
    (e["retryAfter"] as string | number | undefined) ??
    "30";
  const parsed = parseInt(String(retryRaw), 10);
  // Retry-After: 0 is valid ("retry now") — only fall back when truly unparseable.
  const retryAfter = Number.isNaN(parsed) || parsed < 0 ? 30 : parsed;

  const message = (e["message"] as string | undefined) ?? "Rate limit exceeded";
  return handleRateLimit(retryAfter, upstream, { message });
}

// ── Private helpers ───────────────────────────────────────────────────────────

function truncateString(s: string, maxChars: number, maxTokens: number): TruncatedResult {
  return {
    truncated: true,
    totalChars: s.length,
    estimatedTokens: Math.ceil(s.length / CHARS_PER_TOKEN),
    preview: s.slice(0, maxChars),
    note: `String truncated to ~${maxTokens} tokens (${maxChars} chars). Full length: ${s.length} chars (~${Math.ceil(s.length / CHARS_PER_TOKEN)} tokens).`,
  };
}

function truncateJson(value: unknown, maxChars: number, maxTokens: number): TruncatedResult {
  const serialized = JSON.stringify(value, null, 2);
  return {
    truncated: true,
    totalChars: serialized.length,
    estimatedTokens: Math.ceil(serialized.length / CHARS_PER_TOKEN),
    preview: serialized.slice(0, maxChars),
    note: `JSON result truncated to ~${maxTokens} tokens. Total: ~${Math.ceil(serialized.length / CHARS_PER_TOKEN)} tokens.`,
  };
}

function paginateArray(arr: unknown[], page: number, pageSize: number): PaginatedResult {
  const totalPages = Math.ceil(arr.length / pageSize);
  const clampedPage = Math.max(1, Math.min(page, totalPages));
  const start = (clampedPage - 1) * pageSize;
  const items = arr.slice(start, start + pageSize);

  return {
    paginated: true,
    totalItems: arr.length,
    page: clampedPage,
    pageSize,
    totalPages,
    hasMore: clampedPage < totalPages,
    items,
    note: `Page ${clampedPage}/${totalPages}. ${arr.length} total items. Pass page=${clampedPage + 1} for next page.`,
  };
}

function summarizeObject(
  obj: Record<string, unknown>,
  maxChars: number,
  maxTokens: number
): Record<string, unknown> {
  const keys = Object.keys(obj);
  const summary: Record<string, unknown> = {
    _summarized: true,
    _totalKeys: keys.length,
    _estimatedTokens: estimateTokens(obj),
    _note: `Object exceeded ~${maxTokens} token budget. Showing key structure and value previews.`,
  };

  let budget = maxChars;
  let shown = 0;
  for (const key of keys) {
    const val = obj[key];
    const preview = previewValue(val);
    const cost = JSON.stringify({ [key]: preview }).length;

    if (budget - cost < 0) {
      summary["_truncatedKeys"] = keys.length - shown; // keys omitted for budget
      break;
    }

    summary[key] = preview;
    budget -= cost;
    shown++;
  }

  return summary;
}

function previewValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "string") return val.length > 100 ? val.slice(0, 100) + "…" : val;
  if (typeof val === "number" || typeof val === "boolean") return val;
  if (Array.isArray(val)) return `[Array(${val.length})]`;
  if (typeof val === "object") {
    const keys = Object.keys(val as object);
    return `{Object: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ", ..." : ""}}`;
  }
  return String(val);
}
