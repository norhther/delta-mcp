// JSON-RPC 2.0 base — wire format unchanged for ecosystem compatibility
export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

// MCP2 protocol version
export const DELTA_PROTOCOL_VERSION = "delta-mcp/0.2.0";
export const MCP_BASELINE_VERSION = "2025-11-25";

const DELTA_VERSION_PREFIX = "delta-mcp/";

/**
 * Version-skew policy (negotiate down, never hard-fail):
 *  - Non-delta versions (standard MCP date versions, absent field) are
 *    compatible — behavior stays capability-driven, per ADR-001.
 *  - Delta versions are compatible iff the major component matches ours.
 *    Incompatible clients get a baseline-MCP response from `initialize`.
 */
export function isDeltaVersionCompatible(version: unknown): boolean {
  if (typeof version !== "string" || !version.startsWith(DELTA_VERSION_PREFIX)) {
    return true;
  }
  const major = version.slice(DELTA_VERSION_PREFIX.length).split(".")[0];
  const ownMajor = DELTA_PROTOCOL_VERSION.slice(DELTA_VERSION_PREFIX.length).split(".")[0];
  return major === ownMajor;
}

/**
 * Structural check for a single JSON-RPC request/notification. Valid JSON that
 * is not a request object ("42", arrays, strings) must be answered with
 * INVALID_REQUEST — not silently treated as a notification. Batch arrays are
 * rejected too: MCP removed JSON-RPC batching as of 2025-06-18.
 */
export function isJsonRpcRequestShape(value: unknown): value is JsonRpcRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (value as { method?: unknown }).method === "string"
  );
}

/**
 * MCP-Protocol-Version header values this server accepts. The transport layer
 * (single-endpoint POST JSON-RPC) is identical across these revisions, so a
 * client pinned to an older date version still interoperates. Anything else
 * (typos, garbage) gets 400 — the spec says unsupported versions SHOULD be
 * rejected, and silently proceeding hides client misconfiguration.
 */
export const SUPPORTED_MCP_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
];

// Standard error codes (aligned with spec convergence: -32002 → -32602)
export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602, // was -32002 for missing resource; now converged
  INTERNAL_ERROR: -32603,
  RATE_LIMITED: -32001,   // custom: upstream rate limit, reasoner-friendly
} as const;

// Capability negotiation
export interface ServerCapabilities {
  tools?: {
    progressiveDisclosure?: boolean; // MCP2 extension
    lazyLoading?: boolean;           // MCP2 extension
  };
  encoding?: {
    compactJson?: boolean;
    cbor?: boolean;
    schemaHashReferencing?: boolean;
  };
  auth?: {
    oauth21?: boolean;
    dynamicClientRegistration?: boolean;
  };
  codeExecution?: {
    sandbox?: "deno" | "wasm" | "subprocess";
  };
}

export interface ClientCapabilities {
  encoding?: {
    compactJson?: boolean;
    cbor?: boolean;
  };
  codeExecution?: boolean;
}

// Tool schema — two tiers
export interface ToolSummary {
  name: string;
  description: string; // max 60 chars in progressive-disclosure mode
}

export interface ToolDefinition extends ToolSummary {
  inputSchema: Record<string, unknown>; // JSON Schema
  outputSchema?: Record<string, unknown>;
}

// Rate-limit result (reasoner-friendly, not an error)
export interface RateLimitResult {
  type: "rate_limited";
  retryAfterSeconds: number;
  upstream: string;
  message?: string;
}
