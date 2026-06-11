#!/usr/bin/env node
/**
 * Standalone demo server — used by integration tests and conformance suite.
 * Schemas are realistic (property descriptions, enums, nested objects) to
 * produce representative token benchmark numbers.
 */
import { DeltaServer } from "./index.js";

class DemoServer extends DeltaServer {
  constructor() {
    super({
      name: "delta-mcp-demo",
      version: "0.1.0",
      resultHandler: { maxTokens: 500, paginateAfter: 50 },
    });

    this.tool({
      name: "search",
      description: "Search docs and return top results",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Full-text search query string. Supports boolean operators AND, OR, NOT and quoted phrases.",
          },
          limit: {
            type: "number",
            default: 10,
            description: "Maximum number of results to return. Range 1-100.",
          },
          page: {
            type: "number",
            default: 1,
            description: "Page number for pagination, 1-indexed.",
          },
          filters: {
            type: "object",
            description: "Optional filters to narrow results.",
            properties: {
              dateRange: {
                type: "string",
                enum: ["day", "week", "month", "year", "all"],
                description: "Restrict results to documents updated within this range.",
              },
              language: {
                type: "string",
                description: "ISO 639-1 language code, e.g. 'en', 'de', 'fr'.",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Return only documents matching all listed tags.",
              },
            },
          },
        },
        required: ["query"],
      },
    });

    this.tool({
      name: "read_file",
      description: "Read file contents from the workspace",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or workspace-relative path to the file. Symlinks are followed.",
          },
          encoding: {
            type: "string",
            enum: ["utf8", "base64", "hex"],
            default: "utf8",
            description: "Character encoding for the returned content string.",
          },
          startLine: {
            type: "number",
            description: "1-indexed line to start reading from. Omit to read from the beginning.",
          },
          endLine: {
            type: "number",
            description: "1-indexed line to stop reading at (inclusive). Omit to read to EOF.",
          },
        },
        required: ["path"],
      },
    });

    this.tool({
      name: "write_file",
      description: "Write content to a file in workspace",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Destination path. Parent directories must exist unless createDirs is true.",
          },
          content: {
            type: "string",
            description: "File content to write. Existing file is overwritten atomically.",
          },
          encoding: {
            type: "string",
            enum: ["utf8", "base64"],
            default: "utf8",
            description: "Encoding of the content string.",
          },
          createDirs: {
            type: "boolean",
            default: false,
            description: "Create missing parent directories before writing.",
          },
          mode: {
            type: "number",
            description: "Unix file permission bits (octal), e.g. 0o644. Defaults to 0o644.",
          },
        },
        required: ["path", "content"],
      },
    });

    this.tool({
      name: "list_dir",
      description: "List directory contents at given path",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            default: ".",
            description: "Directory path to list. Defaults to workspace root.",
          },
          recursive: {
            type: "boolean",
            default: false,
            description: "Recursively list subdirectories. Can produce large output on deep trees.",
          },
          include: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns for files to include, e.g. ['**/*.ts', '**/*.json'].",
          },
          exclude: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns for files to exclude, e.g. ['**/node_modules/**'].",
          },
        },
      },
    });

    this.tool({
      name: "fail",
      description: "Always throws — exercises isError execution results",
      inputSchema: { type: "object", properties: {} },
    });

    this.tool({
      name: "run_command",
      description: "Execute shell command in workspace sandbox",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to execute. Runs in /bin/sh. Avoid interactive commands.",
          },
          cwd: {
            type: "string",
            description: "Working directory for the command. Defaults to workspace root.",
          },
          timeout: {
            type: "number",
            default: 30000,
            description: "Timeout in milliseconds. Command is killed after this duration.",
          },
          env: {
            type: "object",
            description: "Additional environment variables merged with the default sandbox env.",
            additionalProperties: { type: "string" },
          },
          stdin: {
            type: "string",
            description: "Optional string to pipe to the command's stdin.",
          },
        },
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
          { title: "Token Efficiency in Agentic Systems", url: "https://arxiv.org/token-efficiency", score: 0.84 },
        ].slice(0, (args["limit"] as number) ?? 10);

      case "read_file":
        return `Stub content of ${args["path"]}`;

      case "write_file":
        return { written: true, path: args["path"], bytes: (args["content"] as string).length };

      case "list_dir":
        return ["src/", "dist/", "package.json", "tsconfig.json", "README.md"];

      case "run_command":
        return { stdout: `Stub output for: ${args["command"]}`, stderr: "", exitCode: 0 };

      case "fail":
        throw new Error("intentional demo failure");

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new DemoServer().startStdio();
