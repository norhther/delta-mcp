export type EncodingFormat = "json" | "compact-json" | "cbor";

export interface EncodingNegotiationResult {
  format: EncodingFormat;
  schemaHashReferencing: boolean;
}

/**
 * Short-key map for compact-json encoding.
 * Applied to JSON keys before serialization — reduces payload ~30-40%.
 * Keys chosen to be unambiguous even in mixed payloads.
 */
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
  outputSchema: "os",
  tools: "t",
  content: "cnt",
  type: "tp",
  text: "tx",
};

export const COMPACT_KEY_REVERSE = Object.fromEntries(
  Object.entries(COMPACT_KEY_MAP).map(([k, v]) => [v, k])
);

/**
 * Escape prefix for keys that would otherwise be ambiguous on the wire.
 *
 * The remap is only safe if it is injective *on the wire*. Two source keys can
 * collide without escaping:
 *   1. A literal key that already equals a short code (e.g. user data key "n")
 *      — on decode it would be wrongly expanded to "name".
 *   2. A long key and its own short code both present (e.g. {name, n}) — both
 *      would map to "n" and one would be lost.
 * Escaping any literal key that looks like a short code (or already starts with
 * the escape char) removes the ambiguity: decode strips exactly one prefix.
 */
const COMPACT_ESCAPE = "~";

/** hasOwn guard avoids matching inherited Object.prototype keys ("toString", "constructor", …). */
function compactKey(key: string): string {
  if (Object.hasOwn(COMPACT_KEY_MAP, key)) return COMPACT_KEY_MAP[key]!;
  if (Object.hasOwn(COMPACT_KEY_REVERSE, key) || key.startsWith(COMPACT_ESCAPE)) {
    return COMPACT_ESCAPE + key;
  }
  return key;
}

function expandKey(key: string): string {
  if (key.startsWith(COMPACT_ESCAPE)) return key.slice(1);
  if (Object.hasOwn(COMPACT_KEY_REVERSE, key)) return COMPACT_KEY_REVERSE[key]!;
  return key;
}

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
      compactKey(k),
      encodeCompact(v),
    ])
  );
}

export function decodeCompact(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(decodeCompact);

  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
      expandKey(k),
      decodeCompact(v),
    ])
  );
}
