---
title: OAuth 2.1
description: Resource-server-only OAuth 2.1 with RFC 9728 PRM discovery and RFC 8707 audience binding.
---

Delta-MCP validates tokens, never issues them. Stateless by design — no session storage, no token issuance, no authorization server logic.

## Flow

```
Client → POST /mcp
Server → 401  WWW-Authenticate: Bearer resource_metadata="/.well-known/oauth-protected-resource"
Client → GET  /.well-known/oauth-protected-resource          (RFC 9728 PRM discovery)
Client → discovers AS, gets token via PKCE (mandatory, no implicit flow)
Client → POST /mcp  Authorization: Bearer <token>
Server → validates JWT audience (RFC 8707) + expiry + signature → processes request
```

## Full OAuth mode (production)

```typescript
server.startHttp({
  port: 3000,
  oauth: {
    resourceUrl: "https://mcp.example.com",         // must equal token `aud`
    authorizationServers: ["https://auth.example.com"],
    verifySignature: async (token) => verifyWithJwks(token),
  },
});
```

The transport:
- Serves the RFC 9728 PRM document at `/.well-known/oauth-protected-resource`
- Validates token audience (RFC 8707), expiry, and signature before calling your handler
- Returns spec-compliant `WWW-Authenticate` challenges with error reasons on rejection

## Presence-only mode (dev)

Without `oauth`, any non-empty bearer token passes. Dev-grade only — never use in production:

```typescript
server.startHttp({ port: 3000 });
```

Narrow it without full PRM machinery via `validateToken`:

```typescript
server.startHttp({
  port: 3000,
  validateToken: async (token) => mySessionLookup(token),
});
```

Explicitly open server (no auth at all):

```typescript
server.startHttp({ port: 3000, authRequired: false });
```

## MCP-Protocol-Version header

The `MCP-Protocol-Version` header is required on all HTTP requests _except_ `initialize`. The client doesn't know the version until the handshake completes, so the header is exempt on that one call.

## See also

- [HTTP + OAuth example](/delta-mcp/examples/http-oauth-server/)
- [Conformance CS-06 and CS-09](/delta-mcp/reference/conformance/)
