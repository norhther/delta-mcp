import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "http";
import { StdioClientTransport, HttpClientTransport } from "./transport.js";

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  return `http://127.0.0.1:${addr.port}`;
}

describe("StdioClientTransport robustness", () => {
  it("a nonexistent server command rejects pending requests instead of crashing", async () => {
    const transport = new StdioClientTransport("definitely-not-a-real-command-xyz", []);
    // Without an 'error' listener on the child process, spawn failure throws an
    // uncaught exception and takes the whole process down.
    await expect(transport.send("initialize")).rejects.toThrow(/spawn|exited|failed/i);
  });
});

describe("HttpClientTransport error surfaces", () => {
  it("non-OK response with an empty body throws a status error, not a JSON parse error", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(429, { "Retry-After": "7" });
      res.end(); // empty body — like the transport's own rate limiter
    });

    const transport = new HttpClientTransport(url);
    await expect(transport.send("tools/list")).rejects.toThrow(/429/);
  });

  it("non-OK response never reports 'Unexpected end of JSON input'", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(504);
      res.end();
    });

    const transport = new HttpClientTransport(url);
    await expect(transport.send("tools/call")).rejects.not.toThrow(/Unexpected end of JSON/);
  });
});
