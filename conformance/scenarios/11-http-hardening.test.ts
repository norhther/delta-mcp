/**
 * Conformance: HTTP hardening
 * Verifies: body size limit (413), per-IP rate limiting (429 + Retry-After),
 * request timeout option plumbed through.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import { createHttpHandler, MCP_BASELINE_VERSION, type HttpHandlerOptions } from "@delta-mcp/core";

async function startServer(opts: HttpHandlerOptions): Promise<{ server: Server; url: string }> {
  const handler = createHttpHandler(
    async (msg) => (msg.id === undefined ? null : { jsonrpc: "2.0", id: msg.id, result: { ok: true } }),
    { authRequired: false, ...opts }
  );
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

function post(url: string, body: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_BASELINE_VERSION,
    },
    body,
  });
}

const RPC = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

describe("CS-11: HTTP hardening", () => {
  describe("body size limit", () => {
    let fx: { server: Server; url: string };
    beforeAll(async () => { fx = await startServer({ maxBodyBytes: 1024 }); });
    afterAll(async () => { await new Promise((r) => fx.server.close(r)); });

    it("CS-11-01: oversized body is rejected with 413", async () => {
      const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { pad: "x".repeat(2048) } });
      const res = await post(fx.url, big);
      expect(res.status).toBe(413);
    });

    it("CS-11-02: body within limit passes", async () => {
      const res = await post(fx.url, RPC);
      expect(res.status).toBe(200);
    });
  });

  describe("rate limiting", () => {
    let fx: { server: Server; url: string };
    beforeAll(async () => {
      fx = await startServer({ rateLimit: { limit: 3, windowMs: 60_000 } });
    });
    afterAll(async () => { await new Promise((r) => fx.server.close(r)); });

    it("CS-11-03: requests over the per-IP limit get 429 with Retry-After", async () => {
      for (let i = 0; i < 3; i++) {
        const ok = await post(fx.url, RPC);
        expect(ok.status).toBe(200);
      }
      const limited = await post(fx.url, RPC);
      expect(limited.status).toBe(429);
      const retryAfter = Number(limited.headers.get("Retry-After"));
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
  });

  describe("request timeout", () => {
    let fx: { server: Server; url: string };
    beforeAll(async () => {
      const handler = createHttpHandler(
        async (msg) => {
          await new Promise((r) => setTimeout(r, 500)); // slow tool
          return { jsonrpc: "2.0", id: msg.id ?? null, result: {} };
        },
        { authRequired: false, requestTimeoutMs: 100 }
      );
      const server = createServer((req, res) => void handler(req, res));
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const addr = server.address() as { port: number };
      fx = { server, url: `http://127.0.0.1:${addr.port}` };
    });
    afterAll(async () => { await new Promise((r) => fx.server.close(r)); });

    it("CS-11-04: handler exceeding requestTimeoutMs gets 504", async () => {
      const res = await post(fx.url, RPC);
      expect(res.status).toBe(504);
    });
  });

  describe("defaults", () => {
    let fx: { server: Server; url: string };
    beforeAll(async () => { fx = await startServer({}); });
    afterAll(async () => { await new Promise((r) => fx.server.close(r)); });

    it("CS-11-05: defaults do not break normal requests", async () => {
      const res = await post(fx.url, RPC);
      expect(res.status).toBe(200);
      const body = await res.json() as { result: { ok: boolean } };
      expect(body.result.ok).toBe(true);
    });
  });
});
