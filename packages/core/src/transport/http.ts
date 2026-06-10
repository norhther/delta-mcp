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
  /** Max request body size in bytes. Oversized requests get 413. Default: 4 MiB. */
  maxBodyBytes?: number;
  /** Per-request handler deadline. Slower handlers get 504. Default: 30s. */
  requestTimeoutMs?: number;
  /**
   * Fixed-window per-IP rate limit. Over-limit requests get 429 + Retry-After.
   * Checked before auth so token validation can't be used as an amplifier.
   * In-memory — for multi-instance deployments put a shared limiter (reverse
   * proxy, Redis) in front instead.
   */
  rateLimit?: { limit: number; windowMs: number };
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
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const limiter = opts.rateLimit ? createRateLimiter(opts.rateLimit) : null;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader("MCP-Protocol-Version", MCP_BASELINE_VERSION);
    const clientVersion = req.headers["mcp-protocol-version"] as string | undefined;

    // Rate limit first — cheapest check, shields auth + body parsing.
    if (limiter) {
      const verdict = limiter(req.socket.remoteAddress ?? "unknown");
      if (!verdict.allowed) {
        res.writeHead(429, { "Retry-After": String(verdict.retryAfterSeconds) });
        res.end();
        return;
      }
    }

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
    let body: Buffer;
    try {
      body = await readBody(req, maxBodyBytes);
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        // Close the connection once the 413 is flushed — never drain the rest
        // of an attacker-sized payload.
        res.writeHead(413, { Connection: "close" });
        res.end(() => req.destroy());
        return;
      }
      throw err;
    }
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

    // Deadline on the handler: a hung tool must not pin the connection open.
    let response: JsonRpcResponse | null;
    try {
      response = await withTimeout(handler(msg, req), requestTimeoutMs);
    } catch (err) {
      if (err instanceof HandlerTimeout) {
        res.writeHead(504);
        res.end();
        return;
      }
      throw err;
    }
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

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MiB
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

class BodyTooLarge extends Error {}
class HandlerTimeout extends Error {}

/** Read the request body, aborting the stream as soon as the limit is crossed. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (c: Buffer) => {
      received += c.length;
      if (received > maxBytes) {
        // Stop reading without killing the socket yet — the caller still needs
        // to flush a 413 before the connection is torn down.
        req.pause();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new HandlerTimeout()), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

type RateVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Fixed-window per-IP counter. A full sweep runs at most once per window so
 * the map cannot grow unbounded under a rotating-IP flood.
 */
function createRateLimiter(cfg: { limit: number; windowMs: number }): (ip: string) => RateVerdict {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = Date.now();

  return (ip: string): RateVerdict => {
    const now = Date.now();

    if (now - lastSweep > cfg.windowMs) {
      for (const [key, w] of windows) if (now >= w.resetAt) windows.delete(key);
      lastSweep = now;
    }

    const win = windows.get(ip);
    if (!win || now >= win.resetAt) {
      windows.set(ip, { count: 1, resetAt: now + cfg.windowMs });
      return { allowed: true };
    }
    if (win.count >= cfg.limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((win.resetAt - now) / 1000)) };
    }
    win.count += 1;
    return { allowed: true };
  };
}
