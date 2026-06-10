---
title: "ADR-003: Negotiate Down on Protocol Version Skew"
description: How Delta-MCP handles major version mismatches at initialize without hard failures.
---

**Status**: Accepted — 2026-06-10

## Context

Until this ADR, the server ignored the client's `protocolVersion` at `initialize`. A `delta-mcp/2.x` client meeting a `delta-mcp/1.x` server would proceed with silently undefined behavior — both sides assuming extensions the other may have changed incompatibly.

Separately, two capabilities were advertised with no wire implementation behind them (`encoding.schemaHashReferencing`, `codeExecution`). A capability advertisement is a contract: a client seeing `schemaHashReferencing: true` may legitimately send hash-referenced messages the server cannot handle.

## Decision

**1. Negotiate down, never hard-fail.** At `initialize`:

| Client version | Server behavior |
|----------------|----------------|
| Non-delta (standard MCP date version, absent field) | Compatible; capability-driven behavior per ADR-001 |
| Delta version with matching major | Full delta session |
| Delta version with unknown major | Server answers as baseline MCP: date `protocolVersion`, empty capabilities, plain-JSON encoding, full schemas from `tools/list` |

**2. Only advertise implemented capabilities.** `schemaHashReferencing` and `codeExecution` removed from default advertisements. Types and registry hash computation are retained for future implementation.

**3. JSON-RPC notification semantics enforced.** Requests without `id` never receive a response (including errors). HTTP transport returns `202 Accepted` for notifications per MCP Streamable HTTP spec.

## Alternatives considered

| Option | Rejected because |
|--------|-----------------|
| Strict reject on unknown version | Breaks the compatibility-first promise of ADR-001; turns every future major bump into an ecosystem flag day |
| Ignore version (status quo) | Leaves skew behavior undefined exactly when it matters most — across major revisions |

## Consequences

- A future-major client always gets a working, standard-MCP-shaped session
- Major version bumps are safe to ship server-side first
- Conformance scenario CS-10 locks in all three behaviors

## See also

- [ADR-001: Do Not Fork JSON-RPC 2.0](/delta-mcp/reference/adr/001-no-fork-jsonrpc/)
- [Conformance Suite](/delta-mcp/reference/conformance/) — CS-10 covers version skew
