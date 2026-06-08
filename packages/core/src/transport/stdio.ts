import { createInterface } from "readline";
import type { JsonRpcRequest, JsonRpcResponse } from "../protocol/types.js";

export type MessageHandler = (msg: JsonRpcRequest) => Promise<JsonRpcResponse | null>;

/**
 * Stdio transport — local MCP2 server/client communication.
 * Newline-delimited JSON, one message per line.
 */
export class StdioTransport {
  private rl = createInterface({ input: process.stdin, terminal: false });

  constructor(private handler: MessageHandler) {}

  start(): void {
    this.rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let msg: JsonRpcRequest;
      try {
        msg = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        this.send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        return;
      }

      const response = await this.handler(msg);
      if (response) this.send(response);
    });

    this.rl.on("close", () => process.exit(0));
  }

  send(msg: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }
}
