import { type ServerCapabilities, type ToolDefinition } from "@mcp2/core";
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
export declare class MCP2Server {
    private opts;
    private registry;
    private clientProgressiveDisclosure;
    constructor(opts: MCP2ServerOptions);
    tool(definition: ToolDefinition): this;
    private capabilities;
    private handle;
    private handleInitialize;
    private handleToolsList;
    private handleToolsDescribe;
    private handleToolsCall;
    protected callTool(name: string, args: unknown): Promise<unknown>;
    startStdio(): void;
}
