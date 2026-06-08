import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type EncodingFormat,
  type Codec,
  jsonCodec,
  getStdioCodec,
  getCodec,
  getCodecForContentType,
} from "@delta-mcp/core";

export type PendingRequest = {
  resolve: (v: JsonRpcResponse) => void;
  reject: (e: Error) => void;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Stdio transport for client side — spawns a server process, talks JSON-RPC */
export class StdioClientTransport {
  private proc: ChildProcess;
  private pending = new Map<string | number, PendingRequest>();
  private nextId = 1;
  private rl: ReturnType<typeof createInterface>;
  private notificationHandlers: Array<(method: string, params: unknown) => void> = [];
  private readonly timeoutMs: number;
  private codec: Codec = jsonCodec;

  constructor(command: string, args: string[] = [], env?: Record<string, string>, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
    this.proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...env },
    });

    this.rl = createInterface({ input: this.proc.stdout!, terminal: false });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let msg: JsonRpcResponse & { method?: string; params?: unknown };
      try {
        msg = this.codec.decode(trimmed) as JsonRpcResponse & { method?: string; params?: unknown };
      } catch {
        // Server emitted non-JSON on stdout (stray log line, banner). Skip it
        // rather than crashing the client's line handler with an uncaught throw.
        return;
      }

      // Notification (no id)
      if (msg.method && (msg as any).id === undefined) {
        for (const h of this.notificationHandlers) h(msg.method, msg.params);
        return;
      }

      const id = msg.id as string | number;
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.resolve(msg);
      }
    });

    this.proc.on("exit", (code) => {
      for (const [, p] of this.pending) p.reject(new Error(`Server exited with code ${code}`));
      this.pending.clear();
    });
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandlers.push(handler);
  }

  /** Switch to the negotiated codec for subsequent reads and writes. */
  setEncoding(format: EncodingFormat): void {
    this.codec = getStdioCodec(format);
  }

  private writeLine(msg: unknown): void {
    const data = this.codec.encode(msg);
    this.proc.stdin!.write((typeof data === "string" ? data : data.toString()) + "\n");
  }

  send(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request "${method}" (id=${id}) timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.writeLine(msg);
    });
  }

  notify(method: string, params?: unknown): void {
    this.writeLine({ jsonrpc: "2.0", method, params });
  }

  async close(): Promise<void> {
    this.proc.stdin!.end();
    await new Promise<void>((r) => this.proc.once("exit", () => r()));
  }
}

/** HTTP transport for remote Delta-MCP servers */
export class HttpClientTransport {
  private nextId = 1;
  private codec: Codec = jsonCodec;

  constructor(
    private baseUrl: string,
    private token?: string
  ) {}

  /** Switch to the negotiated codec for subsequent requests. */
  setEncoding(format: EncodingFormat): void {
    this.codec = getCodec(format);
  }

  /** Encode a message to a fetch-compatible body (Buffer is a valid BufferSource). */
  private encodeBody(msg: unknown): BodyInit {
    return this.codec.encode(msg) as BodyInit;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": this.codec.contentType,
      // Advertise what we can decode; server may answer in any of these.
      Accept: `${this.codec.contentType}, application/json`,
      "MCP-Protocol-Version": "delta-mcp/0.1.0",
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    return headers;
  }

  private async decodeResponse(res: Response): Promise<JsonRpcResponse> {
    const ct = res.headers.get("content-type");
    const codec = getCodecForContentType(ct);
    // Binary codecs (CBOR) need the raw bytes, not a decoded string.
    if (ct?.includes("application/cbor")) {
      const buf = Buffer.from(await res.arrayBuffer());
      return codec.decode(buf) as JsonRpcResponse;
    }
    return codec.decode(await res.text()) as JsonRpcResponse;
  }

  async send(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: this.headers(),
      body: this.encodeBody(msg),
    });

    if (res.status === 401) {
      const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";
      throw new AuthRequired(wwwAuth);
    }

    return this.decodeResponse(res);
  }

  notify(method: string, params?: unknown): void {
    const msg = { jsonrpc: "2.0", method, params };
    // Fire-and-forget: notifications have no response
    fetch(this.baseUrl, { method: "POST", headers: this.headers(), body: this.encodeBody(msg) }).catch(() => {});
  }
}

export class AuthRequired extends Error {
  constructor(public readonly wwwAuthenticate: string) {
    super(`Server requires auth: ${wwwAuthenticate}`);
  }
}
