---
title: Getting Started
description: Install Delta-MCP and build your first server in under 5 minutes.
---

## Installation

```bash
npm install @delta-mcp/server @delta-mcp/client
```

## Your first server

```typescript
import { DeltaServer } from "@delta-mcp/server";

class MyServer extends DeltaServer {
  constructor() {
    super({ name: "my-server", version: "1.0.0" });

    this.tool({
      name: "search",
      description: "Search docs and return top results", // ≤60 chars, enforced
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          page:  { type: "number" },
        },
        required: ["query"],
      },
    });
  }

  protected async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "search") return performSearch(args.query as string);
    throw new Error(`Unknown tool: ${name}`);
  }
}

new MyServer().startStdio();
```

## Connect a client

```typescript
import { DeltaClient, StdioClientTransport } from "@delta-mcp/client";

const transport = new StdioClientTransport("node", ["./server.js"]);
const client = new DeltaClient(transport);

await client.initialize({ name: "my-client", version: "1.0.0" });

const tools = await client.listTools();            // names + 60-char descriptions only
const schema = await client.describeTool("search"); // full schema, fetched on demand
const result = await client.callTool("search", { query: "delta mcp" });

transport.close();
```

## CLI

```bash
npx @delta-mcp/cli list     node ./server.js                         # list tools
npx @delta-mcp/cli describe node ./server.js search                  # full schema
npx @delta-mcp/cli call     node ./server.js search '{"query":"x"}'  # call tool
npx @delta-mcp/cli bench    node ./server.js                         # benchmark
```

## Next steps

- [How progressive disclosure works](/delta-mcp/how-it-works/progressive-disclosure/)
- [Handling large results](/delta-mcp/how-it-works/result-handler/)
- [Example: filesystem server](/delta-mcp/examples/filesystem-server/)
- [Example: pagination](/delta-mcp/examples/pagination/)
