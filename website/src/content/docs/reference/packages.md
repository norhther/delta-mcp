---
title: Package Reference
description: API reference for @delta-mcp/server, @delta-mcp/client, @delta-mcp/core, and @delta-mcp/cli.
---

## `@delta-mcp/server`

Build Delta-MCP servers.

```bash
npm install @delta-mcp/server
```

### `DeltaServer`

```typescript
import { DeltaServer } from "@delta-mcp/server";

class MyServer extends DeltaServer {
  constructor() {
    super({
      name: "my-server",
      version: "1.0.0",
      resultHandler: {
        maxTokens: 2000,     // truncate strings over ~2000 tokens
        paginateAfter: 50,   // paginate arrays over 50 items
      },
    });

    this.tool({
      name: "search",
      description: "Search docs and return top results",  // ≤60 chars
      inputSchema: { /* JSON Schema */ },
    });
  }

  protected async callTool(name: string, args: unknown): Promise<unknown> {
    // your tool logic here
  }
}

// stdio (Claude Desktop, agents)
new MyServer().startStdio();

// HTTP
new MyServer().startHttp({ port: 3000 });

// HTTP + OAuth 2.1
new MyServer().startHttp({
  port: 3000,
  oauth: {
    resourceUrl: "https://mcp.example.com",
    authorizationServers: ["https://auth.example.com"],
    verifySignature: async (token) => verify(token),
  },
});
```

### Constructor options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | required | Server name returned in `initialize` |
| `version` | `string` | required | Server version |
| `resultHandler.maxTokens` | `number` | `4000` | Token budget before string/object truncation |
| `resultHandler.paginateAfter` | `number` | `100` | Array length threshold for pagination |

---

## `@delta-mcp/client`

Connect to Delta-MCP (and standard MCP) servers.

```bash
npm install @delta-mcp/client
```

### `DeltaClient`

```typescript
import { DeltaClient, StdioClientTransport, HttpClientTransport } from "@delta-mcp/client";

// stdio
const transport = new StdioClientTransport("node", ["server.js"]);

// HTTP
const transport = new HttpClientTransport("http://localhost:3000");

// HTTP + auth
const transport = new HttpClientTransport("http://localhost:3000", {
  headers: { Authorization: `Bearer ${token}` },
});

const client = new DeltaClient(transport);
await client.initialize({ name: "my-client", version: "1.0.0" });

// Progressive disclosure: names + descriptions only
const tools = await client.listTools();

// On-demand schema (cached after first fetch)
const schema = await client.describeTool("search");

// Call a tool (fetches schema if needed)
const result = await client.callTool("search", { query: "hello" });

// Session info
console.log(client.sessionInfo.progressiveDisclosure);  // true/false
console.log(client.sessionInfo.encoding);               // "compact-json" | "json"

transport.close();
```

### `StdioClientTransport`

```typescript
new StdioClientTransport(command: string, args?: string[])
```

Spawns `command` as a child process. Uses newline-delimited JSON-RPC over stdin/stdout.

### `HttpClientTransport`

```typescript
new HttpClientTransport(url: string, options?: { headers?: Record<string, string> })
```

Connects to a Streamable HTTP MCP server. Supports OAuth via `Authorization` header.

---

## `@delta-mcp/core`

Low-level protocol types, transport primitives, and result handler utilities. Consumed by `server` and `client` — you rarely import this directly.

```bash
npm install @delta-mcp/core
```

### Result handler utilities

```typescript
import { handleToolResult, detectAndHandleRateLimit } from "@delta-mcp/core";

// Apply truncation + pagination to a result
const handled = handleToolResult(rawResult, { maxTokens: 2000, paginateAfter: 50 });

// Convert a 429 error into a structured result
const safe = detectAndHandleRateLimit(error, "tool_name");
```

### Benchmark utilities

```typescript
import { benchmarkToolDiscovery, formatBenchmark, estimateTokens } from "@delta-mcp/core/benchmark";

const schemas = [...]; // array of full tool schemas
const result = benchmarkToolDiscovery(schemas);
console.log(formatBenchmark([result]));
```

---

## `@delta-mcp/cli`

CLI for inspecting and benchmarking servers. See [CLI Reference](/delta-mcp/reference/cli/).

```bash
npm install -g @delta-mcp/cli
```
