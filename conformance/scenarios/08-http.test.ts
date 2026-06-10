/**
 * Conformance: HTTP transport
 * Verifies: initialize is exempt from the MCP-Protocol-Version header,
 * non-initialize requests require it, and codec negotiation works over HTTP
 * (compact-json request/response round-trip).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import {
  createHttpHandler,
  getCodec,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "@delta-mcp/core";
import { HttpClientTransport } from "@delta-mcp/client";

// Minimal echo handler — enough to exercise the transport layer.
const echo = async (msg: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
  if (msg.method === "notifications/initialized") return null;
  return { jsonrpc: "2.0", id: (msg.id ?? null) as JsonRpcResponse["id"], result: { ok: true, method: msg.method } };
};

describe("CS-08: HTTP transport", () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    const handler = createHttpHandler(echo, { authRequired: false });
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("CS-08-01: initialize is allowed without the version header", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(res.status).toBe(200);
  });

  it("CS-08-02: non-initialize request is rejected without the version header", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(res.status).toBe(400);
  });

  it("CS-08-03: compact-json request and response round-trip", async () => {
    const codec = getCodec("compact-json");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": codec.contentType, Accept: codec.contentType },
      body: codec.encode({ jsonrpc: "2.0", id: 3, method: "initialize" }) as string,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("variant=compact");
    const decoded = codec.decode(await res.text()) as JsonRpcResponse;
    expect((decoded.result as { ok: boolean }).ok).toBe(true);
  });

  it("CS-08-05: GET with Accept: text/event-stream returns 405 (no SSE stream offered)", async () => {
    // MCP Streamable HTTP: a server that does not offer an SSE stream at this
    // endpoint MUST return 405 — not a silent stream that never emits events.
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
    });
    expect(res.status).toBe(405);
  });

  it("CS-08-04: HttpClientTransport drives the server, then upgrades encoding", async () => {
    const transport = new HttpClientTransport(url);
    const init = await transport.send("initialize");
    expect((init.result as { ok: boolean }).ok).toBe(true);

    transport.setEncoding("compact-json");
    const after = await transport.send("ping");
    expect((after.result as { method: string }).method).toBe("ping");
  });
});
