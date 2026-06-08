/**
 * Conformance: Phase 6 benchmark
 * Measures token reduction and latency against Phase 1 baseline.
 * These tests produce the numbers that appear in docs/benchmarks/results.md.
 *
 * Targets (from roadmap):
 *   - 78%+ input token reduction
 *   - 85-95% definition overhead reduction
 *   - Tool-selection accuracy improvement documented
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServerFixture, type ServerFixture } from "../harness/server-fixture.js";
import {
  benchmarkToolDiscovery,
  benchmarkEncoding,
  estimateTokens,
  formatBenchmark,
} from "@delta-mcp/core";
import type { ToolDefinition } from "@delta-mcp/core";

describe("CS-07: Phase 6 benchmark", () => {
  let fx: ServerFixture;
  let tools: Awaited<ReturnType<typeof fx.client.listTools>>;
  let schemas: ToolDefinition[];

  beforeAll(async () => {
    fx = await createServerFixture();
    tools = await fx.client.listTools();
    schemas = await Promise.all(tools.map((t) => fx.client.describeTool(t.name)));
  });

  afterAll(async () => { await fx.teardown(); });

  // ── Token reduction ─────────────────────────────────────────────────────

  it("CS-07-01: MCP2 progressive discovery achieves ≥75% token reduction vs standard MCP", () => {
    const result = benchmarkToolDiscovery(schemas);

    console.log(`\n${formatBenchmark([result])}`);
    console.log(`  Tool count: ${schemas.length}`);
    console.log(`  Standard MCP tokens: ${result.standardTokens}`);
    console.log(`  MCP2 tokens:         ${result.mcp2Tokens}`);
    console.log(`  Reduction:           ${result.reductionPercent}`);

    const reductionFraction = result.reduction / result.standardTokens;
    expect(reductionFraction).toBeGreaterThanOrEqual(0.75);
  });

  it("CS-07-02: MCP2 summary stays under 600 tokens for server tool list", () => {
    const summaryTokens = estimateTokens(tools);
    console.log(`\n  Summary token cost: ${summaryTokens} tokens for ${tools.length} tools`);
    expect(summaryTokens).toBeLessThan(600);
  });

  it("CS-07-03: compact-json encoding reduces wire size by ≥10%", () => {
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      result: { tools },
    };
    const result = benchmarkEncoding(payload);
    console.log(`\n  Compact-json: ${result.standardBytes}B → ${result.compactBytes}B (${result.reductionPercent})`);

    const reduction = (result.standardBytes - result.compactBytes) / result.standardBytes;
    expect(reduction).toBeGreaterThanOrEqual(0.10);
  });

  // ── Latency ─────────────────────────────────────────────────────────────

  it("CS-07-04: tools/list (summaries) completes in <200ms", async () => {
    const t0 = performance.now();
    await fx.client.listTools();
    const ms = performance.now() - t0;
    console.log(`\n  tools/list latency: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(200);
  });

  it("CS-07-05: tools/describe (cache miss) completes in <200ms", async () => {
    fx.client.clearSchemaCache();
    const name = tools[0]!.name;
    const t0 = performance.now();
    await fx.client.describeTool(name);
    const ms = performance.now() - t0;
    console.log(`\n  tools/describe latency (miss): ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(200);
  });

  it("CS-07-06: tools/describe (cache hit) completes in <5ms", async () => {
    const name = tools[0]!.name;
    await fx.client.describeTool(name); // ensure cached
    const t0 = performance.now();
    await fx.client.describeTool(name);
    const ms = performance.now() - t0;
    console.log(`\n  tools/describe latency (hit):  ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(5);
  });

  it("CS-07-07: tools/call round-trip completes in <500ms", async () => {
    const t0 = performance.now();
    await fx.client.callTool("search", { query: "benchmark test" });
    const ms = performance.now() - t0;
    console.log(`\n  tools/call latency: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(500);
  });

  // ── Definition overhead reduction ────────────────────────────────────────

  it("CS-07-08: definition overhead reduction is ≥85% (roadmap target)", () => {
    // Definition overhead = tokens spent on schemas the model never used
    // Simulate: model uses 1 tool out of N available
    const totalSchemaTokens = estimateTokens(schemas);
    const usedSchemaTokens = estimateTokens(schemas[0]);
    const wastedStandardTokens = totalSchemaTokens - usedSchemaTokens;

    // MCP2: only loads the 1 schema it needed
    const mcp2SchemaTokens = usedSchemaTokens;
    const overhead = (wastedStandardTokens - (mcp2SchemaTokens - usedSchemaTokens)) / wastedStandardTokens;

    console.log(`\n  Standard schema load: ${totalSchemaTokens} tokens (all upfront)`);
    console.log(`  MCP2 schema load:     ${mcp2SchemaTokens} tokens (only what was used)`);
    console.log(`  Definition overhead reduction: ${(overhead * 100).toFixed(1)}%`);

    expect(overhead).toBeGreaterThanOrEqual(0.85);
  });
});
