import type { IncomingMessage, ServerResponse } from "http";
import type { JsonRpcRequest, JsonRpcResponse } from "../protocol/types.js";
import { DELTA_PROTOCOL_VERSION } from "../protocol/types.js";

export type HttpMessageHandler = (
  msg: JsonRpcRequest,
  req: IncomingMessage
) => Promise<JsonRpcResponse | null>;

export interface HttpHandlerOptions {
  /** Require a Bearer token on every POST. Default: true. Set false for local/dev use. */
  authRequired?: boolean;
}

/**
 * Streamable HTTP transport (MCP 2025-11-25 spec).
 * Single endpoint, optional SSE on GET.
 * Validates MCP-Protocol-Version header — required from 2025-06-18 onward.
 */
export function createHttpHandler(handler: HttpMessageHandler, opts: HttpHandlerOptions = {}) {
  const authRequired = opts.authRequired ?? true;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Version header validation
    const clientVersion = req.headers["mcp-protocol-version"] as string | undefined;
    if (!clientVersion) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing MCP-Protocol-Version header" }));
      return;
    }

    res.setHeader("MCP-Protocol-Version", DELTA_PROTOCOL_VERSION);

    // SSE stream for server-initiated messages
    if (req.method === "GET" && req.headers.accept?.includes("text/event-stream")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      req.socket.on("close", () => res.end());
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    // OAuth 2.1 resource-server role: validate bearer token
    if (authRequired) {
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        res.writeHead(401, {
          "WWW-Authenticate":
            'Bearer realm="delta-mcp", resource_metadata="/.well-known/oauth-protected-resource"',
        });
        res.end();
        return;
      }
    }

    const body = await readBody(req);
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(body) as JsonRpcRequest;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
      return;
    }

    const response = await handler(msg, req);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(response ? JSON.stringify(response) : "");
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
