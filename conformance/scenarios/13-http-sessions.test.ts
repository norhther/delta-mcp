/**
 * Conformance: HTTP session isolation (Mcp-Session-Id)
 * Verifies: per-session negotiation state over HTTP. One DeltaServer instance
 * serves many clients — a standard MCP client initializing must not flip a
 * concurrently-connected delta client out of progressive disclosure (and vice
 * versa). Sessions are keyed by the Mcp-Session-Id header (MCP Streamable
 * HTTP spec): assigned by the server on initialize, echoed by the client on
 * every subsequent request.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import { DeltaServer } from "@delta-mcp/server";
import { DeltaClient, HttpClientTransport } from "@delta-mcp/client";
import { MCP_BASELINE_VERSION, type ToolDefinition } from "@delta-mcp/core";

class SessionTestServer extends DeltaServer {
  constructor() {
    super({ name: "session-test", version: "0.0.1" });
    this.tool({
      name: "echo",
      description: "Echo arguments back",
      inputSchema: { type: "object", properties: { value: { type: "string" } } },
    });
  }
  protected async callTool(_name: string, args: unknown): Promise<unknown> {
    return args;
  }
}

/** Raw initialize as a *standard* MCP client (date version, no delta caps). */
async function standardInitialize(url: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_BASELINE_VERSION, capabilities: {} },
    }),
  });
}

async function rawToolsList(url: string, sessionId?: string): Promise<{ tools: ToolDefinition[] }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "MCP-Protocol-Version": MCP_BASELINE_VERSION,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  const body = (await res.json()) as { result: { tools: ToolDefinition[] } };
  return body.result;
}

describe("CS-13: HTTP session isolation", () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = new SessionTestServer().startHttp({ port: 0, authRequired: false });
    await new Promise<void>((r) => server.once("listening", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("CS-13-01: initialize response carries an Mcp-Session-Id header", async () => {
    const res = await standardInitialize(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
  });

  it("CS-13-02: standard client initializing does not flip a delta session out of progressive disclosure", async () => {
    const transport = new HttpClientTransport(url);
    const client = new DeltaClient(transport);
    const session = await client.initialize();
    expect(session.progressiveDisclosure).toBe(true);

    // A standard MCP client connects to the same server instance.
    await standardInitialize(url);

    // The delta session must still get summaries, not full schemas.
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect((t as Partial<ToolDefinition>).inputSchema).toBeUndefined();
    }
  });

  it("CS-13-03: standard session gets full schemas while a delta session is live", async () => {
    const transport = new HttpClientTransport(url);
    const client = new DeltaClient(transport);
    await client.initialize();

    const init = await standardInitialize(url);
    const standardSessionId = init.headers.get("mcp-session-id") ?? undefined;
    const { tools } = await rawToolsList(url, standardSessionId);
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
    }
  });

  it("CS-13-04: request without a known session falls back to standard mode (full schemas)", async () => {
    // Delta client initializes — but this request carries no session id.
    const transport = new HttpClientTransport(url);
    await new DeltaClient(transport).initialize();

    const { tools } = await rawToolsList(url, undefined);
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
    }
  });
});
