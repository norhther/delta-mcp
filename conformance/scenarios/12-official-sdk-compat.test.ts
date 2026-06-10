/**
 * Conformance: Official MCP SDK compatibility
 * Verifies that a standard @modelcontextprotocol/sdk client can connect to a
 * delta-mcp server and use it without any delta-aware code — full schemas on
 * tools/list, tool calls work, no crashes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const DEMO_SERVER = join(__dir, "../../packages/server/dist/demo.js");

describe("CS-12: Official @modelcontextprotocol/sdk client compatibility", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "node",
      args: [DEMO_SERVER],
    });
    client = new Client({ name: "official-sdk-test", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("CS-12-01: initialize handshake succeeds", async () => {
    // If we reached here, connect() didn't throw — handshake completed.
    expect(client).toBeDefined();
  });

  it("CS-12-02: tools/list returns full schemas for standard client", async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBeGreaterThan(0);

    // Standard client must get full inputSchema — not progressive summaries
    for (const tool of result.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.inputSchema).toBe("object");
    }
  });

  it("CS-12-03: known tools are present with correct names", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("search");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("list_dir");
    expect(names).toContain("run_command");
  });

  it("CS-12-04: tools/call executes and returns content", async () => {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "MCP specification" },
    });

    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);

    const text = (result.content[0] as { type: string; text: string }).text;
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("CS-12-05: tools/call returns structured result parseable as JSON", async () => {
    const result = await client.callTool({
      name: "list_dir",
      arguments: {},
    });

    const text = (result.content[0] as { type: string; text: string }).text;
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("CS-12-06: unknown tool returns MCP error, does not crash server", async () => {
    await expect(
      client.callTool({ name: "nonexistent_tool", arguments: {} })
    ).rejects.toThrow();
  });
});
