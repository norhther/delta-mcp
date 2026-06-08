import { MCP2Server } from "@delta-mcp/server";

class DemoServer extends MCP2Server {
  constructor() {
    super({ name: "delta-mcp-demo", version: "0.1.0" });

    this.tool({
      name: "search",
      description: "Search docs and return top results", // ≤60 chars
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
      description: "Read file contents from the workspace", // ≤60 chars
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    });
  }

  protected async callTool(name: string, args: any): Promise<unknown> {
    switch (name) {
      case "search":
        return [
          { title: "Result 1", url: "https://example.com/1", score: 0.95 },
          { title: "Result 2", url: "https://example.com/2", score: 0.87 },
        ].slice(0, args.limit ?? 10);

      case "read_file":
        return `Contents of ${args.path} (stub)`;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new DemoServer().startStdio();
