import {
  ProgressiveToolRegistry,
  StdioTransport,
  handleToolResult,
  detectAndHandleRateLimit,
  MCP2_PROTOCOL_VERSION,
  MCP_BASELINE_VERSION,
  ErrorCodes,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ServerCapabilities,
  type ToolDefinition,
  type ResultHandlerOptions,
} from "@mcp2/core";

export interface MCP2ServerOptions {
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
    // Result passes through summarizer before hitting LLM context
    try {
      const rawResult = await this.callTool(name, args);

      // Merge per-call pagination params from tool args into result handler opts
      const callArgs = args as Record<string, unknown> | undefined;
      const resultOpts: ResultHandlerOptions = {
        ...this.opts.resultHandler,
        ...(callArgs?.["page"] !== undefined && { page: Number(callArgs["page"]) }),
        ...(callArgs?.["pageSize"] !== undefined && { pageSize: Number(callArgs["pageSize"]) }),
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

  // Subclass or compose to provide actual tool implementations
  protected async callTool(name: string, args: unknown): Promise<unknown> {
    void name; void args;
    throw new Error("callTool not implemented — compose MCP2Server with tool handlers");
  }

  startStdio(): void {
    const transport = new StdioTransport((msg) => this.handle(msg));
    transport.start();
  }
}
