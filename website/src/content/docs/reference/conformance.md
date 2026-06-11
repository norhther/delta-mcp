---
title: Conformance Suite
description: 114 tests across 13 scenarios locking in Delta-MCP protocol correctness, token efficiency, OAuth, and HTTP hardening.
---

The conformance suite lives in `conformance/` and runs as a standalone Vitest project against live server instances.

## Run

```bash
cd conformance && npm test
```

## Scenarios

| ID | Scenario | Tests | What it verifies |
|----|----------|-------|-----------------|
| CS-01 | Initialize handshake | 5 | Protocol version, capability exchange, compact-JSON negotiation |
| CS-02 | Progressive disclosure | 7 | `tools/list` returns only names + descriptions; `tools/describe` returns full schema |
| CS-03 | Tool call | 8 | Invocation, unknown tool handling, `isError` execution results |
| CS-04 | Result handler | 12 | Truncation, pagination, object summarization, rate-limit handling |
| CS-05 | Wire encoding | 14 | Compact-JSON key shortening, CBOR negotiation, fallback to plain JSON |
| CS-06 | OAuth 2.1 primitives | 16 | PRM document, `WWW-Authenticate`, JWT audience + expiry, opaque-token introspection |
| CS-07 | Benchmark | 8 | ≥78% token reduction on 6-tool server, confirms numbers in docs |
| CS-08 | HTTP transport | 5 | Streamable HTTP compliance, version header exemption, codec round-trip |
| CS-09 | OAuth 2.1 end-to-end | 7 | 401 → PRM discovery → authenticated call over HTTP, RS256, public PRM CORS |
| CS-10 | Protocol soundness | 5 | Version skew negotiation, notification semantics, 202 for notifications |
| CS-11 | HTTP hardening | 15 | Body limit (413), rate limit (429), timeout (504), Origin (403), version validation (400) |
| CS-12 | Official SDK compatibility | 8 | Standard `@modelcontextprotocol/sdk` clients get full schemas, tools capability, `isError` |
| CS-13 | HTTP session isolation | 4 | `Mcp-Session-Id`, concurrent delta + standard clients without cross-talk |

## Conformance assertions (selected)

### CS-01 — Handshake

- `CS-01-01`: server returns `protocolVersion`
- `CS-01-03`: server advertises `progressiveDisclosure: true`
- `CS-01-04`: server advertises `compactJson: true`; does **not** advertise `schemaHashReferencing` (not yet implemented)
- `CS-01-05`: stdio handshake negotiates compact-JSON

### CS-02 — Progressive disclosure

- `CS-02-01`: `tools/list` response contains only `name` and `description` (no `inputSchema`)
- `CS-02-02`: `tools/describe` returns full `inputSchema`
- `CS-02-03`: description capped at 60 characters (server enforces at registration)

### CS-04 — Result handler

- `CS-04-01`: string over token budget returns `{ truncated: true, preview, totalChars, estimatedTokens }`
- `CS-04-04`: array over page size returns `{ paginated: true, items, page, totalPages, hasMore }`
- `CS-04-08`: object over token budget returns `{ _summarized: true, _totalKeys, ... }`
- `CS-04-11`: 429 thrown by tool returns `{ type: "rate_limited", retryAfterSeconds, upstream }`

### CS-06 — OAuth 2.1

- `CS-06-01`: PRM document contains `resource`, `authorization_servers`, `bearer_methods_supported: ["header"]`
- `CS-06-03`: `WWW-Authenticate` header contains `realm` and `resource_metadata`
- `CS-06-06`: expired token rejected
- `CS-06-07`: wrong audience rejected (RFC 8707)

### CS-07 — Benchmark

- `CS-07-01`: progressive disclosure achieves ≥78% token reduction vs standard MCP
- `CS-07-04`: single-tool usage achieves 100% schema overhead elimination

## Architecture

The harness (`conformance/harness/server-fixture.ts`) spawns a real `delta-mcp-demo` server as a child process and connects via `DeltaClient`. Tests run against the live stack — no mocks, no stubs.

This catches integration failures that unit tests miss (transport serialization bugs, encoding negotiation edge cases, OAuth header parsing).
