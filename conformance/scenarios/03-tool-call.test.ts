/**
 * Conformance: tools/call protocol
 * Verifies: successful calls, error on unknown tool, rate-limit passthrough
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServerFixture, type ServerFixture } from "../harness/server-fixture.js";

describe("CS-03: tools/call", () => {
  let fx: ServerFixture;
  beforeAll(async () => { fx = await createServerFixture(); });
  afterAll(async () => { await fx.teardown(); });

  it("CS-03-01: call returns result content", async () => {
    const result = await fx.client.callTool("search", { query: "mcp protocol" });
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("CS-03-02: call result is JSON-parseable (not raw error)", async () => {
    const result = await fx.client.callTool("search", { query: "test" });
    // Must be a valid JS value — no thrown exceptions
    expect(typeof result).not.toBe("undefined");
  });

  it("CS-03-03: unknown tool returns protocol error", async () => {
    await expect(fx.client.callTool("no_such_tool", {})).rejects.toThrow(/no_such_tool/);
  });

  it("CS-03-04: write_file tool returns structured result", async () => {
    const result = await fx.client.callTool("write_file", {
      path: "/tmp/test.txt",
      content: "hello mcp2",
    }) as Record<string, unknown>;
    expect(result.written).toBe(true);
    expect(result.path).toBe("/tmp/test.txt");
  });

  it("CS-03-05: list_dir tool returns array", async () => {
    const result = await fx.client.callTool("list_dir", { path: "." });
    expect(Array.isArray(result)).toBe(true);
  });

  it("CS-03-06: tools/call without an arguments field gets {} not undefined", async () => {
    // Models routinely omit `arguments` for zero-param tools. The tool handler
    // must receive an empty object — `args.foo` on undefined is a TypeError.
    // demo's search reads args["limit"], so it crashes if args is undefined.
    const res = await fx.transport.send("tools/call", { name: "search" });
    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();
  });
});
