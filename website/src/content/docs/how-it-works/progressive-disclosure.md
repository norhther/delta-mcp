---
title: Progressive Disclosure
description: How Delta-MCP loads tool schemas on demand instead of upfront, saving 89% of discovery tokens.
---

Standard MCP loads every tool's full JSON schema at `initialize`. With 10 tools averaging 1 K tokens each, that's 10 K tokens before the agent does any work. Enterprise agents connecting to dozens of servers can burn tens of thousands of tokens on schema loading alone.

Delta-MCP replaces this with a two-tier model negotiated at `initialize`:

```
tools/list     → names + ≤60-char descriptions only  (~115 tokens for 6 tools)
tools/describe → full schema, on-demand, cached       (~30 tokens per tool)
```

## The 60-char description cap

The description cap is enforced at registration — longer descriptions throw at startup. This is intentional: the schema is the right place for detail, not the discovery index.

Counter-intuitively, shorter descriptions _improve_ tool-selection accuracy. More detail increases execution steps by 67% and regresses 16% of cases (Anthropic lazy-tool-loading research).

```typescript
this.tool({
  name: "search",
  description: "Search docs and return top results", // ≤60 chars ✓
  // description: "Full-text search over documentation, supports boolean operators AND, OR, NOT..."
  //              ^ throws at startup ✗
  inputSchema: { ... },
});
```

## Token comparison

```
// Standard MCP — model sees all of this before doing anything
{
  name: "search",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Full-text query. Supports AND, OR, NOT..." },
      limit: { ... },
      filters: { type: "object", properties: { dateRange: { ... } } }
    }
  }
}

// Delta-MCP tools/list — model sees this (~6 tokens)
{ name: "search", description: "Search docs and return top results" }

// Delta-MCP tools/describe — only fetched when model decides to use the tool
{ name: "search", inputSchema: { ...full schema... } }
```

## Schema caching

Once `tools/describe` is called for a tool, the schema is cached in the client. Subsequent calls return the cached schema with no round-trip.

```typescript
await client.describeTool("search"); // fetches from server
await client.describeTool("search"); // returns from cache, 0 ms
```

## Compatibility

Standard MCP clients connecting to a Delta-MCP server get full schemas via `tools/list` automatically — the server detects that the client hasn't negotiated progressive disclosure and falls back to the MCP baseline.

## Numbers

| Scenario | Standard MCP | Delta-MCP |
|----------|-------------|-----------|
| 6-tool discovery | 943 tokens | **118 tokens** |
| 20-tool discovery | ~3 600 tokens | **378 tokens** |
| 1 of 6 tools used | 941 tokens upfront | **229 tokens on-demand** |
| Tool-selection accuracy (Opus 4.5) | 79.5% | **88.1%** |
