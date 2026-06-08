import type {
  ToolSummary,
  ToolDefinition,
  ServerCapabilities,
  ClientCapabilities,
} from "@delta-mcp/core";
import { MCP2_PROTOCOL_VERSION } from "@delta-mcp/core";
import type { StdioClientTransport, HttpClientTransport } from "./transport.js";

export type Transport = Pick<StdioClientTransport | HttpClientTransport, "send"> & {
  notify?: (method: string, params?: unknown) => void;
};

export interface SessionInfo {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  capabilities: ServerCapabilities;
  progressiveDisclosure: boolean;
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
export class MCP2Client {
  private session?: SessionInfo;
  private schemaCache = new Map<string, ToolDefinition>();

  constructor(private transport: Transport) {}

  async initialize(clientInfo: { name: string; version: string } = { name: "delta-mcp-client", version: "0.1.0" }): Promise<SessionInfo> {
    const caps: ClientCapabilities = {
      encoding: { compactJson: true },
      codeExecution: true,
    };

    const clientCaps = {
      tools: { progressiveDisclosure: true, lazyLoading: true },
      ...caps,
    };

    const res = await this.transport.send("initialize", {
      protocolVersion: MCP2_PROTOCOL_VERSION,
      clientInfo,
      capabilities: clientCaps,
    });

    if (res.error) throw new Error(`Initialize failed: ${res.error.message}`);

    const result = res.result as {
      serverInfo: { name: string; version: string };
      protocolVersion: string;
      capabilities: ServerCapabilities;
    };

    this.session = {
      serverName: result.serverInfo.name,
      serverVersion: result.serverInfo.version,
      protocolVersion: result.protocolVersion,
      capabilities: result.capabilities,
      progressiveDisclosure: !!result.capabilities.tools?.progressiveDisclosure,
    };

    // Send initialized notification
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

    const content = (res.result as { content: Array<{ type: string; text: string }> }).content;
    const text = content.find((c) => c.type === "text")?.text;
    return text ? JSON.parse(text) : res.result;
  }

  clearSchemaCache(): void {
    this.schemaCache.clear();
  }
}
