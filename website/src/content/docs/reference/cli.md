---
title: CLI Reference
description: delta-mcp CLI — list, describe, call, and benchmark any MCP server from the terminal.
---

The `delta-mcp` CLI connects to any stdio MCP server and lets you inspect, call, and benchmark it interactively.

## Install

```bash
npm install -g @delta-mcp/cli
```

Or run without installing:

```bash
npx @delta-mcp/cli list node server.js
```

## Commands

### `list`

List all tools on a server (progressive mode — names + short descriptions only):

```bash
delta-mcp list <server-command> [server-args...]
```

```
Server: delta-mcp-demo v0.2.1
Mode: progressive

Tools (6):
  search               Search docs and return top results
  read_file            Read file contents from the workspace
  write_file           Write content to a file in workspace
  list_dir             List directory contents at given path
  fail                 Always throws — exercises isError execution results
  run_command          Execute shell command in workspace sandbox

  Token cost: ~115 tokens
```

### `describe`

Fetch the full JSON schema for a single tool:

```bash
delta-mcp describe <server-command> [server-args...] <tool-name>
```

```bash
delta-mcp describe node server.js search
```

Output is the raw JSON schema:

```json
{
  "name": "search",
  "description": "Search docs and return top results",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query" },
      "limit": { "type": "number", "default": 10 }
    },
    "required": ["query"]
  }
}
```

### `call`

Call a tool with JSON arguments:

```bash
delta-mcp call <server-command> [server-args...] <tool-name> <json-args>
```

```bash
delta-mcp call node server.js search '{"query":"hello","limit":3}'
```

### `bench`

Run the token efficiency benchmark against a server:

```bash
delta-mcp bench <server-command> [server-args...]
```

```bash
delta-mcp bench node server.js
```

Output shows the token savings achieved by progressive disclosure vs standard MCP:

```
Benchmarking: delta-mcp-demo v0.2.1

┌───────────────────────────────────────────────────────┐
│            MCP2 Token Efficiency Benchmark            │
├──────────────────┬──────────┬────────┬────────────────┤
│ Scenario         │ Standard │ MCP2   │ Reduction      │
├──────────────────┼──────────┼────────┼────────────────┤
│ 6-tool discovery │ 943 tk   │ 118 tk │ 87.5% (825 tk) │
└──────────────────┴──────────┴────────┴────────────────┘

Latency:
  tools/list (summaries):         0ms
  tools/describe all (6 schemas): 1ms
  Standard MCP equivalent:        1ms (upfront)
  Delta-MCP first-tool latency:   0ms + schema-on-demand
```

## Usage with multi-arg server commands

Pass server arguments before the tool name:

```bash
# Server that takes a root directory argument
delta-mcp list npx tsx examples/filesystem-server/index.ts /home/me/projects

# Describe a tool on that server
delta-mcp describe npx tsx examples/filesystem-server/index.ts /home/me/projects read_file
```
