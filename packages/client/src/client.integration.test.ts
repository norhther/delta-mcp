/**
 * Integration test: DeltaClient ↔ DeltaServer over stdio.
 * Also serves as Phase 1 baseline benchmark — logs token estimates.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DeltaClient } from "./client.js";
import { StdioClientTransport } from "./transport.js";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dir, "../../server/dist/demo.js");

function tokenEstimate(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

describe("MCP2 client ↔ server integration", () => {
  let transport: StdioClientTransport;
  let client: DeltaClient;

  beforeAll(async () => {
    transport = new StdioClientTransport("node", [SERVER]);
    client = new DeltaClient(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  it("initializes and negotiates progressive disclosure", async () => {
    const session = await client.initialize();
    expect(session.progressiveDisclosure).toBe(true);
    expect(session.capabilities.tools?.progressiveDisclosure).toBe(true);
  });

  it("lists tools with summaries only (≤60 chars each)", async () => {
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    const tokenCost = tokenEstimate(tools);
    console.log(`\n  [Phase 1 benchmark] tools/list token cost: ~${tokenCost} tokens`);
    console.log(`  Tool count: ${tools.length}`);
    console.log(`  Per-tool average: ~${Math.ceil(tokenCost / tools.length)} tokens`);

    for (const t of tools) {
      expect(t.description.length).toBeLessThanOrEqual(60);
      expect((t as any).inputSchema).toBeUndefined();
    }
  });

  it("fetches full schema on demand via describeTool", async () => {
    const tools = await client.listTools();
    const firstName = tools[0]?.name;
    if (!firstName) return;

    const full = await client.describeTool(firstName);
    expect(full.inputSchema).toBeDefined();
    console.log(`\n  [Phase 2 benchmark] describeTool("${firstName}") schema: ~${tokenEstimate(full.inputSchema)} tokens`);
  });

  it("schema cache prevents duplicate round-trips", async () => {
    const tools = await client.listTools();
    const name = tools[0]?.name;
    if (!name) return;

    const t0 = Date.now();
    await client.describeTool(name);
    const firstMs = Date.now() - t0;

    const t1 = Date.now();
    await client.describeTool(name); // should be cache hit
    const cachedMs = Date.now() - t1;

    expect(cachedMs).toBeLessThan(firstMs + 2); // cache ≈ 0ms
  });

  it("calls a tool and receives result", async () => {
    const result = await client.callTool("search", { query: "mcp protocol" });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("schema cache invalidation", () => {
  it("clears the cache when the server sends tools/list_changed", async () => {
    let notify: ((method: string, params: unknown) => void) | undefined;
    let describeCalls = 0;

    const fakeTransport = {
      send: async (method: string) => {
        if (method === "tools/describe") describeCalls++;
        return {
          jsonrpc: "2.0" as const,
          id: 1,
          result: { name: "t", description: "d", inputSchema: { type: "object" } },
        };
      },
      onNotification: (h: (method: string, params: unknown) => void) => { notify = h; },
    };

    const c = new DeltaClient(fakeTransport as never);
    await c.describeTool("t");
    await c.describeTool("t"); // cache hit
    expect(describeCalls).toBe(1);

    // Server announces its tool list changed — cached schemas may be stale.
    notify?.("notifications/tools/list_changed", {});

    await c.describeTool("t"); // must re-fetch
    expect(describeCalls).toBe(2);
  });
});
