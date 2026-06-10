---
title: Result Handler
description: How Delta-MCP keeps large tool outputs out of LLM context automatically.
---

Every tool result passes through the result handler before hitting LLM context. The handler applies four transformations depending on the output type:

| Input | Output |
|-------|--------|
| String over budget | `{ truncated: true, preview, totalChars, estimatedTokens, note }` |
| Array over page size | `{ paginated: true, items, page, totalPages, hasMore, note }` |
| Object over budget | `{ _summarized: true, _totalKeys, key: previewValue, ... }` |
| Upstream 429 | `{ type: "rate_limited", retryAfterSeconds, upstream }` |

## Configuration

Set limits in the server constructor — they apply to every tool call:

```typescript
new MyServer({
  resultHandler: {
    maxTokens: 2000,    // truncate strings/objects over ~2000 tokens (~8 KB)
    paginateAfter: 50,  // paginate arrays longer than 50 items
  },
});
```

## Pagination

`page` and `pageSize` flow from tool call args automatically — no server-side pagination code needed:

```typescript
// Model reads hasMore: true, then requests the next page
await client.callTool("list_records", { page: 2, pageSize: 20 });
```

Page result shape:

```json
{
  "paginated": true,
  "totalItems": 1000,
  "page": 1,
  "pageSize": 20,
  "totalPages": 50,
  "hasMore": true,
  "items": [...],
  "note": "Page 1/50. 1000 total items. Pass page=2 for next page."
}
```

## Truncation

Strings over the token budget are replaced with a preview and metadata:

```json
{
  "truncated": true,
  "totalChars": 140000,
  "estimatedTokens": 35000,
  "preview": "Lorem ipsum dolor sit amet...",
  "note": "String truncated to ~2000 tokens. Full length: 140000 chars (~35000 tokens)."
}
```

The model sees the file is large and can decide whether to request it in chunks or summarize.

## Object summarization

Objects exceeding the token budget get a key-level preview:

```json
{
  "_summarized": true,
  "_totalKeys": 100,
  "_estimatedTokens": 4200,
  "key_0": "value_0",
  "key_1": "value_1",
  "key_2": "[Array(5)]",
  "key_3": "{Object: id, name, email}",
  "_truncatedKeys": 96
}
```

## Rate limits

A 429 thrown by the tool becomes a structured result the model can reason about — not an exception that terminates the agent loop:

```json
{
  "type": "rate_limited",
  "retryAfterSeconds": 30,
  "upstream": "my_api_tool",
  "message": "Too Many Requests"
}
```

The handler detects 429 from the `status` or `statusCode` property on thrown errors, and parses `retry-after` from the error's `headers` object.

## See also

- [Pagination example](/delta-mcp/examples/pagination/)
- [Result handler example](/delta-mcp/examples/result-handler/)
