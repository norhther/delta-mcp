#!/usr/bin/env node
/**
 * mcp2 CLI — inspect, test, and benchmark MCP2/MCP servers
 *
 * Commands:
 *   mcp2 connect <cmd> [args...]   Connect to stdio server, interactive REPL
 *   mcp2 list <cmd> [args...]      List tools (progressive mode)
 *   mcp2 describe <cmd> <tool>     Fetch full schema for a tool
 *   mcp2 call <cmd> <tool> <json>  Call a tool with JSON args
 *   mcp2 bench <cmd> [args...]     Run token efficiency benchmark
 */

import { MCP2Client, StdioClientTransport } from "@mcp2/client";
import { benchmarkToolDiscovery, formatBenchmark, estimateTokens } from "@mcp2/core/benchmark";

const [, , command, ...rest] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case "list":
      await cmdList(rest);
      break;
    case "describe":
      await cmdDescribe(rest);
      break;
    case "call":
      await cmdCall(rest);
      break;
    case "bench":
      await cmdBench(rest);
      break;
    case "help":
    default:
      printHelp();
  }
}

async function cmdList(args: string[]): Promise<void> {
  const [serverCmd, ...serverArgs] = args;
  if (!serverCmd) { console.error("Usage: mcp2 list <server-command> [args...]"); process.exit(1); }

  const { client, transport } = await connect(serverCmd, serverArgs);
  try {
    const tools = await client.listTools();
    const session = client.sessionInfo;

    console.log(`\nServer: ${session.serverName} v${session.serverVersion}`);
    console.log(`Mode: ${session.progressiveDisclosure ? "progressive" : "standard"}`);
    console.log(`\nTools (${tools.length}):`);

    for (const t of tools) {
      console.log(`  ${t.name.padEnd(20)} ${t.description}`);
    }

    const tokenCost = estimateTokens(tools);
    console.log(`\n  Token cost: ~${tokenCost} tokens`);
  } finally {
    await transport.close();
  }
}

async function cmdDescribe(args: string[]): Promise<void> {
  // Find tool name — last non-flag arg before server command ends
  // mcp2 describe node server.js search
  const toolName = args.at(-1);
  const serverArgs = args.slice(0, -1);
  const [serverCmd, ...sArgs] = serverArgs;

  if (!serverCmd || !toolName) {
    console.error("Usage: mcp2 describe <server-command> [server-args...] <tool-name>");
    process.exit(1);
  }

  const { client, transport } = await connect(serverCmd, sArgs);
  try {
    const schema = await client.describeTool(toolName);
    console.log(JSON.stringify(schema, null, 2));
  } finally {
    await transport.close();
  }
}

async function cmdCall(args: string[]): Promise<void> {
  // mcp2 call node server.js search '{"query":"mcp"}'
  const jsonArgs = args.at(-1) ?? "{}";
  const toolName = args.at(-2);
  const serverArgs = args.slice(0, -2);
  const [serverCmd, ...sArgs] = serverArgs;

  if (!serverCmd || !toolName) {
    console.error("Usage: mcp2 call <server-command> [server-args...] <tool-name> <json-args>");
    process.exit(1);
  }

  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = JSON.parse(jsonArgs) as Record<string, unknown>;
  } catch {
    console.error(`Invalid JSON args: ${jsonArgs}`);
    process.exit(1);
  }

  const { client, transport } = await connect(serverCmd, sArgs);
  try {
    const result = await client.callTool(toolName, parsedArgs);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await transport.close();
  }
}

async function cmdBench(args: string[]): Promise<void> {
  const [serverCmd, ...serverArgs] = args;
  if (!serverCmd) { console.error("Usage: mcp2 bench <server-command> [args...]"); process.exit(1); }

  const { client, transport } = await connect(serverCmd, serverArgs);
  try {
    const session = client.sessionInfo;
    console.log(`\nBenchmarking: ${session.serverName} v${session.serverVersion}`);

    // Get summaries (MCP2 progressive)
    const t0 = Date.now();
    const summaries = await client.listTools();
    const listMs = Date.now() - t0;

    // Fetch all schemas (simulating what standard MCP does upfront)
    const schemas = await Promise.all(
      summaries.map((s: { name: string }) => client.describeTool(s.name))
    );
    const describeMs = Date.now() - listMs - t0;

    const result = benchmarkToolDiscovery(schemas);
    console.log(formatBenchmark([result]));
    console.log(`\nLatency:`);
    console.log(`  tools/list (summaries):         ${listMs}ms`);
    console.log(`  tools/describe all (${schemas.length} schemas): ${describeMs}ms`);
    console.log(`  Standard MCP equivalent:        ${listMs + describeMs}ms (upfront)`);
    console.log(`  MCP2 first-tool latency:        ${listMs}ms + schema-on-demand`);
  } finally {
    await transport.close();
  }
}

async function connect(
  serverCmd: string,
  serverArgs: string[]
): Promise<{ client: MCP2Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport(serverCmd, serverArgs);
  const client = new MCP2Client(transport);
  await client.initialize();
  return { client, transport };
}

function printHelp(): void {
  console.log(`
mcp2 — Token-efficient MCP tooling

Commands:
  mcp2 list   <cmd> [args...]              List server tools (progressive mode)
  mcp2 describe <cmd> [args...] <tool>     Show full schema for a tool
  mcp2 call   <cmd> [args...] <tool> <json>  Call a tool
  mcp2 bench  <cmd> [args...]              Run token efficiency benchmark

Examples:
  mcp2 list node server.js
  mcp2 describe node server.js search
  mcp2 call node server.js search '{"query":"hello"}'
  mcp2 bench node server.js
`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
