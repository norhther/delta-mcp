/**
 * Pagination example — shows how Delta-MCP handles large lists across pages.
 *
 * Demonstrates:
 *   1. Single page request (default)
 *   2. Jumping to a specific page
 *   3. Custom page size per call
 *   4. Server-side filter + pagination combined
 *   5. Auto-fetch all pages (pattern agents use when they need all data)
 *   6. Last page + hasMore: false sentinel
 *
 * The server holds 1 000 records (paginateAfter: 20).
 * Without pagination: ~40 000 tokens. Per page: ~800 tokens.
 *
 * Run: npx tsx examples/pagination/index.ts
 */
import { DeltaClient, StdioClientTransport } from "@delta-mcp/client";
import { fileURLToPath } from "url";
import path from "path";

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.mjs");

// ── Type helpers ──────────────────────────────────────────────────────────────

interface PageResult {
  paginated: true;
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  items: unknown[];
  note: string;
}

function isPage(v: unknown): v is PageResult {
  return typeof v === "object" && v !== null && (v as PageResult).paginated === true;
}

// ── fetchAllPages — the pattern an agent uses to collect all data ──────────────
// Keeps calling the tool with incrementing page numbers until hasMore is false.
// Accumulates all items in a single array.
async function fetchAllPages(
  client: DeltaClient,
  tool: string,
  baseArgs: Record<string, unknown>,
  pageSize = 20
): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 1;

  while (true) {
    const result = await client.callTool(tool, { ...baseArgs, page, pageSize });
    if (!isPage(result)) {
      // Didn't trigger pagination — entire result fits in one call
      return Array.isArray(result) ? result : [result];
    }
    all.push(...result.items);
    if (!result.hasMore) break;
    page++;
  }

  return all;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const transport = new StdioClientTransport("node", [serverPath]);
const client = new DeltaClient(transport);
await client.initialize({ name: "pagination-demo-client", version: "1.0.0" });

console.log("=== Delta-MCP Pagination Demo ===");
console.log("Server: 1 000 user records | paginateAfter: 20\n");

// 1. Default first page
console.log("1) Page 1 (default, 20 records per page):");
const page1 = await client.callTool("list_users", { page: 1 });
if (isPage(page1)) {
  console.log(`   ${page1.items.length} records | page ${page1.page}/${page1.totalPages} | hasMore: ${page1.hasMore}`);
  console.log(`   First: ${JSON.stringify(page1.items[0])}`);
  console.log(`   Hint: "${page1.note}"`);
}
console.log();

// 2. Jump to an arbitrary page
console.log("2) Jump to page 7:");
const page7 = await client.callTool("list_users", { page: 7 });
if (isPage(page7)) {
  console.log(`   ${page7.items.length} records | page ${page7.page}/${page7.totalPages} | hasMore: ${page7.hasMore}`);
  console.log(`   First on this page: ${JSON.stringify(page7.items[0])}`);
}
console.log();

// 3. Smaller page size — more pages, fewer tokens per call
console.log("3) pageSize=5 (page 1 of 200):");
const tiny = await client.callTool("list_users", { page: 1, pageSize: 5 });
if (isPage(tiny)) {
  console.log(`   ${tiny.items.length} records | ${tiny.totalPages} total pages | hasMore: ${tiny.hasMore}`);
}
console.log();

// 4. Server filter + pagination: active users only
console.log("4) Active users only (page 1):");
const active = await client.callTool("list_users", { page: 1, activeOnly: true });
if (isPage(active)) {
  console.log(`   ${active.items.length} records | ${active.totalItems} active total | ${active.totalPages} pages`);
}
console.log();

// 5. Auto-fetch all pages — loop until hasMore: false
console.log("5) Auto-fetch ALL pages for search_users prefix='user_00':");
const t0 = Date.now();
const allMatches = await fetchAllPages(client, "search_users", { prefix: "user_00" }, 20);
const elapsed = Date.now() - t0;
console.log(`   Collected ${allMatches.length} records in ${elapsed}ms across ${Math.ceil(allMatches.length / 20)} page requests`);
console.log(`   First: ${JSON.stringify(allMatches[0])}`);
console.log(`   Last:  ${JSON.stringify(allMatches[allMatches.length - 1])}`);
console.log();

// 6. Last page — hasMore: false
console.log("6) Last page (page 50):");
const last = await client.callTool("list_users", { page: 50 });
if (isPage(last)) {
  console.log(`   ${last.items.length} records | page ${last.page}/${last.totalPages} | hasMore: ${last.hasMore}`);
  console.log(`   Last record: ${JSON.stringify(last.items[last.items.length - 1])}`);
}

await transport.close();
