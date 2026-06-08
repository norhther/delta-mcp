/**
 * Conformance: Wire encoding (Phase 4)
 * Verifies: negotiation logic, compact-json roundtrip, CBOR fallback
 */
import { describe, it, expect } from "vitest";
import {
  negotiate,
  encodeCompact,
  decodeCompact,
  getCodec,
  COMPACT_KEY_MAP,
} from "@delta-mcp/core";

describe("CS-05: Wire encoding", () => {
  it("CS-05-01: negotiation selects CBOR when both sides support it", () => {
    const result = negotiate(
      { cbor: true, compactJson: true },
      { cbor: true, compactJson: true }
    );
    expect(result.format).toBe("cbor");
  });

  it("CS-05-02: negotiation falls back to compact-json when CBOR not mutual", () => {
    const result = negotiate(
      { cbor: true, compactJson: true },
      { cbor: false, compactJson: true }
    );
    expect(result.format).toBe("compact-json");
  });

  it("CS-05-03: negotiation falls back to json when neither compact supported", () => {
    const result = negotiate(
      { compactJson: false },
      { compactJson: false }
    );
    expect(result.format).toBe("json");
  });

  it("CS-05-04: compact-json codec roundtrips correctly", () => {
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      result: { tools: [{ name: "search", description: "Search docs" }] },
    };
    const codec = getCodec("compact-json");
    const encoded = codec.encode(payload);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(payload);
  });

  it("CS-05-05: compact-json encodes known keys to short forms", () => {
    const encoded = JSON.stringify(encodeCompact({ jsonrpc: "2.0", method: "tools/list" }));
    expect(encoded).toContain('"j"');
    expect(encoded).toContain('"m"');
    expect(encoded).not.toContain('"jsonrpc"');
    expect(encoded).not.toContain('"method"');
  });

  it("CS-05-06: encodeCompact/decodeCompact are inverses", () => {
    const original = {
      jsonrpc: "2.0",
      id: 42,
      result: {
        tools: [{ name: "foo", description: "bar" }],
      },
    };
    expect(decodeCompact(encodeCompact(original))).toEqual(original);
  });

  it("CS-05-07: unknown keys pass through compact encoding unchanged", () => {
    const out = encodeCompact({ custom_field: "value", nested: { other: 1 } }) as any;
    expect(out.custom_field).toBe("value");
    expect(out.nested.other).toBe(1);
  });

  it("CS-05-08: COMPACT_KEY_MAP has no collisions (all values unique)", () => {
    const values = Object.values(COMPACT_KEY_MAP);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("CS-05-09: json codec is a no-op (passthrough)", () => {
    const payload = { jsonrpc: "2.0", result: { tools: [] } };
    const codec = getCodec("json");
    const decoded = codec.decode(codec.encode(payload));
    expect(decoded).toEqual(payload);
  });

  it("CS-05-10: getCodec('cbor') returns a working codec (or compact-json fallback)", () => {
    // cbor-x may or may not be installed — either way codec must work
    const codec = getCodec("cbor");
    const payload = { test: true, value: 42 };
    const decoded = codec.decode(codec.encode(payload));
    expect(decoded).toEqual(payload);
  });
});
