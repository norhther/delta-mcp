import { createInterface, type Interface } from "readline";
import type { Readable, Writable } from "stream";
import type { JsonRpcRequest, JsonRpcResponse } from "../protocol/types.js";
import { ErrorCodes, isJsonRpcRequestShape } from "../protocol/types.js";
import type { EncodingFormat } from "../encoding/negotiation.js";
import { type Codec, jsonCodec, getStdioCodec } from "../encoding/codec.js";

export type MessageHandler = (msg: JsonRpcRequest) => Promise<JsonRpcResponse | null>;

export interface StdioTransportOptions {
  /** Input stream. Default: process.stdin. Injectable for tests. */
  input?: Readable;
  /** Output stream. Default: process.stdout. Injectable for tests. */
  output?: Writable;
  /** Exit the process when input closes. Default: true (stdio server semantics). */
  exitOnClose?: boolean;
}

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
  private rl: Interface;
  private output: Writable;
  private exitOnClose: boolean;
  private codec: Codec = jsonCodec;
  private pendingCodec: Codec | null = null;

  constructor(private handler: MessageHandler, opts: StdioTransportOptions = {}) {
    this.output = opts.output ?? process.stdout;
    this.exitOnClose = opts.exitOnClose ?? true;
    this.rl = createInterface({ input: opts.input ?? process.stdin, terminal: false });
  }

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
    // processLine never rejects (all failure paths answer in-band), but the
    // trailing catch keeps one unforeseen rejection from poisoning the chain
    // and silently wedging every subsequent request.
    let queue: Promise<void> = Promise.resolve();
    this.rl.on("line", (line) => {
      queue = queue.then(() => this.processLine(line)).catch(() => {});
    });

    this.rl.on("close", () => {
      // Drain in-flight work before exiting so a final reply isn't dropped.
      void queue.finally(() => {
        if (this.exitOnClose) process.exit(0);
      });
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
        error: { code: ErrorCodes.PARSE_ERROR, message: "Parse error" },
      });
      return;
    }

    if (!isJsonRpcRequestShape(msg)) {
      this.send({
        jsonrpc: "2.0",
        id: null,
        error: { code: ErrorCodes.INVALID_REQUEST, message: "Invalid Request" },
      });
      return;
    }

    try {
      const response = await this.handler(msg);
      if (response) this.send(response);
    } catch (err: unknown) {
      // A throwing handler must not kill the line queue. Requests get a
      // JSON-RPC error; notifications get nothing (spec: no response, ever).
      if (msg.id !== undefined) {
        this.send({
          jsonrpc: "2.0",
          id: msg.id ?? null,
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: err instanceof Error ? err.message : "Internal error",
          },
        });
      }
    }

    // Apply a handshake-scheduled codec switch only after the reply is out.
    if (this.pendingCodec) {
      this.codec = this.pendingCodec;
      this.pendingCodec = null;
    }
  }

  send(msg: JsonRpcResponse): void {
    const data = this.codec.encode(msg);
    this.output.write((typeof data === "string" ? data : data.toString()) + "\n");
  }
}
