import { createInterface } from "readline";
import type { JsonRpcRequest, JsonRpcResponse } from "../protocol/types.js";
import type { EncodingFormat } from "../encoding/negotiation.js";
import { type Codec, jsonCodec, getStdioCodec } from "../encoding/codec.js";

export type MessageHandler = (msg: JsonRpcRequest) => Promise<JsonRpcResponse | null>;

/**
 * Stdio transport — local Delta-MCP server/client communication.
 * Newline-delimited messages, one per line.
 *
 * Encoding: starts as plain JSON for the `initialize` handshake, then switches
 * to the negotiated codec (compact-json) once the server schedules it. The
 * switch is applied *after* the initialize response is sent, so the client —
 * which is still reading plain JSON at that point — can decode it.
 */
export class StdioTransport {
  private rl = createInterface({ input: process.stdin, terminal: false });
  private codec: Codec = jsonCodec;
  private pendingCodec: Codec | null = null;

  constructor(private handler: MessageHandler) {}

  /** Switch encoding immediately for subsequent reads and writes. */
  setEncoding(format: EncodingFormat): void {
    this.codec = getStdioCodec(format);
  }

  /** Switch encoding *after* the current reply is sent (handshake bootstrap). */
  scheduleEncoding(format: EncodingFormat): void {
    this.pendingCodec = getStdioCodec(format);
  }

  start(): void {
    // Process lines strictly in order. readline fires "line" without awaiting
    // the async handler, so without this chain a pipelined second line could be
    // decoded with a stale codec before a handshake-scheduled switch is applied.
    let queue: Promise<void> = Promise.resolve();
    this.rl.on("line", (line) => {
      queue = queue.then(() => this.processLine(line));
    });

    this.rl.on("close", () => {
      // Drain in-flight work before exiting so a final reply isn't dropped.
      queue.finally(() => process.exit(0));
    });
  }

  private async processLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: JsonRpcRequest;
    try {
      msg = this.codec.decode(trimmed) as JsonRpcRequest;
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

    // Apply a handshake-scheduled codec switch only after the reply is out.
    if (this.pendingCodec) {
      this.codec = this.pendingCodec;
      this.pendingCodec = null;
    }
  }

  send(msg: JsonRpcResponse): void {
    const data = this.codec.encode(msg);
    process.stdout.write((typeof data === "string" ? data : data.toString()) + "\n");
  }
}
