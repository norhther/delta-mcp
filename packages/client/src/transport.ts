import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import type { JsonRpcRequest, JsonRpcResponse } from "@mcp2/core";

export type PendingRequest = {
  resolve: (v: JsonRpcResponse) => void;
  reject: (e: Error) => void;
};

/** Stdio transport for client side — spawns a server process, talks JSON-RPC */
export class StdioClientTransport {
  private proc: ChildProcess;
  private pending = new Map<string | number, PendingRequest>();
  private nextId = 1;
  private rl: ReturnType<typeof createInterface>;
  private notificationHandlers: Array<(method: string, params: unknown) => void> = [];

  constructor(command: string, args: string[] = [], env?: Record<string, string>) {
    this.proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...env },
    });

    this.rl = createInterface({ input: this.proc.stdout!, terminal: false });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const msg = JSON.parse(trimmed) as JsonRpcResponse & { method?: string; params?: unknown };

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

  send(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.proc.stdin!.write(JSON.stringify(msg) + "\n");
    });
  }

  notify(method: string, params?: unknown): void {
    const msg = { jsonrpc: "2.0", method, params };
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }

  async close(): Promise<void> {
    this.proc.stdin!.end();
    await new Promise<void>((r) => this.proc.once("exit", () => r()));
  }
}

/** HTTP transport for remote MCP2 servers */
export class HttpClientTransport {
  private nextId = 1;

  constructor(
    private baseUrl: string,
    private token?: string
  ) {}

  async send(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "mcp2/0.1.0",
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(msg),
    });

    if (res.status === 401) {
      const wwwAuth = res.headers.get("WWW-Authenticate") ?? "";
      throw new AuthRequired(wwwAuth);
    }

    return res.json() as Promise<JsonRpcResponse>;
  }

  notify(_method: string, _params?: unknown): void {
    // HTTP transport: notifications sent as fire-and-forget POST
  }
}

export class AuthRequired extends Error {
  constructor(public readonly wwwAuthenticate: string) {
    super(`Server requires auth: ${wwwAuthenticate}`);
  }
}
