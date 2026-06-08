/**
 * Conformance: Progressive disclosure protocol
 * Verifies: tools/list returns summaries only, tools/describe returns full schema,
 *           schema cache, description length enforcement
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServerFixture, type ServerFixture } from "../harness/server-fixture.js";
import { ProgressiveToolRegistry } from "@mcp2/core";

describe("CS-02: Progressive disclosure", () => {
  let fx: ServerFixture;
  beforeAll(async () => { fx = await createServerFixture(); });
  afterAll(async () => { await fx.teardown(); });

  it("CS-02-01: tools/list returns names and descriptions only (no inputSchema)", async () => {
    const tools = await fx.client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect((t as any).inputSchema).toBeUndefined();
    }
  });

  it("CS-02-02: all descriptions are ≤60 characters", async () => {
    const tools = await fx.client.listTools();
    for (const t of tools) {
      expect(t.description.length, `"${t.name}" description too long`).toBeLessThanOrEqual(60);
    }
  });

  it("CS-02-03: tools/describe returns full inputSchema", async () => {
    const tools = await fx.client.listTools();
    const name = tools[0]!.name;
    const full = await fx.client.describeTool(name);
    expect(full.inputSchema).toBeDefined();
    expect(full.inputSchema.type).toBe("object");
  });

  it("CS-02-04: tools/describe is cached — second call does not add latency", async () => {
    const tools = await fx.client.listTools();
    const name = tools[0]!.name;

    const t0 = performance.now();
    await fx.client.describeTool(name);
    const wireMs = performance.now() - t0;

    const t1 = performance.now();
    await fx.client.describeTool(name);
    const cacheMs = performance.now() - t1;

    // Cache hit should be orders of magnitude faster than wire call
    expect(cacheMs).toBeLessThan(wireMs * 0.1 + 1);
  });

  it("CS-02-05: unknown tool returns error on describe", async () => {
    await expect(fx.client.describeTool("nonexistent_tool_xyz")).rejects.toThrow();
  });

  it("CS-02-06: ProgressiveToolRegistry rejects descriptions > 60 chars (unit)", () => {
    const reg = new ProgressiveToolRegistry();
    expect(() =>
      reg.register({
        name: "t",
        description: "This description is deliberately too long to pass the sixty character limit",
        inputSchema: { type: "object", properties: {} },
      })
    ).toThrow(/60 chars/);
  });

  it("CS-02-07: schema hashes are stable across registry instances (unit)", () => {
    const schema = { type: "object", properties: { q: { type: "string" } } };
    const r1 = new ProgressiveToolRegistry();
    const r2 = new ProgressiveToolRegistry();
    r1.register({ name: "t", description: "Short description under limit", inputSchema: schema });
    r2.register({ name: "t", description: "Short description under limit", inputSchema: schema });
    expect(r1.schemaHash("t")).toBe(r2.schemaHash("t"));
  });
});
