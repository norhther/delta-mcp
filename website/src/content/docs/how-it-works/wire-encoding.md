---
title: Wire Encoding
description: Compact-JSON and CBOR encoding negotiated at initialize for smaller payloads.
---

Delta-MCP negotiates a wire encoding at `initialize`. Both sides switch codecs after the handshake — the `initialize` response itself is always plain JSON so the client can read it before the switch.

## Compact-JSON

Key names are shortened to single characters:

```
Standard: {"jsonrpc":"2.0","method":"tools/list","result":{"tools":[...]}}
Compact:  {"j":"2.0","m":"tools/list","r":{"t":[...]}}
```

Compact-JSON reduces payload size by **18.7%** on a 6-tool `tools/list` response. No behavior change — just shorter keys on the wire.

## CBOR (HTTP only)

Binary encoding available over HTTP via the optional `cbor-x` dependency. Stdio clamps to compact-JSON because CBOR is binary and cannot be safely newline-delimited.

The HTTP transport decodes requests by `Content-Type` and encodes responses by the client's `Accept` header.

## Negotiation flow

Client advertises encoding capabilities at `initialize`:

```typescript
// client sends:
capabilities: {
  encoding: { compactJson: true, cbor: true }
}

// server echoes the negotiated format:
{
  encoding: { format: "compact-json" }
}
```

Both sides switch to the negotiated codec for all subsequent messages. The `initialize` exchange itself stays in plain JSON so neither side needs to guess the codec before the handshake completes.

## Fallback

Clients that don't advertise encoding capabilities receive standard JSON — fully compatible with the MCP 2025-11-25 baseline. No configuration required on either side.
