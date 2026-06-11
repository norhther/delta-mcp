import type { ToolDefinition, ToolSummary } from "../protocol/types.js";
import { encodeCompact } from "../encoding/negotiation.js";

/**
 * Token estimation for MCP2 vs standard MCP comparison.
 * Uses 4 chars/token approximation (GPT/Claude average for English+JSON).
 * Good enough for order-of-magnitude comparison; not cl100k exact.
 */

export interface BenchmarkResult {
  scenario: string;
  standardTokens: number;
  mcp2Tokens: number;
  reduction: number;
  reductionPercent: string;
}

export function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

/**
 * Compare token cost of standard MCP eager loading vs MCP2 progressive disclosure.
 *
 * Standard MCP: all tool schemas sent in tools/list response.
 * MCP2: only names + ≤60-char descriptions sent; schemas fetched on demand.
 */
export function benchmarkToolDiscovery(tools: ToolDefinition[]): BenchmarkResult {
  // Standard MCP: full schemas in tools/list
  const standardPayload = { tools };
  const standardTokens = estimateTokens(standardPayload);

  // MCP2: summaries only
  const summaries: ToolSummary[] = tools.map(({ name, description }) => ({ name, description }));
  const mcp2Payload = { tools: summaries };
  const mcp2Tokens = estimateTokens(mcp2Payload);

  const reduction = standardTokens - mcp2Tokens;
  const reductionPercent = ((reduction / standardTokens) * 100).toFixed(1) + "%";

  return {
    scenario: `${tools.length}-tool discovery`,
    standardTokens,
    mcp2Tokens,
    reduction,
    reductionPercent,
  };
}

/**
 * Compare compact-json vs standard JSON wire size.
 */
export function benchmarkEncoding(payload: unknown): {
  standardBytes: number;
  compactBytes: number;
  reductionPercent: string;
} {
  const standard = JSON.stringify(payload);
  // Measure the real wire codec — a key-replacement simulation would drift
  // from COMPACT_KEY_MAP and corrupt string values containing key-like text.
  const compact = JSON.stringify(encodeCompact(payload));

  const reduction = ((standard.length - compact.length) / standard.length) * 100;

  return {
    standardBytes: standard.length,
    compactBytes: compact.length,
    reductionPercent: reduction.toFixed(1) + "%",
  };
}

/** Format benchmark results for console output */
export function formatBenchmark(results: BenchmarkResult[]): string {
  const title = "MCP2 Token Efficiency Benchmark";
  const headerCells = ["Scenario", "Standard", "MCP2", "Reduction"];
  const dataRows = results.map((r) => [
    r.scenario,
    `${r.standardTokens} tk`,
    `${r.mcp2Tokens} tk`,
    `${r.reductionPercent} (${r.reduction} tk)`,
  ]);

  const widths = headerCells.map((h, i) =>
    Math.max(h.length, ...dataRows.map((row) => row[i]!.length))
  );
  const innerWidth = widths.reduce((sum, w) => sum + w + 2, 0) + widths.length - 1;

  const border = (left: string, mid: string, right: string) =>
    left + widths.map((w) => "─".repeat(w + 2)).join(mid) + right;
  const row = (cells: string[]) =>
    "│" + cells.map((c, i) => ` ${c.padEnd(widths[i]!)} `).join("│") + "│";

  const leftPad = Math.floor((innerWidth - title.length) / 2);
  const titleRow = "│" + " ".repeat(leftPad) + title.padEnd(innerWidth - leftPad) + "│";

  return [
    "",
    "┌" + "─".repeat(innerWidth) + "┐",
    titleRow,
    border("├", "┬", "┤"),
    row(headerCells),
    border("├", "┼", "┤"),
    ...dataRows.map(row),
    border("└", "┴", "┘"),
  ].join("\n");
}
