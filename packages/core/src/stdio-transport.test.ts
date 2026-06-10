import { describe, it, expect } from "vitest";
import { PassThrough } from "stream";
import { StdioTransport } from "./transport/stdio.js";
import type { JsonRpcRequest, JsonRpcResponse } from "./protocol/types.js";

/** Drive a transport with injected streams; collect emitted lines. */
function makeTransport(handler: (msg: JsonRpcRequest) => Promise<JsonRpcResponse | null>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: string[] = [];
  output.on("data", (chunk: Buffer) => {
    for (const l of chunk.toString().split("\n")) if (l.trim()) lines.push(l);
  });
  const transport = new StdioTransport(handler, { input, output, exitOnClose: false });
  transport.start();
  return { input, lines };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("StdioTransport robustness", () => {
  it("a throwing handler produces an INTERNAL_ERROR response, not silence", async () => {
    const { input, lines } = makeTransport(async () => {
      throw new Error("handler exploded");
    });

    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "boom" }) + "\n");
    await tick();

    expect(lines.length).toBe(1);
    const res = JSON.parse(lines[0]!) as JsonRpcResponse;
    expect(res.id).toBe(1);
    expect(res.error?.code).toBe(-32603);
    expect(res.error?.message).toContain("handler exploded");
  });

  it("the line queue survives a handler throw — later requests still process", async () => {
    let calls = 0;
    const { input, lines } = makeTransport(async (msg) => {
      calls++;
      if (msg.method === "boom") throw new Error("kaboom");
      return { jsonrpc: "2.0", id: (msg as { id: number }).id, result: { ok: true } };
    });

    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "boom" }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "fine" }) + "\n");
    await tick();

    expect(calls).toBe(2); // queue not poisoned by the first throw
    const last = JSON.parse(lines.at(-1)!) as JsonRpcResponse;
    expect(last.id).toBe(2);
    expect((last.result as { ok: boolean }).ok).toBe(true);
  });

  it("valid JSON that is not a JSON-RPC object gets INVALID_REQUEST, not silence", async () => {
    const { input, lines } = makeTransport(async () => null);

    input.write('"just a string"\n');
    input.write("42\n");
    await tick();

    expect(lines.length).toBe(2);
    for (const line of lines) {
      const res = JSON.parse(line) as JsonRpcResponse;
      expect(res.id).toBe(null);
      expect(res.error?.code).toBe(-32600);
    }
  });

  it("a throwing handler on a notification stays silent (JSON-RPC: no response to notifications)", async () => {
    const { input, lines } = makeTransport(async () => {
      throw new Error("boom");
    });

    input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/x" }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "after" }) + "\n");
    await tick();

    // Only the id:7 error response — nothing for the notification.
    expect(lines.length).toBe(1);
    expect((JSON.parse(lines[0]!) as JsonRpcResponse).id).toBe(7);
  });
});
