import { createServer, type Server } from "http";
import {
  ProgressiveToolRegistry,
  StdioTransport,
  createHttpHandler,
  handleToolResult,
  detectAndHandleRateLimit,
  negotiate,
  isDeltaVersionCompatible,
  DELTA_PROTOCOL_VERSION,
  MCP_BASELINE_VERSION,
  ErrorCodes,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ServerCapabilities,
  type ToolDefinition,
  type ResultHandlerOptions,
  type EncodingFormat,
  type HttpHandlerOptions,
} from "@delta-mcp/core";

export interface DeltaServerOptions {
  name: string;
  version: string;
  capabilities?: ServerCapabilities;
  transport?: "stdio" | "http";
  /** Default result handler options applied to every tool call */
  resultHandler?: ResultHandlerOptions;
}

/**
 * MCP2 server — implements the full JSON-RPC 2.0 handshake with progressive
 * disclosure extension. Drop-in replacement for standard MCP servers;
 * falls back gracefully for clients that don't negotiate MCP2 capabilities.
 */
interface SessionState {
  progressiveDisclosure: boolean;
}

/** stdio carries exactly one client per process — a fixed session id suffices. */
const STDIO_SESSION_ID = "stdio";

/**
 * Cap on tracked HTTP sessions. The Map evicts oldest-first (insertion order)
 * so an initialize flood cannot grow memory unboundedly; an evicted session
 * degrades to standard-MCP behavior, it does not break.
 */
const MAX_SESSIONS = 1024;

export abstract class DeltaServer {
  private registry = new ProgressiveToolRegistry();
  /**
   * Per-session negotiation state, keyed by Mcp-Session-Id (HTTP) or the fixed
   * stdio id. One server instance serves many HTTP clients concurrently —
   * a standard client initializing must not flip a delta client's mode.
   */
  private sessions = new Map<string, SessionState>();
  private transport?: StdioTransport;

  constructor(private opts: DeltaServerOptions) {}

  tool(definition: ToolDefinition): this {
    this.registry.register(definition);
    return this;
  }

  private capabilities(): ServerCapabilities {
    return {
      tools: {
        progressiveDisclosure: true,
        lazyLoading: true,
      },
      // schemaHashReferencing deliberately not advertised: the registry
      // computes hashes, but no wire message consumes them yet. Capability
      // advertisement is a contract — only advertise what is implemented.
      encoding: {
        compactJson: true,
      },
      ...this.opts.capabilities,
    };
  }

  private async handle(msg: JsonRpcRequest, sessionId?: string): Promise<JsonRpcResponse | null> {
    const id = (msg as any).id ?? null;

    // JSON-RPC 2.0: a request without `id` is a notification — it MUST NOT
    // receive a response, not even an error. Process it, then drop the reply.
    const isNotification = (msg as any).id === undefined;
    const response = await this.dispatch(msg, id, sessionId);
    return isNotification ? null : response;
  }

  private async dispatch(
    msg: JsonRpcRequest,
    id: JsonRpcId,
    sessionId?: string
  ): Promise<JsonRpcResponse | null> {
    switch (msg.method) {
      case "initialize":
        return this.handleInitialize(msg, id, sessionId);
      case "notifications/initialized":
        return null; // one-way notification
      case "tools/list":
        return this.handleToolsList(id, sessionId);
      case "tools/describe":
        return this.handleToolsDescribe(msg, id);
      case "tools/call":
        return this.handleToolsCall(msg, id);
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: ErrorCodes.METHOD_NOT_FOUND, message: `Unknown method: ${msg.method}` },
        };
    }
  }

  /** Record (or replace) a session's negotiated state, evicting oldest at the cap. */
  private setSession(sessionId: string | undefined, state: SessionState): void {
    if (!sessionId) return;
    this.sessions.delete(sessionId); // re-insert to refresh eviction order
    this.sessions.set(sessionId, state);
    if (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
  }

  private handleInitialize(msg: JsonRpcRequest, id: unknown, sessionId?: string): JsonRpcResponse {
    const params = msg.params as any;
    const clientCaps = params?.capabilities ?? {};
    const clientVersion: unknown = params?.protocolVersion;

    // A delta-aware client sends "delta-mcp/x.y.z". Anything else (MCP date
    // versions like "2025-11-25", absent field) is a standard MCP client —
    // respond with the baseline version so the official SDK doesn't reject us.
    const isClientDelta =
      typeof clientVersion === "string" && clientVersion.startsWith("delta-mcp/");

    if (!isClientDelta || !isDeltaVersionCompatible(clientVersion)) {
      this.setSession(sessionId, { progressiveDisclosure: false });
      return {
        jsonrpc: "2.0",
        id: id as any,
        result: {
          protocolVersion: MCP_BASELINE_VERSION,
          serverInfo: { name: this.opts.name, version: this.opts.version },
          capabilities: {},
        },
      };
    }

    // Detect if client supports progressive disclosure
    this.setSession(sessionId, {
      progressiveDisclosure: !!clientCaps?.tools?.progressiveDisclosure,
    });

    // Negotiate wire encoding from both sides' capabilities.
    const serverEnc = this.capabilities().encoding ?? {};
    const { format } = negotiate(
      {
        compactJson: serverEnc.compactJson,
        cbor: serverEnc.cbor,
        schemaHashReferencing: serverEnc.schemaHashReferencing,
      },
      { compactJson: clientCaps?.encoding?.compactJson, cbor: clientCaps?.encoding?.cbor }
    );

    // Switch the stdio codec *after* this (plain-JSON) response is sent, so the
    // client can still decode the handshake. The negotiated format is echoed in
    // the result so the client switches to the same codec. Guarded to the stdio
    // session: a server running stdio + HTTP simultaneously must not let an
    // HTTP client's handshake re-encode the stdio stream under its client.
    if (this.transport && sessionId === STDIO_SESSION_ID) {
      this.transport.scheduleEncoding(format);
    }

    return {
      jsonrpc: "2.0",
      id: id as any,
      result: {
        protocolVersion: DELTA_PROTOCOL_VERSION,
        baselineVersion: MCP_BASELINE_VERSION,
        serverInfo: { name: this.opts.name, version: this.opts.version },
        capabilities: this.capabilities(),
        encoding: { format } as { format: EncodingFormat },
      },
    };
  }

  private handleToolsList(id: unknown, sessionId?: string): JsonRpcResponse {
    // Unknown or evicted session → standard mode. Full schemas are the safe
    // default: every MCP client can consume them.
    const progressive = sessionId
      ? this.sessions.get(sessionId)?.progressiveDisclosure ?? false
      : false;
    const tools = progressive
      ? this.registry.listSummaries() // short descriptions only — the token savings
      : this.registry.listFull();     // standard clients get full schemas (MCP baseline compat)

    return {
      jsonrpc: "2.0",
      id: id as any,
      result: { tools },
    };
  }

  private handleToolsDescribe(msg: JsonRpcRequest, id: unknown): JsonRpcResponse {
    const { name } = (msg.params as any) ?? {};
    const tool = this.registry.describe(name);

    if (!tool) {
      return {
        jsonrpc: "2.0",
        id: id as any,
        error: { code: ErrorCodes.INVALID_PARAMS, message: `Unknown tool: ${name}` },
      };
    }

    return { jsonrpc: "2.0", id: id as any, result: tool };
  }

  private async handleToolsCall(msg: JsonRpcRequest, id: unknown): Promise<JsonRpcResponse> {
    const { name, arguments: args } = (msg.params as any) ?? {};

    if (!this.registry.has(name)) {
      return {
        jsonrpc: "2.0",
        id: id as any,
        error: { code: ErrorCodes.INVALID_PARAMS, message: `Unknown tool: ${name}` },
      };
    }

    // Tool execution delegated to registered handler
    // Result passes through summarizer before hitting LLM context
    try {
      // Models routinely omit `arguments` for zero-param tools — hand the tool
      // an empty object so `args.foo` is undefined, not a TypeError.
      const callArgs = (args ?? {}) as Record<string, unknown>;
      const rawResult = await this.callTool(name, callArgs);

      // Merge per-call pagination params from tool args into result handler
      // opts. Non-numeric junk becomes NaN here; handleToolResult sanitizes.
      const resultOpts: ResultHandlerOptions = {
        ...this.opts.resultHandler,
        ...(callArgs["page"] !== undefined && { page: Number(callArgs["page"]) }),
        ...(callArgs["pageSize"] !== undefined && { pageSize: Number(callArgs["pageSize"]) }),
      };

      const result = handleToolResult(rawResult, resultOpts);
      return { jsonrpc: "2.0", id: id as any, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
    } catch (err: unknown) {
      // Rate limit from upstream — convert to reasoner-friendly result, not a crash
      const rl = detectAndHandleRateLimit(err, name);
      if (rl) {
        return {
          jsonrpc: "2.0",
          id: id as any,
          result: { content: [{ type: "text", text: JSON.stringify(rl) }] },
        };
      }
      const message = err instanceof Error ? err.message : "Tool execution failed";
      return {
        jsonrpc: "2.0",
        id: id as any,
        error: { code: ErrorCodes.INTERNAL_ERROR, message },
      };
    }
  }

  protected abstract callTool(name: string, args: unknown): Promise<unknown>;

  startStdio(): void {
    this.transport = new StdioTransport((msg) => this.handle(msg, STDIO_SESSION_ID));
    this.transport.start();
  }

  /**
   * Serve over Streamable HTTP. Pass `oauth` to run as a full OAuth 2.1
   * resource server (PRM discovery + token validation); omit it for the
   * presence-only dev check. Returns the Node http.Server for lifecycle control.
   *
   * Codec negotiation is per-request over HTTP (Content-Type / Accept), so no
   * stdio-style scheduled switch is needed.
   */
  startHttp(opts: { port?: number; host?: string } & HttpHandlerOptions = {}): Server {
    const { port = 3000, host = "127.0.0.1", ...httpOpts } = opts;
    const handler = createHttpHandler((msg, _req, sessionId) => this.handle(msg, sessionId), httpOpts);
    const server = createServer((req, res) => void handler(req, res));
    server.listen(port, host);
    return server;
  }
}
