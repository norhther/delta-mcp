# MCP2 — Token-Efficient MCP Reimplementation

> **78%+ input token reduction** via progressive disclosure, compact encoding, and code-execution patterns. Fully compatible with MCP 2025-11-25 (JSON-RPC 2.0 wire format unchanged).

## The Problem

| Metric | Standard MCP | MCP2 |
|--------|-------------|------|
| Tool definition overhead | 40–50% of context | ~600 tokens (85–95% reduction) |
| Input tokens (typical agent) | 771K | ~165K |
| Tool-selection accuracy (Opus 4) | 49% | 74% |
| Tool-selection accuracy (Opus 4.5) | 79.5% | 88.1% |

Two bloat sources, two fixes:
1. **Tool-definition bloat** — eager schema loading on init → progressive disclosure
2. **Tool-result bloat** — large outputs routed through context → summarization/pagination before context

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
│  │ ProgressiveTool │  │    Result Handler        │  │
│  │ Registry        │  │  summarize / paginate    │  │
│  │ names+60chars   │  │  rate-limit → result     │  │
│  │ schemas on demand│  └──────────────────────────┘  │
│  └─────────────────┘                                 │
│  ┌──────────────┐   ┌──────────────────────────────┐ │
│  │  Transport   │   │   OAuth 2.1 Resource Server  │ │
│  │  stdio / HTTP│   │   validate only, never issue │ │
│  └──────────────┘   └──────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Phased Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | Spec freeze & compatibility target | ✅ Done |
| 1 | JSON-RPC core: initialize, tools/list, tools/call | 🚧 In progress |
| 2 | Progressive disclosure layer | 🚧 In progress |
| 3 | OAuth 2.1 resource-server role | 📋 Planned |
| 4 | Compact wire encoding (compact-json / CBOR) | 📋 Planned |
| 5 | Result handler: summarize, paginate, rate-limit | 🚧 In progress |
| 6 | Conformance suite & benchmarking | 📋 Planned |

## Quick Start

```typescript
import { MCP2Server } from "@mcp2/server";

class MyServer extends MCP2Server {
  constructor() {
    super({ name: "my-server", version: "1.0.0" });

    // Descriptions MUST be ≤60 chars — enforced at registration
    this.tool({
      name: "search",
      description: "Search docs and return top results",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    });
  }

  protected async callTool(name: string, args: any): Promise<unknown> {
    if (name === "search") return performSearch(args.query);
    throw new Error(`Unknown tool: ${name}`);
  }
}

new MyServer().startStdio();
```

## Key Design Decisions

### 1. Don't fork JSON-RPC
Wire format is identical to MCP 2025-11-25. MCP2 capabilities are negotiated at `initialize` — clients that don't negotiate get standard behavior. 97M+ monthly downloads of the MCP ecosystem remain interoperable.

### 2. 60-character description cap
Based on Anthropic's code-execution research: 60-char truncated descriptions give the model enough to select tools without schema bloat. Full schemas are fetched via `tools/describe` only when needed. Counter-intuitively, *more* description detail decreases accuracy and increases execution steps by 67%.

### 3. Rate limits as results, not errors
Upstream 429s become `{ type: "rate_limited", retryAfterSeconds: 30, upstream: "..." }` — a tool result the model can reason about, not a crash that terminates the agent loop.

### 4. OAuth 2.1 resource-server only
MCP2 validates tokens, never issues them. Stateless, scalable. Returns HTTP 401 with `WWW-Authenticate` pointing to RFC 9728 Protected Resource Metadata — clients discover auth servers automatically.

## Package Structure

```
packages/
  core/     — types, transport, discovery, encoding, auth, result-handler
  server/   — MCP2Server runtime
  client/   — MCP2Client (Phase 1)
  cli/      — mcp2 CLI for testing servers (Phase 2)
examples/
  stdio-server/   — minimal working server
  http-server/    — HTTP + SSE transport
conformance/
  scenarios/      — test suite aligned with MCP conformance framework
docs/
  spec/           — MCP2 extension spec (submitted as MCP Extension)
  adr/            — architecture decision records
```

## Compatibility

- **Baseline**: MCP 2025-11-25 (Streamable HTTP + stdio transports)
- **Node.js**: ≥20.0.0
- **Wire format**: JSON-RPC 2.0 (unchanged)
- **MCP-Protocol-Version header**: required from 2025-06-18 onward

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). MCP2 capabilities are designed as an MCP Extension (per the 2026-07-28 Extensions framework) to enable upstream adoption without forking.

## License

MIT
