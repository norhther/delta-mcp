/**
 * Conformance: Protocol soundness
 * Verifies: version-skew negotiation, JSON-RPC notification semantics,
 * honest capability advertisement, HTTP 202 for notifications.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import { StdioClientTransport } from "@delta-mcp/client";
import { createHttpHandler, MCP_BASELINE_VERSION } from "@delta-mcp/core";
import { createServerFixture, type ServerFixture } from "../harness/server-fixture.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const DEMO_SERVER = join(__dir, "../../packages/server/dist/demo.js");

describe("CS-10: Protocol soundness", () => {
  describe("version skew", () => {
    let transport: StdioClientTransport;
    beforeAll(() => { transport = new StdioClientTransport("node", [DEMO_SERVER]); });
    afterAll(async () => { await transport.close(); });

    it("CS-10-01: unknown delta major version negotiates down to baseline MCP", async () => {
      const res = await transport.send("initialize", {
        protocolVersion: "delta-mcp/9.0.0",
        clientInfo: { name: "future-client", version: "9.0.0" },
        capabilities: {
          tools: { progressiveDisclosure: true },
          encoding: { compactJson: true },
        },
      });

      expect(res.error).toBeUndefined();
      const result = res.result as {
        protocolVersion: string;
        capabilities: Record<string, unknown>;
        encoding?: { format: string };
      };
      // Server answers as a baseline MCP server: no delta extensions, plain JSON.
      expect(result.protocolVersion).toBe(MCP_BASELINE_VERSION);
      expect(result.capabilities.tools ?? {}).not.toHaveProperty("progressiveDisclosure");
      expect(result.encoding?.format ?? "json").toBe("json");

      // Downgraded session still serves full schemas (standard MCP behavior).
      const list = await transport.send("tools/list");
      const tools = (list.result as { tools: Array<Record<string, unknown>> }).tools;
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0]).toHaveProperty("inputSchema");
    });
  });

  describe("notification semantics", () => {
    let fx: ServerFixture;
    beforeAll(async () => { fx = await createServerFixture(); });
    afterAll(async () => { await fx.teardown(); });

    it("CS-10-02: unknown-method notification produces no response and does not corrupt the stream", async () => {
      let strayResponses = 0;
      fx.transport.onNotification(() => strayResponses++);

      // JSON-RPC 2.0: a request without `id` is a notification — the server
      // MUST NOT reply, even with an error.
      fx.transport.notify("bogus/method");
      fx.transport.notify("tools/list");

      // The session must remain healthy; any reply to the notifications above
      // would either surface as a stray notification or desync request ids.
      const tools = await fx.client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(strayResponses).toBe(0);
    });
  });

  describe("honest capability advertisement", () => {
    let fx: ServerFixture;
    beforeAll(async () => { fx = await createServerFixture(); });
    afterAll(async () => { await fx.teardown(); });

    it("CS-10-03: server does not advertise unimplemented schemaHashReferencing", () => {
      expect(fx.client.sessionInfo.capabilities.encoding?.schemaHashReferencing).toBeFalsy();
    });

    it("CS-10-04: server does not advertise unimplemented codeExecution", () => {
      expect(fx.client.sessionInfo.capabilities.codeExecution).toBeUndefined();
    });
  });

  describe("HTTP notification handling", () => {
    let server: Server;
    let url: string;

    beforeAll(async () => {
      const handler = createHttpHandler(
        async (msg) => (msg.id === undefined ? null : { jsonrpc: "2.0", id: msg.id, result: {} }),
        { authRequired: false }
      );
      server = createServer((req, res) => void handler(req, res));
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const addr = server.address() as { port: number };
      url = `http://127.0.0.1:${addr.port}`;
    });
    afterAll(async () => { await new Promise((r) => server.close(r)); });

    it("CS-10-05: notification returns 202 Accepted with empty body", async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": MCP_BASELINE_VERSION,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
      expect(res.status).toBe(202);
      expect(await res.text()).toBe("");
    });
  });
});
