#!/usr/bin/env node
/**
 * mcp2 CLI — inspect, test, and benchmark Delta-MCP/MCP servers
 *
 * Commands:
 *   delta-mcp connect <cmd> [args...]   Connect to stdio server, interactive REPL
 *   delta-mcp list <cmd> [args...]      List tools (progressive mode)
 *   delta-mcp describe <cmd> <tool>     Fetch full schema for a tool
 *   delta-mcp call <cmd> <tool> <json>  Call a tool with JSON args
 *   delta-mcp bench <cmd> [args...]     Run token efficiency benchmark
 */

import { DeltaClient, StdioClientTransport } from "@delta-mcp/client";
import { benchmarkToolDiscovery, formatBenchmark, estimateTokens } from "@delta-mcp/core/benchmark";

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
    case undefined:
      printHelp();
      break;
    default:
      // A typo'd command in a script must fail loudly, not "succeed" by
      // printing help and exiting 0.
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

async function cmdList(args: string[]): Promise<void> {
  const [serverCmd, ...serverArgs] = args;
  if (!serverCmd) { console.error("Usage: delta-mcp list <server-command> [args...]"); process.exit(1); }

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
  // delta-mcp describe node server.js search
  const toolName = args.at(-1);
  const serverArgs = args.slice(0, -1);
  const [serverCmd, ...sArgs] = serverArgs;

  if (!serverCmd || !toolName) {
    console.error("Usage: delta-mcp describe <server-command> [server-args...] <tool-name>");
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
  // delta-mcp call node server.js search '{"query":"mcp"}'
  const jsonArgs = args.at(-1) ?? "{}";
  const toolName = args.at(-2);
  const serverArgs = args.slice(0, -2);
  const [serverCmd, ...sArgs] = serverArgs;

  if (!serverCmd || !toolName) {
    console.error("Usage: delta-mcp call <server-command> [server-args...] <tool-name> <json-args>");
    process.exit(1);
  }

  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = JSON.parse(jsonArgs) as Record<string, unknown>;
  } catch {
    // Most common cause: the trailing <json-args> was omitted, so positional
    // parsing shifted and the tool name landed here. Point at the usage.
    console.error(`Invalid JSON args: ${jsonArgs}`);
    console.error("Usage: delta-mcp call <server-command> [server-args...] <tool-name> <json-args>");
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
  if (!serverCmd) { console.error("Usage: delta-mcp bench <server-command> [args...]"); process.exit(1); }

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
    const label = (s: string) => `  ${s.padEnd(32)}`;
    console.log(`\nLatency:`);
    console.log(`${label("tools/list (summaries):")}${listMs}ms`);
    console.log(`${label(`tools/describe all (${schemas.length} schemas):`)}${describeMs}ms`);
    console.log(`${label("Standard MCP equivalent:")}${listMs + describeMs}ms (upfront)`);
    console.log(`${label("Delta-MCP first-tool latency:")}${listMs}ms + schema-on-demand`);
  } finally {
    await transport.close();
  }
}

async function connect(
  serverCmd: string,
  serverArgs: string[]
): Promise<{ client: DeltaClient; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport(serverCmd, serverArgs);
  const client = new DeltaClient(transport);
  await client.initialize();
  return { client, transport };
}

function printHelp(): void {
  console.log(`
delta-mcp — Token-efficient MCP tooling

Commands:
  delta-mcp list   <cmd> [args...]              List server tools (progressive mode)
  delta-mcp describe <cmd> [args...] <tool>     Show full schema for a tool
  delta-mcp call   <cmd> [args...] <tool> <json>  Call a tool
  delta-mcp bench  <cmd> [args...]              Run token efficiency benchmark

Examples:
  delta-mcp list node server.js
  delta-mcp describe node server.js search
  delta-mcp call node server.js search '{"query":"hello"}'
  delta-mcp bench node server.js
`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
