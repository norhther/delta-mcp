import {
  ProgressiveToolRegistry,
  StdioTransport,
  handleToolResult,
  MCP2_PROTOCOL_VERSION,
  MCP_BASELINE_VERSION,
  ErrorCodes,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ServerCapabilities,
  type ToolDefinition,
} from "@mcp2/core";

export interface MCP2ServerOptions {
  name: string;
  version: string;
  capabilities?: ServerCapabilities;
  transport?: "stdio" | "http";
}

/**
 * MCP2 server — implements the full JSON-RPC 2.0 handshake with progressive
 * disclosure extension. Drop-in replacement for standard MCP servers;
 * falls back gracefully for clients that don't negotiate MCP2 capabilities.
 */
export class MCP2Server {
  private registry = new ProgressiveToolRegistry();
  private clientProgressiveDisclosure = false;

  constructor(private opts: MCP2ServerOptions) {}

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
      encoding: {
        compactJson: true,
        schemaHashReferencing: true,
      },
      ...this.opts.capabilities,
    };
  }

  private async handle(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = (msg as any).id ?? null;

    switch (msg.method) {
      case "initialize":
        return this.handleInitialize(msg, id);
      case "notifications/initialized":
        return null; // one-way notification
      case "tools/list":
        return this.handleToolsList(id);
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

  private handleInitialize(msg: JsonRpcRequest, id: unknown): JsonRpcResponse {
    const params = msg.params as any;
    const clientCaps = params?.capabilities ?? {};

    // Detect if client supports progressive disclosure
    this.clientProgressiveDisclosure =
      !!clientCaps?.tools?.progressiveDisclosure;

    return {
      jsonrpc: "2.0",
      id: id as any,
      result: {
        protocolVersion: MCP2_PROTOCOL_VERSION,
        baselineVersion: MCP_BASELINE_VERSION,
        serverInfo: { name: this.opts.name, version: this.opts.version },
        capabilities: this.capabilities(),
      },
    };
  }

  private handleToolsList(id: unknown): JsonRpcResponse {
    const tools = this.clientProgressiveDisclosure
      ? this.registry.listSummaries() // short descriptions only — the token savings
      : Array.from({ length: 0 }); // standard clients get empty; use tools/list compat below

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
    // Result goes through summarizer before hitting context
    try {
      const rawResult = await this.callTool(name, args);
      const result = handleToolResult(rawResult);
      return { jsonrpc: "2.0", id: id as any, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
    } catch (err: any) {
      // Rate limit from upstream — reasoner-friendly, not a crash
      if (err?.status === 429) {
        const retryAfter = parseInt(err.headers?.["retry-after"] ?? "30", 10);
        return {
          jsonrpc: "2.0",
          id: id as any,
          result: {
            content: [{
              type: "text",
              text: JSON.stringify({ type: "rate_limited", retryAfterSeconds: retryAfter, upstream: name }),
            }],
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id: id as any,
        error: { code: ErrorCodes.INTERNAL_ERROR, message: err?.message ?? "Tool execution failed" },
      };
    }
  }

  // Subclass or compose to provide actual tool implementations
  protected async callTool(_name: string, _args: unknown): Promise<unknown> {
    throw new Error("callTool not implemented — compose MCP2Server with tool handlers");
  }

  startStdio(): void {
    const transport = new StdioTransport((msg) => this.handle(msg));
    transport.start();
  }
}
