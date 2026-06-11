import type {
  ToolSummary,
  ToolDefinition,
  ServerCapabilities,
  ClientCapabilities,
  EncodingFormat,
} from "@delta-mcp/core";
import { DELTA_PROTOCOL_VERSION, negotiate } from "@delta-mcp/core";
import type { StdioClientTransport, HttpClientTransport } from "./transport.js";

export type Transport = Pick<StdioClientTransport | HttpClientTransport, "send"> & {
  notify?: (method: string, params?: unknown) => void;
  setEncoding?: (format: EncodingFormat) => void;
  onNotification?: (handler: (method: string, params: unknown) => void) => void;
};

export interface SessionInfo {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  capabilities: ServerCapabilities;
  progressiveDisclosure: boolean;
  /** Negotiated wire encoding in effect after the handshake. */
  encoding: EncodingFormat;
}

/**
 * MCP2 client — auto-detects progressive disclosure at initialize.
 *
 * Progressive mode (server supports it):
 *   listTools() → names + 60-char descriptions only (~600 tokens)
 *   describetool(name) → full schema on demand
 *
 * Standard mode (legacy server):
 *   listTools() → full schemas (standard MCP behavior)
 */
export class DeltaClient {
  private session?: SessionInfo;
  private schemaCache = new Map<string, ToolDefinition>();

  constructor(private transport: Transport) {
    // Cached schemas go stale the moment the server's tool set changes.
    transport.onNotification?.((method) => {
      if (method === "notifications/tools/list_changed") this.schemaCache.clear();
    });
  }

  async initialize(clientInfo: { name: string; version: string } = { name: "delta-mcp-client", version: "0.2.0" }): Promise<SessionInfo> {
    // codeExecution deliberately not advertised — no sandbox implementation
    // exists yet. Only advertise capabilities the client can actually honor.
    const caps: ClientCapabilities = {
      encoding: { compactJson: true },
    };

    const clientCaps = {
      tools: { progressiveDisclosure: true, lazyLoading: true },
      ...caps,
    };

    const res = await this.transport.send("initialize", {
      protocolVersion: DELTA_PROTOCOL_VERSION,
      clientInfo,
      capabilities: clientCaps,
    });

    if (res.error) throw new Error(`Initialize failed: ${res.error.message}`);

    const result = res.result as {
      serverInfo: { name: string; version: string };
      protocolVersion: string;
      capabilities: ServerCapabilities;
      encoding?: { format: EncodingFormat };
    };

    // Resolve the negotiated wire encoding. Prefer the format the server echoed;
    // otherwise recompute it from both capability sets.
    const format =
      result.encoding?.format ??
      negotiate(
        {
          compactJson: result.capabilities.encoding?.compactJson,
          cbor: result.capabilities.encoding?.cbor,
        },
        { compactJson: caps.encoding?.compactJson, cbor: caps.encoding?.cbor }
      ).format;

    this.session = {
      serverName: result.serverInfo.name,
      serverVersion: result.serverInfo.version,
      protocolVersion: result.protocolVersion,
      capabilities: result.capabilities,
      progressiveDisclosure: !!result.capabilities.tools?.progressiveDisclosure,
      encoding: format,
    };

    // Switch the transport to the agreed codec *before* the initialized
    // notification so that message already goes out in the negotiated encoding.
    this.transport.setEncoding?.(format);
    this.transport.notify?.("notifications/initialized");

    return this.session;
  }

  get sessionInfo(): SessionInfo {
    if (!this.session) throw new Error("Not initialized — call initialize() first");
    return this.session;
  }

  /** List tools. Progressive mode: names+descriptions. Standard mode: full schemas. */
  async listTools(): Promise<ToolSummary[]> {
    const res = await this.transport.send("tools/list");
    if (res.error) throw new Error(`tools/list failed: ${res.error.message}`);
    return (res.result as { tools: ToolSummary[] }).tools;
  }

  /**
   * Fetch full schema for a tool on demand.
   * Cached — subsequent calls return cached schema without a round-trip.
   */
  async describeTool(name: string): Promise<ToolDefinition> {
    const cached = this.schemaCache.get(name);
    if (cached) return cached;

    const res = await this.transport.send("tools/describe", { name });
    if (res.error) throw new Error(`tools/describe failed: ${res.error.message}`);

    const tool = res.result as ToolDefinition;
    this.schemaCache.set(name, tool);
    return tool;
  }

  /** Call a tool. Fetches schema first if in progressive mode and not cached. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.session?.progressiveDisclosure && !this.schemaCache.has(name)) {
      await this.describeTool(name).catch(() => {
        // If describe fails, proceed anyway — server validates args
      });
    }

    const res = await this.transport.send("tools/call", { name, arguments: args });
    if (res.error) throw new Error(`tools/call failed: ${res.error.message}`);

    const result = res.result as {
      content?: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    const content = result.content;
    const text = content?.find((c) => c.type === "text")?.text;

    // MCP execution error (tool threw server-side). Surface as a throw so
    // callers keep one failure path for both protocol and execution errors.
    if (result.isError) {
      throw new Error(`tools/call failed: ${text ?? "tool execution error"}`);
    }
    if (text === undefined) return res.result;
    // Our own server JSON-stringifies structured results, but a standard MCP
    // server may return plain text — fall back to the raw string if not JSON.
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  clearSchemaCache(): void {
    this.schemaCache.clear();
  }
}
