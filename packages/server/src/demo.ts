#!/usr/bin/env node
/**
 * Standalone demo server — used by integration tests.
 * Run: node dist/demo.js
 */
import { MCP2Server } from "./index.js";

class DemoServer extends MCP2Server {
  constructor() {
    super({ name: "mcp2-demo", version: "0.1.0" });

    this.tool({
      name: "search",
      description: "Search docs and return top results",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", default: 10 },
        },
        required: ["query"],
      },
    });

    this.tool({
      name: "read_file",
      description: "Read file contents from the workspace",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    });

    this.tool({
      name: "write_file",
      description: "Write content to a file in workspace",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    });

    this.tool({
      name: "list_dir",
      description: "List directory contents at given path",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", default: "." } },
      },
    });

    this.tool({
      name: "run_command",
      description: "Execute shell command in workspace sandbox",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    });
  }

  protected async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "search":
        return [
          { title: "MCP Specification 2025-11-25", url: "https://spec.modelcontextprotocol.io", score: 0.97 },
          { title: "MCP2 Progressive Disclosure ADR", url: "https://github.com/norhther/mcp2/blob/main/docs/adr/002-progressive-disclosure.md", score: 0.91 },
          { title: "Token Efficiency Research", url: "https://arxiv.org/token-efficiency", score: 0.84 },
        ].slice(0, (args.limit as number) ?? 10);

      case "read_file":
        return `Stub content of ${args.path}`;

      case "write_file":
        return { written: true, path: args.path, bytes: (args.content as string).length };

      case "list_dir":
        return ["src/", "dist/", "package.json", "tsconfig.json"];

      case "run_command":
        return { stdout: `Stub output for: ${args.command}`, exitCode: 0 };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new DemoServer().startStdio();
