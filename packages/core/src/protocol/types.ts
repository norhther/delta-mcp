import { z } from "zod";

// JSON-RPC 2.0 base — wire format unchanged for ecosystem compatibility
export const JsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);
export type JsonRpcId = z.infer<typeof JsonRpcIdSchema>;

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema.optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema,
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

// MCP2 protocol version
export const DELTA_PROTOCOL_VERSION = "delta-mcp/0.1.0";
export const MCP_BASELINE_VERSION = "2025-11-25";

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
