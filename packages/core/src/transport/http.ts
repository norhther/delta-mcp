import type { IncomingMessage, ServerResponse } from "http";
import type { JsonRpcRequest, JsonRpcResponse } from "../protocol/types.js";
import { MCP_BASELINE_VERSION } from "../protocol/types.js";
import { type Codec, getCodec, getCodecForContentType } from "../encoding/codec.js";
import {
  buildPRMDocument,
  buildWWWAuthenticate,
  validateToken,
  type JwtHeader,
  type JwtPayload,
} from "../auth/oauth21.js";

/** RFC 9728 well-known path for Protected Resource Metadata. */
const PRM_PATH = "/.well-known/oauth-protected-resource";

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
  /**
   * Full OAuth 2.1 resource-server mode. When set, the transport serves the
   * RFC 9728 PRM document at `/.well-known/oauth-protected-resource`, validates
   * bearer tokens for audience (RFC 8707) + expiry + signature, and emits
   * spec-compliant `WWW-Authenticate` challenges with error reasons.
   *
   * Takes precedence over `validateToken` (the presence-only dev hook).
   */
  oauth?: {
    /** This server's canonical URL — must match the token `aud` claim (RFC 8707). */
    resourceUrl: string;
    /** Authorization servers advertised in the PRM document. */
    authorizationServers: string[];
    /** Verify the JWT signature. Without it, audience + expiry are still enforced. */
    verifySignature?: (token: string, header: JwtHeader, payload: JwtPayload) => Promise<boolean>;
    /** RFC 7662 introspection endpoint, used when `verifySignature` is absent. */
    introspectionEndpoint?: string;
    clientCredentials?: { id: string; secret: string };
    /** Optional PRM hints. */
    signingAlgs?: string[];
    documentationUrl?: string;
  };
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

    // RFC 9728 Protected Resource Metadata — unauthenticated discovery endpoint.
    // Served only in full OAuth mode; lets a client follow the 401 challenge to
    // find its authorization server.
    if (opts.oauth && req.method === "GET" && reqPath(req) === PRM_PATH) {
      const prm = buildPRMDocument(opts.oauth.resourceUrl, opts.oauth.authorizationServers, {
        signingAlgs: opts.oauth.signingAlgs,
        documentationUrl: opts.oauth.documentationUrl,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(prm));
      return;
    }

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

    // OAuth 2.1 resource-server role: validate bearer token.
    if (opts.oauth) {
      // Full mode: RFC 8707 audience + expiry + signature, spec WWW-Authenticate.
      const prmUrl = `${opts.oauth.resourceUrl}${PRM_PATH}`;
      const auth = req.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length === 0) {
        res.writeHead(401, { "WWW-Authenticate": buildWWWAuthenticate(prmUrl) });
        res.end();
        return;
      }
      const validation = await validateToken(token, opts.oauth.resourceUrl, {
        verifySignature: opts.oauth.verifySignature,
        introspectionEndpoint: opts.oauth.introspectionEndpoint,
        clientCredentials: opts.oauth.clientCredentials,
      });
      if (!validation.valid) {
        res.writeHead(401, {
          "WWW-Authenticate": buildWWWAuthenticate(prmUrl, {
            error: "invalid_token",
            errorDescription: validation.error ?? "Token validation failed",
          }),
        });
        res.end();
        return;
      }
    } else if (authRequired) {
      // Presence-only dev mode (or custom `validateToken` hook).
      const auth = req.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      const ok = token.length > 0 && (opts.validateToken ? await opts.validateToken(token, req) : true);
      if (!ok) {
        res.writeHead(401, {
          "WWW-Authenticate": `Bearer realm="delta-mcp", resource_metadata="${PRM_PATH}"`,
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
    if (!response) {
      // Notification — MCP Streamable HTTP: 202 Accepted, no body.
      res.writeHead(202);
      res.end();
      return;
    }
    const resCodec = pickResponseCodec(req.headers.accept, reqCodec);
    res.writeHead(200, { "Content-Type": resCodec.contentType });
    res.end(resCodec.encode(response));
  };
}

/** Extract the path component of a request URL, ignoring any query string. */
function reqPath(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q);
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
