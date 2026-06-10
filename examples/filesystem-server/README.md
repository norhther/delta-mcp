# filesystem-server

A practical Delta-MCP server exposing filesystem tools. Good starting point for your own servers.

## Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read a text file (large files auto-truncated) |
| `write_file` | Write or overwrite a text file |
| `list_dir` | List directory contents (auto-paginated) |
| `search_files` | Find files matching a substring pattern |
| `file_info` | Get size, mtime, and type for a path |

## Run

### stdio (for Claude Desktop / AI agents)

```bash
# Allow access only to /home/me/projects
npx tsx examples/filesystem-server/index.ts /home/me/projects
```

### HTTP

```bash
# Listen on port 3001, allow access to current directory
npx tsx examples/filesystem-server/index.ts --http 3001 .
```

## Using with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["tsx", "/path/to/examples/filesystem-server/index.ts", "/allowed/root"]
    }
  }
}
```

## Security

All paths are resolved under the configured root. Any attempt to traverse outside it (e.g. `../../etc/passwd`) returns an "Access denied" error.

## Token efficiency in practice

A directory with 200 entries: standard MCP returns all 200. Delta-MCP returns the first 50 with pagination metadata — the model requests page 2 only if it needs to go deeper.

A 100KB file: standard MCP returns the full content. Delta-MCP returns a preview + token count estimate — the model knows the file is large and can decide whether to request it in chunks or summarize.
