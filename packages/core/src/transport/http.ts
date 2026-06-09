import type { IncomingMessage, ServerResponse } from "http";
import type { JsonRpcRequest, JsonRpcResponse } from "../protocol/types.js";
import { MCP_BASELINE_VERSION } from "../protocol/types.js";
import { type Codec, getCodec, getCodecForContentType } from "../encoding/codec.js";

export type HttpMessageHandler = (
  msg: JsonRpcRequest,
  req: IncomingMessage
) => Promise<JsonRpcResponse | null>;

export interface HttpHandlerOptions {
  /** Require a Bearer token on every POST. Default: true. Set false for local/dev use. */
  authRequired?: boolean;
  /**
   * Validate the bearer token (the raw value after "Bearer "). Return true to
   * accept. When omitted, auth is *presence-only* — any non-empty Bearer value
   * passes. Presence-only is dev-grade; wire a real validator (see
   * `validateToken` in ../auth/oauth21) for production.
   */
  validateToken?: (token: string, req: IncomingMessage) => boolean | Promise<boolean>;
}

/**
 * Streamable HTTP transport (MCP 2025-11-25 spec).
 * Single endpoint, optional SSE on GET.
 * Validates MCP-Protocol-Version header — required from 2025-06-18 onward.
 *
 * The MCP-Protocol-Version header carries the *baseline MCP* version
 * (`MCP_BASELINE_VERSION`) for ecosystem interop; Delta-MCP extensions are
 * advertised separately in the initialize result's `capabilities`.
 */
export function createHttpHandler(handler: HttpMessageHandler, opts: HttpHandlerOptions = {}) {
  const authRequired = opts.authRequired ?? true;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader("MCP-Protocol-Version", MCP_BASELINE_VERSION);
    const clientVersion = req.headers["mcp-protocol-version"] as string | undefined;

    // SSE stream for server-initiated messages (only meaningful post-initialize,
    // so the version header is required here).
    if (req.method === "GET" && req.headers.accept?.includes("text/event-stream")) {
      if (!clientVersion) return sendMissingVersion(res);
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
      const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      const ok = token.length > 0 && (opts.validateToken ? await opts.validateToken(token, req) : true);
      if (!ok) {
        res.writeHead(401, {
          "WWW-Authenticate":
            'Bearer realm="delta-mcp", resource_metadata="/.well-known/oauth-protected-resource"',
        });
        res.end();
        return;
      }
    }

    const reqCodec = getCodecForContentType(req.headers["content-type"]);
    const body = await readBody(req);
    let msg: JsonRpcRequest;
    try {
      msg = reqCodec.decode(body) as JsonRpcRequest;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
      return;
    }

    // Version header is mandatory on every request *except* initialize — the
    // client doesn't know the negotiated version until initialize returns.
    if (msg.method !== "initialize" && !clientVersion) {
      return sendMissingVersion(res);
    }

    const response = await handler(msg, req);
    const resCodec = pickResponseCodec(req.headers.accept, reqCodec);
    res.writeHead(200, { "Content-Type": resCodec.contentType });
    if (!response) {
      res.end("");
      return;
    }
    res.end(resCodec.encode(response));
  };
}

function sendMissingVersion(res: ServerResponse): void {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Missing MCP-Protocol-Version header" }));
}

/** Choose response codec from the client's Accept header, else echo the request codec. */
function pickResponseCodec(accept: string | undefined, fallback: Codec): Codec {
  if (accept) {
    if (accept.includes("application/cbor")) return getCodec("cbor");
    if (accept.includes("variant=compact")) return getCodec("compact-json");
    if (accept.includes("application/json")) return getCodec("json");
  }
  return fallback;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
