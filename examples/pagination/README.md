# pagination

Shows how Delta-MCP paginates large tool results so the model never sees more tokens than it needs.

## Setup

Server holds **1 000 user records** with `paginateAfter: 20`. Every `list_users` or `search_users` call returns at most 20 records plus navigation metadata — the model reads `hasMore` and requests the next page if needed.

| Without pagination | With pagination |
|--------------------|----------------|
| ~40 000 tokens for the full list | ~800 tokens per page |
| Model context blown on first call | Model fetches only what it needs |

## Run

```bash
npx tsx examples/pagination/index.ts
```

## What it covers

| Scenario | Description |
|----------|-------------|
| Page 1 (default) | 20 records, `hasMore: true`, navigation hint in `note` |
| Jump to page 7 | Skip directly to any page by number |
| Custom `pageSize` | `pageSize: 5` → 200 pages; model chooses granularity |
| Filter + pagination | `activeOnly: true` reduces total, pagination still works |
| Auto-fetch all pages | Loop until `hasMore: false` — the pattern agents use |
| Last page | `hasMore: false` — clean termination signal |

## Key patterns

### Manual navigation

```typescript
// Model reads note: "Page 1/50 ... Pass page=2 for next page."
const page1 = await client.callTool("list_users", { page: 1 });
const page2 = await client.callTool("list_users", { page: 2 });
```

### Auto-fetch all pages

```typescript
async function fetchAllPages(client, tool, args, pageSize = 20) {
  const all = [];
  let page = 1;
  while (true) {
    const result = await client.callTool(tool, { ...args, page, pageSize });
    if (!result.paginated) return Array.isArray(result) ? result : [result];
    all.push(...result.items);
    if (!result.hasMore) break;
    page++;
  }
  return all;
}
```

### Page result shape

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

## Server config

```typescript
new MyServer({
  resultHandler: {
    paginateAfter: 20,   // trigger pagination when array length > 20
    maxTokens: 2000,     // truncate strings/objects over this budget
  },
});
```

`page` and `pageSize` are read automatically from tool call args — no extra server code needed.
