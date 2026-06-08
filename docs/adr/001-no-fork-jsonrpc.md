# ADR-001: Do Not Fork JSON-RPC 2.0

**Status**: Accepted  
**Date**: 2026-06-08

## Context

MCP2 targets 78%+ input token reduction. The naive approach is to invent a new binary protocol. The risk: breaking compatibility with 97M+ monthly downloads of the MCP ecosystem.

## Decision

Keep JSON-RPC 2.0 as the wire envelope. All MCP2 improvements (progressive disclosure, compact encoding, result handling) are implemented as:
1. Negotiated capabilities at `initialize`
2. New optional methods (`tools/describe`)
3. Optional encoding negotiated at handshake

Standard MCP clients that don't negotiate MCP2 capabilities receive standard MCP behavior.

## Consequences

- Full backward compatibility with existing MCP servers and clients
- MCP2 capabilities can be submitted as an MCP Extension (2026-07-28 Extensions framework)
- Slightly more complexity in server: must handle both modes
- Cannot use binary-only optimizations without JSON fallback
