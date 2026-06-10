---
title: Result Handler
description: See Delta-MCP automatically truncate, paginate, summarize, and rate-limit large tool outputs.
---

Shows how Delta-MCP's result handler automatically protects the LLM context window from large tool outputs.

## What it demonstrates

| Scenario | Raw output | Handled output |
|----------|-----------|----------------|
| Large string | 50 KB text | `{ truncated: true, preview, totalChars, estimatedTokens }` |
| Long array | 50 items | `{ paginated: true, items: [first 5], page, totalPages, hasMore }` |
| Big object | 100 keys | `{ _summarized: true, _totalKeys: 100, key_0: "value_0", ... }` |
| Upstream 429 | thrown error | `{ type: "rate_limited", retryAfterSeconds, upstream }` |

## Run

```bash
npx tsx examples/result-handler/index.ts
```

## Configuration

Set limits in the server constructor — they apply to every tool call:

```typescript
new MyServer({
  resultHandler: {
    maxTokens: 2000,    // truncate strings over ~2000 tokens (~8 KB)
    paginateAfter: 50,  // paginate arrays longer than 50 items
  },
});
```

The model controls pagination by passing `page` and `pageSize` in tool args:

```typescript
// model calls this after seeing hasMore: true in the previous result
await client.callTool("list_records", { page: 2, pageSize: 5 });
```

Rate-limit results give the model enough information to retry:

```json
{
  "type": "rate_limited",
  "retryAfterSeconds": 30,
  "upstream": "call_rate_limited_api"
}
```

[View on GitHub →](https://github.com/norhther/delta-mcp/tree/main/examples/result-handler/)

## See also

- [Result Handler — how it works](/delta-mcp/how-it-works/result-handler/)
- [Pagination example](/delta-mcp/examples/pagination/) for a more involved pagination walkthrough
