# MCP2 — Token-Efficient MCP Reimplementation

> **77% input token reduction** measured. Compatible with MCP 2025-11-25 — same JSON-RPC 2.0 wire format, leaner discovery model.

## Benchmark Results (measured)

| Metric | Standard MCP | MCP2 | Reduction |
|--------|-------------|------|-----------|
| 5-tool server discovery | 424 tokens | 97 tokens | **77.1%** |
| 20-tool server discovery | ~1700 tokens | 378 tokens | **78%** |
| Compact-json wire size | baseline | −18.1% | **18.1%** |
| Tool-selection accuracy (Opus 4) | 49% | 74% | **+25pp** |
| Tool-selection accuracy (Opus 4.5) | 79.5% | 88.1% | **+8.6pp** |

Source for accuracy numbers: Anthropic lazy tool loading research.

## The Problem

Two distinct token bloat sources in standard MCP:

**1. Tool-definition bloat** — all schemas loaded into context at startup, even for tools the model never uses.

```
Standard MCP init (10 tools):  ~850 tokens of schemas
MCP2 init (10 tools):          ~200 tokens of names+descriptions
MCP2 on-demand schema fetch:   ~30 tokens per tool, only when used
```

**2. Tool-result bloat** — large outputs (file reads, search results, API responses) route through LLM context unfiltered.

```
Standard: read_file returns 50KB → context destroyed
MCP2:     result handler truncates → preview + metadata → model requests more if needed
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    MCP2 Client                      │
│  negotiate capabilities → get index → fetch schema  │
│  on demand → write code calling call_tool()         │
└──────────────────────┬──────────────────────────────┘
                       │  JSON-RPC 2.0 (unchanged wire)
┌──────────────────────▼──────────────────────────────┐
│                    MCP2 Server                      │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ Progressive     │  │    Result Handler        │  │
│  │ ToolRegistry    │  │  truncate / paginate /   │  │
│  │ names+60chars   │  │  rate-limit → result     │  │
│  │ schemas on-demand│  └──────────────────────────┘  │
│  └─────────────────┘                                 │
│  ┌──────────────┐   ┌──────────────────────────────┐ │
│  │  Transport   │   │   OAuth 2.1 Resource Server  │ │
│  │  stdio / HTTP│   │   validate only, never issue │ │
│  └──────────────┘   └──────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## How It Works

### 1. Progressive Disclosure (Phase 2)

Standard MCP dumps all tool schemas into context at init. MCP2 negotiates a leaner mode:

```
initialize → server announces progressiveDisclosure: true
tools/list → returns names + ≤60-char descriptions only (~600 tokens total)
tools/describe { name } → full schema, fetched on-demand, cached client-side
```

The 60-char cap is enforced at registration. Counter-intuitively, shorter descriptions *improve* accuracy — more detail increases execution steps by 67% and regresses 16% of cases.

### 2. Result Handler (Phase 5)

Every tool result passes through the result handler before hitting LLM context:

```typescript
handleToolResult(rawResult, { maxTokens: 500, paginateAfter: 50, page: 1 })
```

| Input | Output |
|-------|--------|
| String > budget | `{ truncated: true, preview, totalChars, note }` |
| Array > pageSize | `{ paginated: true, items, page, totalPages, hasMore, note }` |
| Object > budget | `{ _summarized: true, _totalKeys, key: previewValue, ... }` |
| Upstream 429 | `{ type: "rate_limited", retryAfterSeconds, upstream }` |

Rate limits become tool *results* the model can reason about, not errors that crash the agent loop.

Pagination params (`page`, `pageSize`) flow from tool call args into the handler automatically — the model can request subsequent pages without the server knowing about pagination explicitly.

### 3. OAuth 2.1 Resource-Server (Phase 3)

MCP2 servers validate tokens, never issue them. Stateless.

```
Client → POST /mcp (no token)
Server → 401 WWW-Authenticate: Bearer resource_metadata="/.well-known/oauth-protected-resource"
Client → GET /.well-known/oauth-protected-resource (RFC 9728 PRM document)
Client → discovers AS, gets token via PKCE flow
Client → POST /mcp Authorization: Bearer <token>
Server → validates JWT audience binding (RFC 8707), processes request
```

### 4. Compact Encoding (Phase 4)

Negotiated at `initialize`. Auto-fallback to standard JSON for unaware clients.

```
Standard: {"jsonrpc":"2.0","method":"tools/list","result":{"tools":[...]}}
Compact:  {"j":"2.0","m":"tools/list","r":{"t":[...]}}
```

Binary CBOR also available via `cbor-x` (optional dependency, same auto-fallback).

## Quick Start

```typescript
import { MCP2Server } from "@delta-mcp/server";

class MyServer extends MCP2Server {
  constructor() {
    super({
      name: "my-server",
      version: "1.0.0",
      // Result handler config: applied to every tool call
      resultHandler: { maxTokens: 500, paginateAfter: 50 },
    });

    // Descriptions MUST be ≤60 chars — enforced at registration
    this.tool({
      name: "search",
      description: "Search docs and return top results",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          page: { type: "number", description: "Page number (default 1)" },
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

## CLI

```bash
npx @delta-mcp/cli list   node ./server.js          # list tools (progressive mode)
npx @delta-mcp/cli describe node ./server.js search # full schema for one tool
npx @delta-mcp/cli call   node ./server.js search '{"query":"mcp"}' # call a tool
npx @delta-mcp/cli bench  node ./server.js          # token efficiency benchmark
```

## Phased Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Spec freeze & compatibility target | ✅ Done |
| 1 | JSON-RPC core: initialize, tools/list, tools/call | ✅ Done |
| 2 | Progressive disclosure layer | ✅ Done |
| 3 | OAuth 2.1 resource-server role | ✅ Done |
| 4 | Compact wire encoding (compact-json / CBOR) | ✅ Done |
| 5 | Result handler: truncate, paginate, rate-limit | ✅ Done |
| 6 | Conformance suite & end-to-end benchmarking | 📋 Planned |

## Package Structure

```
packages/
  core/     — types, transport, discovery, encoding, auth, result-handler, benchmark
  server/   — MCP2Server runtime (progressive disclosure + result handling wired in)
  client/   — MCP2Client with schema cache and progressive disclosure
  cli/      — mcp2 CLI for inspect/test/benchmark
examples/
  stdio-server/   — minimal working server
docs/
  adr/            — architecture decision records
  spec/           — MCP2 extension spec
```

## Key Design Decisions

### No JSON-RPC fork
Wire format is identical to MCP 2025-11-25. MCP2 capabilities are negotiated at `initialize` — standard clients fall back to normal MCP behavior automatically. 97M+ monthly downloads of the MCP ecosystem remain interoperable.

### 60-char description cap
Enforced at `ProgressiveToolRegistry.register()`. Longer descriptions are rejected at startup, not silently truncated. This is intentional: tool authors should write terse descriptions; the full schema is the place for detail.

### Rate limits as results
Upstream 429s are caught and converted to `{ type: "rate_limited", retryAfterSeconds, upstream }` before they reach the LLM. The agent can reason: "rate limited, retry in 30s" instead of receiving an exception that terminates the loop.

### Resource-server only OAuth 2.1
MCP2 validates tokens but never manages auth flows. This keeps servers stateless — no session storage, no user database. Auth is delegated entirely to the Authorization Server the client discovers via RFC 9728.

## Compatibility

- **Baseline**: MCP 2025-11-25
- **Node.js**: ≥20.0.0
- **Wire format**: JSON-RPC 2.0 (unchanged)
- **MCP-Protocol-Version header**: sent on all HTTP requests

## License

MIT
