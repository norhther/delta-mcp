export type EncodingFormat = "json" | "compact-json" | "cbor";

export interface EncodingNegotiationResult {
  format: EncodingFormat;
  schemaHashReferencing: boolean;
}

// Short-key mapping for compact-json — reduces JSON payload ~30-40%
export const COMPACT_KEY_MAP: Record<string, string> = {
  jsonrpc: "j",
  method: "m",
  params: "p",
  result: "r",
  error: "e",
  id: "i",
  code: "c",
  message: "msg",
  name: "n",
  description: "d",
  inputSchema: "s",
};

export const COMPACT_KEY_REVERSE = Object.fromEntries(
  Object.entries(COMPACT_KEY_MAP).map(([k, v]) => [v, k])
);

export function negotiate(
  serverCaps: { compactJson?: boolean; cbor?: boolean; schemaHashReferencing?: boolean },
  clientCaps: { compactJson?: boolean; cbor?: boolean }
): EncodingNegotiationResult {
  let format: EncodingFormat = "json";

  if (serverCaps.cbor && clientCaps.cbor) {
    format = "cbor";
  } else if (serverCaps.compactJson && clientCaps.compactJson) {
    format = "compact-json";
  }

  return {
    format,
    schemaHashReferencing: !!(serverCaps.schemaHashReferencing),
  };
}

export function encodeCompact(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(encodeCompact);

  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
      COMPACT_KEY_MAP[k] ?? k,
      encodeCompact(v),
    ])
  );
}

export function decodeCompact(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(decodeCompact);

  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
      COMPACT_KEY_REVERSE[k] ?? k,
      decodeCompact(v),
    ])
  );
}
