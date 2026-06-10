/**
 * Client usage example — shows how to connect to a Delta-MCP server,
 * list tools with progressive disclosure, fetch schemas on demand, and call tools.
 *
 * Run: npx tsx examples/client-usage/index.ts
 *
 * The example spawns the stdio-server as a child process so everything
 * runs from one terminal with no extra setup.
 */
import { DeltaClient, StdioClientTransport } from "@delta-mcp/client";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "../stdio-server/index.ts");

async function main() {
  // ── 1. Connect ─────────────────────────────────────────────────────────────
  // StdioClientTransport spawns the server process and speaks JSON-RPC over
  // its stdin/stdout. Swap this for HttpClientTransport to talk to an HTTP server.
  const transport = new StdioClientTransport("npx", ["tsx", serverPath]);
  const client = new DeltaClient(transport);

  const session = await client.initialize({ name: "example-client", version: "1.0.0" });

  console.log("Connected to:", session.serverName, session.serverVersion);
  console.log("Progressive disclosure:", session.progressiveDisclosure);
  console.log("Wire encoding:", session.encoding);
  console.log();

  // ── 2. List tools — names + short descriptions only ───────────────────────
  // In progressive mode the server sends ≤60-char descriptions, not full schemas.
  // This is the token saving: ~97 tokens for 5 tools vs ~910 for standard MCP.
  const tools = await client.listTools();
  console.log("Tools available:");
  for (const t of tools) {
    console.log(`  ${t.name.padEnd(15)} ${t.description}`);
  }
  console.log();

  // ── 3. Describe a tool on demand ──────────────────────────────────────────
  // The full JSON schema is fetched only when the model decides it needs to use
  // this tool. The result is cached — a second call to describeTool() is free.
  const schema = await client.describeTool("search");
  console.log("Full schema for 'search':");
  console.log(JSON.stringify(schema.inputSchema, null, 2));
  console.log();

  // ── 4. Call a tool ────────────────────────────────────────────────────────
  // callTool() auto-fetches the schema if needed, then calls tools/call.
  // The result is already passed through the result handler on the server side
  // (truncation / pagination / rate-limit wrapping).
  const results = await client.callTool("search", { query: "delta mcp", limit: 2 });
  console.log("search result:", JSON.stringify(results, null, 2));
  console.log();

  const fileResult = await client.callTool("read_file", { path: "/etc/hostname" });
  console.log("read_file result:", fileResult);

  transport.close();
}

main().catch(console.error);
