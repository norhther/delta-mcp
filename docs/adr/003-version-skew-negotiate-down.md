# ADR-003: Negotiate Down on Protocol Version Skew

**Status**: Accepted
**Date**: 2026-06-10

## Context

Until now the server ignored the client's `protocolVersion` at `initialize`.
A `delta-mcp/2.x` client meeting a `delta-mcp/1.x` server would proceed with
silently undefined behavior — both sides assuming extensions the other may
have changed incompatibly.

Separately, two capabilities were advertised with no wire implementation
behind them (`encoding.schemaHashReferencing`, `codeExecution`). A capability
advertisement is a contract: a client seeing `schemaHashReferencing: true`
may legitimately send hash-referenced messages the server cannot handle.

## Decision

1. **Negotiate down, never hard-fail.** At `initialize`:
   - Non-delta versions (standard MCP date versions, absent field) →
     compatible; behavior stays capability-driven (ADR-001).
   - Delta versions with a matching major → full delta session.
   - Delta versions with an unknown major → server answers as a baseline MCP
     server: `protocolVersion` is the MCP baseline date, capabilities `{}`,
     plain-JSON encoding, full schemas from `tools/list`.
2. **Only advertise implemented capabilities.** `schemaHashReferencing` and
   `codeExecution` removed from default advertisements. Types and registry
   hash computation retained for future implementation.
3. **JSON-RPC notification semantics enforced.** Requests without `id` never
   receive a response (including errors). HTTP transport returns
   `202 Accepted` for notifications per MCP Streamable HTTP.

## Alternatives Considered

1. **Strict reject on unknown version**: explicit, but breaks the
   compatibility-first promise of ADR-001 and turns every future major bump
   into an ecosystem flag day.
2. **Ignore version (status quo)**: leaves skew behavior undefined exactly
   when it matters most — across major revisions.

## Consequences

- A future-major client always gets a working, standard-MCP-shaped session.
- Major version bumps are safe to ship server-side first.
- Conformance scenario CS-10 locks in all three behaviors.
