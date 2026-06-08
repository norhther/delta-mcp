import type { ToolDefinition, ToolSummary } from "../protocol/types.js";

const MAX_SUMMARY_DESCRIPTION = 60;

/**
 * Progressive disclosure registry — the headline MCP2 feature.
 *
 * Instead of dumping all tool schemas into context on init, we expose:
 *   1. A capability index: names + truncated descriptions (~600 tokens total)
 *   2. On-demand full schemas via tools/describe
 *
 * Proven gains: 85-95% definition overhead reduction, tool-selection accuracy
 * up from 49% to 74% (Opus 4) by showing fewer, more relevant tools.
 */
export class ProgressiveToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private schemaHashes = new Map<string, string>();

  register(tool: ToolDefinition): void {
    if (tool.description.length > MAX_SUMMARY_DESCRIPTION) {
      throw new Error(
        `Tool "${tool.name}" description exceeds ${MAX_SUMMARY_DESCRIPTION} chars in summary mode. ` +
          `Use extended description in inputSchema.$description for full details.`
      );
    }
    this.tools.set(tool.name, tool);
    this.schemaHashes.set(tool.name, hashSchema(tool.inputSchema));
  }

  /** Returns capability index — names + short descriptions only */
  listSummaries(): ToolSummary[] {
    return Array.from(this.tools.values()).map(({ name, description }) => ({
      name,
      description,
    }));
  }

  /** Full schemas for all tools — used for standard (non-progressive) clients */
  listFull(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Full schema — only fetched when model explicitly requests it */
  describe(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Schema hash for compact-encoding deduplication across calls */
  schemaHash(name: string): string | undefined {
    return this.schemaHashes.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

// Deterministic 8-char hash — cheap schema deduplication for compact encoding
function hashSchema(schema: Record<string, unknown>): string {
  const json = stableStringify(schema);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Serialize with object keys sorted recursively, so logically-equal schemas
 * produce identical strings regardless of key insertion order.
 *
 * Note: JSON.stringify's array replacer is a property *allowlist* applied at
 * every depth — it cannot be used to sort keys (it silently drops nested keys
 * not in the list). We walk the structure ourselves instead.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}
