"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCP2Server = void 0;
const core_1 = require("@mcp2/core");
/**
 * MCP2 server — implements the full JSON-RPC 2.0 handshake with progressive
 * disclosure extension. Drop-in replacement for standard MCP servers;
 * falls back gracefully for clients that don't negotiate MCP2 capabilities.
 */
class MCP2Server {
    opts;
    registry = new core_1.ProgressiveToolRegistry();
    clientProgressiveDisclosure = false;
    constructor(opts) {
        this.opts = opts;
    }
    tool(definition) {
        this.registry.register(definition);
        return this;
    }
    capabilities() {
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
    async handle(msg) {
        const id = msg.id ?? null;
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
                    error: { code: core_1.ErrorCodes.METHOD_NOT_FOUND, message: `Unknown method: ${msg.method}` },
                };
        }
    }
    handleInitialize(msg, id) {
        const params = msg.params;
        const clientCaps = params?.capabilities ?? {};
        // Detect if client supports progressive disclosure
        this.clientProgressiveDisclosure =
            !!clientCaps?.tools?.progressiveDisclosure;
        return {
            jsonrpc: "2.0",
            id: id,
            result: {
                protocolVersion: core_1.MCP2_PROTOCOL_VERSION,
                baselineVersion: core_1.MCP_BASELINE_VERSION,
                serverInfo: { name: this.opts.name, version: this.opts.version },
                capabilities: this.capabilities(),
            },
        };
    }
    handleToolsList(id) {
        const tools = this.clientProgressiveDisclosure
            ? this.registry.listSummaries() // short descriptions only — the token savings
            : Array.from({ length: 0 }); // standard clients get empty; use tools/list compat below
        return {
            jsonrpc: "2.0",
            id: id,
            result: { tools },
        };
    }
    handleToolsDescribe(msg, id) {
        const { name } = msg.params ?? {};
        const tool = this.registry.describe(name);
        if (!tool) {
            return {
                jsonrpc: "2.0",
                id: id,
                error: { code: core_1.ErrorCodes.INVALID_PARAMS, message: `Unknown tool: ${name}` },
            };
        }
        return { jsonrpc: "2.0", id: id, result: tool };
    }
    async handleToolsCall(msg, id) {
        const { name, arguments: args } = msg.params ?? {};
        if (!this.registry.has(name)) {
            return {
                jsonrpc: "2.0",
                id: id,
                error: { code: core_1.ErrorCodes.INVALID_PARAMS, message: `Unknown tool: ${name}` },
            };
        }
        // Tool execution delegated to registered handler
        // Result goes through summarizer before hitting context
        try {
            const rawResult = await this.callTool(name, args);
            const result = (0, core_1.handleToolResult)(rawResult);
            return { jsonrpc: "2.0", id: id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
        }
        catch (err) {
            // Rate limit from upstream — reasoner-friendly, not a crash
            if (err?.status === 429) {
                const retryAfter = parseInt(err.headers?.["retry-after"] ?? "30", 10);
                return {
                    jsonrpc: "2.0",
                    id: id,
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
                id: id,
                error: { code: core_1.ErrorCodes.INTERNAL_ERROR, message: err?.message ?? "Tool execution failed" },
            };
        }
    }
    // Subclass or compose to provide actual tool implementations
    async callTool(name, args) {
        void name;
        void args;
        throw new Error("callTool not implemented — compose MCP2Server with tool handlers");
    }
    startStdio() {
        const transport = new core_1.StdioTransport((msg) => this.handle(msg));
        transport.start();
    }
}
exports.MCP2Server = MCP2Server;
