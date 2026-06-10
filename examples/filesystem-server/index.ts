/**
 * Filesystem MCP server — a practical example showing a real tool set:
 * read_file, write_file, list_dir, search_files, and file_info.
 *
 * Highlights:
 *   - Large file reads are automatically truncated by the result handler
 *   - Directory listings are paginated automatically
 *   - All paths are restricted to a configurable root (sandbox)
 *
 * Run as stdio server (e.g. for Claude Desktop):
 *   npx tsx examples/filesystem-server/index.ts /path/to/allowed/root
 *
 * Or over HTTP:
 *   npx tsx examples/filesystem-server/index.ts --http 3001 /path/to/root
 */
import fs from "fs/promises";
import path from "path";
import { DeltaServer } from "@delta-mcp/server";

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const httpFlag = args.indexOf("--http");
const httpPort = httpFlag !== -1 ? Number(args[httpFlag + 1]) : null;
const rootArg = httpPort !== null ? args[httpFlag + 2] : args[0];
const ALLOWED_ROOT = path.resolve(rootArg ?? process.cwd());

// ── Security helper ───────────────────────────────────────────────────────────

/** Resolve `userPath` under `ALLOWED_ROOT` and reject path-traversal attempts. */
function safePath(userPath: string): string {
  const resolved = path.resolve(ALLOWED_ROOT, userPath.replace(/^\//, ""));
  if (!resolved.startsWith(ALLOWED_ROOT + path.sep) && resolved !== ALLOWED_ROOT) {
    throw new Error(`Access denied: path outside allowed root (${ALLOWED_ROOT})`);
  }
  return resolved;
}

// ── Server ────────────────────────────────────────────────────────────────────

class FilesystemServer extends DeltaServer {
  constructor() {
    super({
      name: "filesystem-server",
      version: "1.0.0",
      resultHandler: {
        maxTokens: 2000,   // ~8KB of text before truncation kicks in
        paginateAfter: 50, // directory listings longer than 50 entries paginate
      },
    });

    this.tool({
      name: "read_file",
      description: "Read a text file. Large files are truncated.", // ≤60 chars
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from the allowed root" },
        },
        required: ["path"],
      },
    });

    this.tool({
      name: "write_file",
      description: "Write or overwrite a text file.", // ≤60 chars
      inputSchema: {
        type: "object",
        properties: {
          path:    { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    });

    this.tool({
      name: "list_dir",
      description: "List files and folders in a directory.", // ≤60 chars
      inputSchema: {
        type: "object",
        properties: {
          path:     { type: "string", default: "." },
          page:     { type: "number", default: 1 },
          pageSize: { type: "number", default: 50 },
        },
      },
    });

    this.tool({
      name: "search_files",
      description: "Find files matching a glob pattern.", // ≤60 chars
      inputSchema: {
        type: "object",
        properties: {
          pattern:  { type: "string", description: "Substring to match against file names" },
          dir:      { type: "string", default: "." },
          page:     { type: "number", default: 1 },
          pageSize: { type: "number", default: 20 },
        },
        required: ["pattern"],
      },
    });

    this.tool({
      name: "file_info",
      description: "Get size, mtime, and type for a path.", // ≤60 chars
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    });
  }

  protected async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "read_file": {
        const p = safePath(args.path as string);
        const content = await fs.readFile(p, "utf8");
        return content;
      }

      case "write_file": {
        const p = safePath(args.path as string);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, args.content as string, "utf8");
        return { written: true, path: path.relative(ALLOWED_ROOT, p) };
      }

      case "list_dir": {
        const p = safePath((args.path as string | undefined) ?? ".");
        const entries = await fs.readdir(p, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
        }));
        // result handler applies pagination automatically via args.page / args.pageSize
      }

      case "search_files": {
        const dir = safePath((args.dir as string | undefined) ?? ".");
        const pattern = (args.pattern as string).toLowerCase();
        const matches = await findFiles(dir, pattern);
        return matches.map((p) => path.relative(ALLOWED_ROOT, p));
        // result handler paginates the matches array
      }

      case "file_info": {
        const p = safePath(args.path as string);
        const stat = await fs.stat(p);
        return {
          path:     path.relative(ALLOWED_ROOT, p),
          type:     stat.isDirectory() ? "dir" : "file",
          sizeBytes: stat.size,
          modified: stat.mtime.toISOString(),
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

// ── Recursive file search ─────────────────────────────────────────────────────

async function findFiles(dir: string, pattern: string, results: string[] = []): Promise<string[]> {
  // Limit recursion depth to avoid runaway scans on large trees
  if (results.length >= 500) return results;

  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await findFiles(full, pattern, results);
    } else if (entry.name.toLowerCase().includes(pattern)) {
      results.push(full);
    }
  }
  return results;
}

// ── Start ─────────────────────────────────────────────────────────────────────

const server = new FilesystemServer();

if (httpPort !== null) {
  server.startHttp({ port: httpPort });
  process.stderr.write(`Filesystem server listening on http://127.0.0.1:${httpPort}\n`);
  process.stderr.write(`Allowed root: ${ALLOWED_ROOT}\n`);
} else {
  server.startStdio();
  process.stderr.write(`Filesystem server started (stdio). Allowed root: ${ALLOWED_ROOT}\n`);
}
