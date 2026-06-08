import type { EncodingFormat } from "./negotiation.js";
import { encodeCompact, decodeCompact } from "./negotiation.js";

export interface Codec {
  encode(value: unknown): Buffer | string;
  decode(data: Buffer | string): unknown;
  contentType: string;
}

/** JSON codec — baseline, always available */
const jsonCodec: Codec = {
  contentType: "application/json",
  encode: (v) => JSON.stringify(v),
  decode: (d) => JSON.parse(d.toString()),
};

/** Compact-JSON codec — short keys, JSON wire format, ~30-40% smaller */
const compactJsonCodec: Codec = {
  contentType: "application/json; variant=compact",
  encode: (v) => JSON.stringify(encodeCompact(v)),
  decode: (d) => decodeCompact(JSON.parse(d.toString())),
};

/** CBOR codec — binary, lowest wire overhead, requires cbor-x */
let cborCodec: Codec | null = null;
try {
  // Dynamic import so CBOR is optional — falls back if cbor-x not installed
  const { encode: cborEncode, decode: cborDecode } = await import("cbor-x");
  cborCodec = {
    contentType: "application/cbor",
    encode: (v) => Buffer.from(cborEncode(v)),
    decode: (d) => cborDecode(Buffer.isBuffer(d) ? d : Buffer.from(d as string, "binary")),
  };
} catch {
  // cbor-x not available — HTTP clients negotiating CBOR fall back to compact-json
}

export function getCodec(format: EncodingFormat): Codec {
  switch (format) {
    case "cbor":
      return cborCodec ?? compactJsonCodec; // fallback if cbor-x missing
    case "compact-json":
      return compactJsonCodec;
    default:
      return jsonCodec;
  }
}

export { jsonCodec, compactJsonCodec, cborCodec };
