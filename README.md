# Delta-MCP

**Token-efficient MCP reimplementation.** Same JSON-RPC 2.0 wire format. Leaner discovery model. 89% fewer tokens on tool definitions, measured.

---

## Why

Standard MCP has two token bloat problems:

**Tool-definition bloat.** Every tool's full JSON schema loads into context at startup — even tools the model never uses. With 10 tools you're paying 850+ tokens before any work happens. With 50 tools across enterprise servers, thousands.

**Tool-result bloat.** Large outputs (file reads, search results, API responses) route through LLM context unfiltered. One 50KB file read can destroy your context budget.

Delta-MCP fixes both.

---

## Numbers

| | Standard MCP | Delta-MCP |
|--|-------------|-----------|
| 5-tool server init | 910 tokens | **97 tokens** |
| 20-tool server init | ~3600 tokens | **378 tokens** |
| Definition overhead (1/5 tools used) | 910 tokens upfront | **58 tokens on-demand** |
| Tool-selection accuracy (Opus 4) | 49% | **74%** |
| Tool-selection accuracy (Opus 4.5) | 79.5% | **88.1%** |
| Compact-json wire reduction | — | **−18.1%** |

Accuracy numbers from Anthropic lazy tool loading research. Token numbers from `conformance/scenarios/07-benchmark.test.ts` against a 5-tool server with realistic schemas.

---

## How It Works

### Progressive disclosure

Delta-MCP replaces eager schema loading with a two-tier model negotiated at `initialize`:

```
tools/list    → names + ≤60-char descriptions only  (~97 tokens for 5 tools)
tools/describe → full schema, on-demand, cached      (~30 tokens per tool)
```

The 60-char description cap is enforced at registration — longer descriptions throw at startup. This is intentional: the schema is the right place for detail, not the discovery index. Counter-intuitively, shorter descriptions *improve* tool-selection accuracy. More detail increases execution steps by 67% and regresses 16% of cases.

```typescript
// Standard MCP: model sees all of this before doing anything
{ name: "search", inputSchema: { type: "object", properties: { query: { type: "string", description: "Full-text search query string. Supports boolean operators AND, OR, NOT..." }, limit: { ... }, filters: { type: "object", properties: { dateRange: { enum: [...] }, language: { ... } } } } } }

// Delta-MCP tools/list: model sees this
{ name: "search", description: "Search docs and return top results" }

// Delta-MCP tools/describe (only when model decides to use it):
{ name: "search", inputSchema: { ... full schema ... } }
```

### Result handler

Every tool result passes through the result handler before hitting LLM context:

| Input type | Output |
|------------|--------|
| String over budget | `{ truncated: true, preview, totalChars, estimatedTokens, note }` |
| Array over page size | `{ paginated: true, items, page, totalPages, hasMore, note }` |
| Object over budget | `{ _summarized: true, _totalKeys, key: previewValue, ... }` |
| Upstream 429 | `{ type: "rate_limited", retryAfterSeconds, upstream }` |

Rate limits become tool *results* the model can reason about, not exceptions that terminate the agent loop. Pagination params (`page`, `pageSize`) flow automatically from tool call args — the model requests subsequent pages without the server needing explicit pagination logic.

### Compact wire encoding

Negotiated at `initialize`, auto-fallback to standard JSON for unaware clients. Both sides switch codecs after the handshake — the `initialize` response itself is always plain JSON so the client can read it before the switch.

```
Standard: {"jsonrpc":"2.0","method":"tools/list","result":{"tools":[...]}}
Compact:  {"j":"2.0","m":"tools/list","r":{"t":[...]}}
```

CBOR binary encoding is available over HTTP via the optional `cbor-x` dependency. Stdio clamps to compact-json because CBOR is binary and cannot be safely newline-delimited.

The HTTP transport decodes requests by `Content-Type` and encodes responses by the client's `Accept` header. The `MCP-Protocol-Version` header is required on all requests except `initialize` — the client doesn't know the version until the handshake completes.

### OAuth 2.1 (resource-server only)

Delta-MCP validates tokens, never issues them. Stateless by design:

```
Client → POST /mcp
Server → 401  WWW-Authenticate: Bearer resource_metadata="/.well-known/oauth-protected-resource"
Client → GET  /.well-known/oauth-protected-resource  (RFC 9728 PRM)
Client → discovers AS, gets token via PKCE (mandatory, no implicit flow)
Client → POST /mcp  Authorization: Bearer <token>
Server → validates JWT + RFC 8707 audience binding → processes request
```

The HTTP transport runs in one of two modes:

**Full OAuth** — pass the `oauth` option and the transport serves the RFC 9728 PRM document at `/.well-known/oauth-protected-resource`, validates tokens for audience (RFC 8707) + expiry + signature, and emits spec `WWW-Authenticate` challenges with error reasons. This is the production path:

```typescript
createHttpHandler(handler, {
  oauth: {
    resourceUrl: "https://mcp.example.com",      // must equal the token `aud`
    authorizationServers: ["https://auth.example.com"],
    verifySignature: async (token, header, payload) => verifyWithJwks(token),
  },
});
```

**Presence-only (dev)** — without `oauth`, the bearer check is presence-only: any non-empty token passes. Dev-grade. A `validateToken` hook narrows it without the full PRM machinery; set `authRequired: false` for an explicitly open server.

The full flow is exercised end-to-end in conformance CS-09 (401 → PRM fetch → authenticated call → audience/expiry rejection), not just unit-tested in isolation. A runnable server (zero deps, RS256 + curl walkthrough) lives in [`examples/http-oauth-server`](examples/http-oauth-server) — `DeltaServer.startHttp({ port, oauth })` wires all of this in one call.

The `MCP-Protocol-Version` header carries the *baseline MCP* version (2025-11-25) for ecosystem interop; Delta-MCP extensions are advertised separately in the `initialize` result's `capabilities`.

---

## Quick Start

```bash
npm install @delta-mcp/server @delta-mcp/client
```

```typescript
import { DeltaServer } from "@delta-mcp/server";

class MyServer extends DeltaServer {
  constructor() {
    super({
      name: "my-server",
      version: "1.0.0",
      resultHandler: { maxTokens: 500, paginateAfter: 50 },
    });

    this.tool({
      name: "search",
      description: "Search docs and return top results", // ≤60 chars, enforced
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          page: { type: "number" },
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
npx @delta-mcp/cli list    node ./server.js                        # list tools
npx @delta-mcp/cli describe node ./server.js search                # full schema
npx @delta-mcp/cli call    node ./server.js search '{"query":"x"}' # call tool
npx @delta-mcp/cli bench   node ./server.js                        # benchmark
```

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Delta-MCP Client                   │
│  negotiate capabilities → get index → fetch schema   │
│  on demand → cached → call tool                      │
└─────────────────────┬────────────────────────────────┘
                      │  JSON-RPC 2.0 (unchanged wire)
┌─────────────────────▼────────────────────────────────┐
│                   Delta-MCP Server                   │
│                                                      │
│  ProgressiveToolRegistry    Result Handler           │
│  names + 60-char desc       truncate / paginate /    │
│  schemas on-demand          rate-limit → result      │
│                                                      │
│  stdio / HTTP transport     OAuth 2.1 resource-server│
└──────────────────────────────────────────────────────┘
```

---

## Packages

| Package | Purpose |
|---------|---------|
| `@delta-mcp/core` | Types, transport, progressive disclosure, encoding, auth, result handler |
| `@delta-mcp/server` | `DeltaServer` base class — protocol + result handling wired in |
| `@delta-mcp/client` | `DeltaClient` with schema cache and capability negotiation |
| `@delta-mcp/cli` | `delta-mcp` CLI for inspect, test, benchmark |

## Conformance

75 tests across 10 scenarios. Run with:

```bash
npm run conformance
```

| Scenario | Coverage |
|----------|----------|
| CS-01 | Initialize handshake, capability negotiation, codec negotiation |
| CS-02 | Progressive disclosure: list, describe, cache, 60-char cap |
| CS-03 | tools/call: results, errors, structured output |
| CS-04 | Result handler: truncation, pagination, summarization, rate limits |
| CS-05 | Wire encoding: CBOR negotiation, compact-json roundtrip |
| CS-06 | OAuth 2.1 primitives: PRM document, JWT validation, RFC 8707 audience |
| CS-07 | Benchmark: token reduction, latency, overhead targets |
| CS-08 | HTTP transport: version header exemption, codec round-trip |
| CS-09 | OAuth 2.1 end-to-end: 401 → PRM discovery → authenticated call, bad-token rejection |
| CS-10 | Protocol soundness: version-skew downgrade, notification semantics, honest capabilities, HTTP 202 |

Full results: [`docs/benchmarks/results.md`](docs/benchmarks/results.md)

---

## Compatibility

- **Baseline**: MCP 2025-11-25 — Streamable HTTP + stdio transports
- **Node.js**: ≥20.0.0
- **Wire format**: JSON-RPC 2.0 — unchanged, fully interoperable
- Standard MCP clients connecting to a Delta-MCP server get standard MCP behavior automatically

## License

MIT
