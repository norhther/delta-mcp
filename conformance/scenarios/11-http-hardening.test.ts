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

  describe("handler crash containment", () => {
    let fx: { server: Server; url: string };
    beforeAll(async () => {
      const handler = createHttpHandler(
        async () => { throw new Error("tool blew up"); },
        { authRequired: false }
      );
      const server = createServer((req, res) => void handler(req, res));
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const addr = server.address() as { port: number };
      fx = { server, url: `http://127.0.0.1:${addr.port}` };
    });
    afterAll(async () => { await new Promise((r) => fx.server.close(r)); });

    it("CS-11-06: a throwing handler yields 500, not an unhandled rejection", async () => {
      // Before the fix this was an unhandled promise rejection — a process
      // crash in production, a hung socket here.
      const res = await post(fx.url, RPC);
      expect(res.status).toBe(500);
    });
  });

  describe("Origin validation (DNS rebinding protection)", () => {
    let fx: { server: Server; url: string };
    beforeAll(async () => {
      fx = await startServer({ allowedOrigins: ["https://app.example.com"] });
    });
    afterAll(async () => { await new Promise((r) => fx.server.close(r)); });

    it("CS-11-07: request with an unlisted Origin is rejected with 403", async () => {
      const res = await fetch(fx.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": MCP_BASELINE_VERSION,
          Origin: "https://evil.example.com",
        },
        body: RPC,
      });
      expect(res.status).toBe(403);
    });

    it("CS-11-08: request with a listed Origin passes", async () => {
      const res = await fetch(fx.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": MCP_BASELINE_VERSION,
          Origin: "https://app.example.com",
        },
        body: RPC,
      });
      expect(res.status).toBe(200);
      // Without this the browser blocks the response even though the server
      // accepted the request — allowedOrigins must imply working CORS.
      expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    });

    it("CS-11-11: OPTIONS preflight from a listed Origin succeeds with CORS headers", async () => {
      const res = await fetch(fx.url, {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,mcp-protocol-version",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      const allowHeaders = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
      for (const h of ["content-type", "mcp-protocol-version", "mcp-session-id", "authorization"]) {
        expect(allowHeaders).toContain(h);
      }
    });

    it("CS-11-12: OPTIONS preflight from an unlisted Origin is rejected", async () => {
      const res = await fetch(fx.url, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "POST" },
      });
      expect(res.status).toBe(403);
    });

    it("CS-11-09: non-browser request (no Origin header) passes", async () => {
      const res = await post(fx.url, RPC);
      expect(res.status).toBe(200);
    });

    it("CS-11-10: with no allowedOrigins configured, any Origin-bearing request is rejected", async () => {
      // Spec: servers MUST validate Origin. A browser page should never reach
      // an MCP server whose operator didn't explicitly allow browser origins.
      const other = await startServer({});
      try {
        const res = await fetch(other.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "MCP-Protocol-Version": MCP_BASELINE_VERSION,
            Origin: "http://localhost:5173",
          },
          body: RPC,
        });
        expect(res.status).toBe(403);
      } finally {
        await new Promise((r) => other.server.close(r));
      }
    });
  });

  describe("invalid JSON-RPC shapes", () => {
    let fx: { server: Server; url: string };
    beforeAll(async () => { fx = await startServer({}); });
    afterAll(async () => { await new Promise((r) => fx.server.close(r)); });

    it("CS-11-13: valid JSON that is not a JSON-RPC object gets -32600, not 202", async () => {
      // "42" parses fine but is no request. Treating it as a notification
      // (202 Accepted) silently swallows malformed traffic.
      for (const body of ["42", '"hello"', "[1,2,3]", "null"]) {
        const res = await post(fx.url, body);
        expect(res.status).toBe(400);
        const parsed = await res.json() as { error?: { code: number } };
        expect(parsed.error?.code).toBe(-32600);
      }
    });
  });

  describe("protocol version validation", () => {
    let fx: { server: Server; url: string };
    beforeAll(async () => { fx = await startServer({}); });
    afterAll(async () => { await new Promise((r) => fx.server.close(r)); });

    it("CS-11-14: unsupported MCP-Protocol-Version value gets 400", async () => {
      const res = await fetch(fx.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "not-a-version" },
        body: RPC,
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain("Unsupported MCP-Protocol-Version");
    });

    it("CS-11-15: previous MCP date versions are accepted", async () => {
      // The POST JSON-RPC transport is identical across these revisions —
      // a client pinned to an older date version must still interoperate.
      for (const version of ["2025-06-18", "2025-03-26"]) {
        const res = await fetch(fx.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "MCP-Protocol-Version": version },
          body: RPC,
        });
        expect(res.status).toBe(200);
      }
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
