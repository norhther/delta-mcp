import type { ToolDefinition, ToolSummary } from "../protocol/types.js";

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

  // Simulate compact encoding by shortening common keys
  const compact = standard
    .replace(/"jsonrpc"/g, '"j"')
    .replace(/"method"/g, '"m"')
    .replace(/"params"/g, '"p"')
    .replace(/"result"/g, '"r"')
    .replace(/"error"/g, '"e"')
    .replace(/"description"/g, '"d"')
    .replace(/"inputSchema"/g, '"s"')
    .replace(/"name"/g, '"n"');

  const reduction = ((standard.length - compact.length) / standard.length) * 100;

  return {
    standardBytes: standard.length,
    compactBytes: compact.length,
    reductionPercent: reduction.toFixed(1) + "%",
  };
}

/** Format benchmark results for console output */
export function formatBenchmark(results: BenchmarkResult[]): string {
  const header = `
┌─────────────────────────────────────────────────────────────┐
│              MCP2 Token Efficiency Benchmark                 │
├─────────────────────┬──────────┬──────────┬─────────────────┤
│ Scenario            │ Standard │   MCP2   │   Reduction     │
├─────────────────────┼──────────┼──────────┼─────────────────┤`;

  const rows = results.map(
    (r) =>
      `│ ${r.scenario.padEnd(19)} │ ${String(r.standardTokens).padStart(6)} tk │ ${String(r.mcp2Tokens).padStart(6)} tk │ ${r.reductionPercent.padStart(8)} (${r.reduction} tk) │`
  );

  const footer = "└─────────────────────┴──────────┴──────────┴─────────────────┘";

  return [header, ...rows, footer].join("\n");
}
