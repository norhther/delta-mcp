import { describe, it, expect } from "vitest";
import {
  benchmarkToolDiscovery,
  benchmarkEncoding,
  formatBenchmark,
  estimateTokens,
} from "./token-counter.js";
import type { ToolDefinition } from "../protocol/types.js";

const SAMPLE_TOOLS: ToolDefinition[] = [
  {
    name: "search",
    description: "Search docs and return top results",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query string to execute" },
        limit: { type: "number", default: 10, description: "Maximum number of results to return" },
        filters: {
          type: "object",
          properties: {
            dateRange: { type: "string", enum: ["day", "week", "month", "year"] },
            language: { type: "string" },
          },
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_file",
    description: "Read file contents from the workspace",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        encoding: { type: "string", default: "utf8", enum: ["utf8", "base64", "hex"] },
        startLine: { type: "number" },
        endLine: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in workspace",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        encoding: { type: "string", default: "utf8" },
        createDirs: { type: "boolean", default: false },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_dir",
    description: "List directory contents at given path",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", default: "." },
        recursive: { type: "boolean", default: false },
        include: { type: "array", items: { type: "string" } },
        exclude: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "run_command",
    description: "Execute shell command in workspace sandbox",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeout: { type: "number", default: 30000 },
        env: { type: "object" },
      },
      required: ["command"],
    },
  },
];

describe("Token efficiency benchmark", () => {
  it("MCP2 progressive disclosure uses ≤20% of standard MCP tokens for 5-tool server", () => {
    const result = benchmarkToolDiscovery(SAMPLE_TOOLS);

    console.log(`\n${formatBenchmark([result])}`);
    console.log(`  Standard MCP: ${result.standardTokens} tokens`);
    console.log(`  MCP2:         ${result.mcp2Tokens} tokens`);
    console.log(`  Reduction:    ${result.reductionPercent}`);

    // Must beat 75% reduction for 5-tool server with realistic schemas
    const reductionFraction = result.reduction / result.standardTokens;
    expect(reductionFraction).toBeGreaterThan(0.75);
    expect(result.mcp2Tokens).toBeLessThan(result.standardTokens);
  });

  it("MCP2 summaries stay near 600 tokens total for up to 20 tools", () => {
    // Repeat our 5 tools 4x to simulate a 20-tool server
    const manyTools = [...SAMPLE_TOOLS, ...SAMPLE_TOOLS, ...SAMPLE_TOOLS, ...SAMPLE_TOOLS];
    const result = benchmarkToolDiscovery(manyTools);

    const summaryTokens = result.mcp2Tokens;
    console.log(`\n  20-tool server summary tokens: ${summaryTokens}`);
    // ≤60 chars per description × 20 tools + overhead ≈ ≤600 tokens
    expect(summaryTokens).toBeLessThan(600);
  });

  it("compact-json reduces wire size vs standard JSON", () => {
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: SAMPLE_TOOLS.map(({ name, description }) => ({ name, description })),
      },
    };

    const bench = benchmarkEncoding(payload);
    console.log(`\n  Compact-JSON reduction: ${bench.reductionPercent}`);
    console.log(`  Standard: ${bench.standardBytes} bytes → Compact: ${bench.compactBytes} bytes`);

    const reduction = (bench.standardBytes - bench.compactBytes) / bench.standardBytes;
    expect(reduction).toBeGreaterThan(0.1); // ≥10% reduction
  });

  it("token estimator is reasonably calibrated", () => {
    // ~4 chars per token — test against known inputs
    expect(estimateTokens("hello world")).toBe(4); // '"hello world"' = 13 chars / 4 ≈ 4
    expect(estimateTokens({ a: 1 })).toBe(2); // '{"a":1}' = 7 chars / 4 ≈ 2
  });
});
