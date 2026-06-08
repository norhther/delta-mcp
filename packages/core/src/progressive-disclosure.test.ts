import { describe, it, expect } from "vitest";
import { ProgressiveToolRegistry } from "./discovery/progressive.js";

describe("Progressive disclosure — Phase 2 conformance", () => {
  it("rejects descriptions > 60 chars", () => {
    const reg = new ProgressiveToolRegistry();
    expect(() =>
      reg.register({
        name: "bad_tool",
        description: "This description is way too long and exceeds the sixty character limit",
        inputSchema: { type: "object", properties: {} },
      })
    ).toThrow(/60 chars/);
  });

  it("listSummaries returns only name+description, not full schema", () => {
    const reg = new ProgressiveToolRegistry();
    reg.register({
      name: "search",
      description: "Search docs and return top results",
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
    });

    const summaries = reg.listSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({ name: "search", description: "Search docs and return top results" });
    expect((summaries[0] as any).inputSchema).toBeUndefined();
  });

  it("describe returns full schema on demand", () => {
    const reg = new ProgressiveToolRegistry();
    const tool = {
      name: "search",
      description: "Search docs and return top results",
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
    };
    reg.register(tool);

    const full = reg.describe("search");
    expect(full?.inputSchema).toBeDefined();
  });

  it("schema hashes are stable and unique", () => {
    const reg = new ProgressiveToolRegistry();
    reg.register({ name: "a", description: "Tool A — first example tool", inputSchema: { type: "object" } });
    reg.register({ name: "b", description: "Tool B — second example tool", inputSchema: { type: "string" } });

    expect(reg.schemaHash("a")).toHaveLength(8);
    expect(reg.schemaHash("a")).not.toBe(reg.schemaHash("b"));
    // Stability: same schema → same hash
    const reg2 = new ProgressiveToolRegistry();
    reg2.register({ name: "a", description: "Tool A — first example tool", inputSchema: { type: "object" } });
    expect(reg2.schemaHash("a")).toBe(reg.schemaHash("a"));
  });

  it("schema hash reflects nested properties (no collision on same top-level keys)", () => {
    const reg = new ProgressiveToolRegistry();
    reg.register({
      name: "a",
      description: "Tool A — first example tool",
      inputSchema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
    });
    reg.register({
      name: "b",
      description: "Tool B — second example tool",
      inputSchema: { type: "object", properties: { y: { type: "number" } }, required: ["x"] },
    });

    expect(reg.schemaHash("a")).not.toBe(reg.schemaHash("b"));
  });

  it("schema hash is independent of key insertion order", () => {
    const reg = new ProgressiveToolRegistry();
    reg.register({
      name: "a",
      description: "Tool A — first example tool",
      inputSchema: { type: "object", required: ["x"], properties: { x: { type: "string" } } },
    });
    const reg2 = new ProgressiveToolRegistry();
    reg2.register({
      name: "a",
      description: "Tool A — first example tool",
      inputSchema: { properties: { x: { type: "string" } }, type: "object", required: ["x"] },
    });
    expect(reg2.schemaHash("a")).toBe(reg.schemaHash("a"));
  });
});
