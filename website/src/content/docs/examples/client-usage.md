---
title: Client Usage
description: Connect to a Delta-MCP server with DeltaClient — progressive disclosure, on-demand schema fetch, tool calls.
---

Shows how to connect to a Delta-MCP server programmatically using `DeltaClient`.

## What it demonstrates

1. **Connecting** — spawn a server as a child process via `StdioClientTransport`
2. **Progressive disclosure** — `listTools()` returns names + short descriptions only (~97 tokens for 5 tools)
3. **On-demand schema fetch** — `describeTool(name)` fetches the full JSON schema and caches it
4. **Calling tools** — `callTool(name, args)` handles schema fetch + call in one step

## Run

```bash
npx tsx examples/client-usage/index.ts
```

## Key API

```typescript
import { DeltaClient, StdioClientTransport } from "@delta-mcp/client";

const transport = new StdioClientTransport("node", ["./server.js"]);
const client = new DeltaClient(transport);

await client.initialize({ name: "my-client", version: "1.0.0" });

const tools = await client.listTools();              // names + descriptions only
const schema = await client.describeTool("search");  // full schema, cached
const result = await client.callTool("search", { query: "hello" });

transport.close();
```

For HTTP servers, swap `StdioClientTransport` for `HttpClientTransport`:

```typescript
import { HttpClientTransport } from "@delta-mcp/client";

const transport = new HttpClientTransport("http://localhost:3000");
```

[View on GitHub →](https://github.com/norhther/delta-mcp/tree/main/examples/client-usage/)

## Next

See [stdio-server](/delta-mcp/examples/stdio-server/) for the server side of this connection, or [result-handler](/delta-mcp/examples/result-handler/) to understand what happens to large outputs.
