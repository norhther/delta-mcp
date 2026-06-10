/**
 * Pagination demo server — 1 000 user records, paginateAfter: 20.
 * Started as a child process by index.ts.
 */
import { DeltaServer } from "@delta-mcp/server";

const RECORDS = Array.from({ length: 1_000 }, (_, i) => ({
  id:       i + 1,
  username: `user_${String(i + 1).padStart(4, "0")}`,
  email:    `user${i + 1}@example.com`,
  score:    Math.round(Math.random() * 1_000),
  active:   i % 3 !== 0,
}));

class PaginationDemoServer extends DeltaServer {
  constructor() {
    super({
      name: "pagination-demo",
      version: "1.0.0",
      resultHandler: { paginateAfter: 20, maxTokens: 2000 },
    });

    this.tool({
      name: "list_users",
      description: "List users. Supports page/pageSize params.", // ≤60 chars
      inputSchema: {
        type: "object",
        properties: {
          page:       { type: "number", default: 1 },
          pageSize:   { type: "number", default: 20 },
          activeOnly: { type: "boolean" },
        },
      },
    });

    this.tool({
      name: "search_users",
      description: "Search users by username prefix.", // ≤60 chars
      inputSchema: {
        type: "object",
        properties: {
          prefix:   { type: "string" },
          page:     { type: "number", default: 1 },
          pageSize: { type: "number", default: 20 },
        },
        required: ["prefix"],
      },
    });
  }

  async callTool(name, args) {
    if (name === "list_users") {
      return args.activeOnly ? RECORDS.filter((r) => r.active) : RECORDS;
    }
    if (name === "search_users") {
      const prefix = String(args.prefix).toLowerCase();
      return RECORDS.filter((r) => r.username.startsWith(prefix));
    }
    throw new Error(`Unknown tool: ${name}`);
  }
}

new PaginationDemoServer().startStdio();
