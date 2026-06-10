---
title: HTTP + OAuth Server
description: Delta-MCP over Streamable HTTP with full OAuth 2.1 resource-server mode — RS256 tokens, RFC 9728 PRM discovery, RFC 8707 audience binding.
---

A Delta-MCP server over Streamable HTTP running as a full OAuth 2.1 **resource server**: it serves the RFC 9728 PRM document, validates bearer tokens (audience + expiry + signature), and emits spec-compliant `WWW-Authenticate` challenges.

Self-contained — generates an RSA keypair at boot and verifies RS256 tokens against it, standing in for a real authorization server's JWKS. Zero external dependencies.

## Run

```bash
npx tsx examples/http-oauth-server/index.ts
```

The server prints `curl` commands for the full discovery dance.

## Flow

```
1. POST /mcp  (no token)               → 401  WWW-Authenticate: ... resource_metadata=...
2. GET  /.well-known/oauth-protected-resource  → 200  { resource, authorization_servers, ... }
3. POST /mcp  Authorization: Bearer <valid>    → 200
4. POST /mcp  Authorization: Bearer <wrong aud> → 401  error="invalid_token" (RFC 8707)
```

## Production

Replace `verifySignature` with a JWKS-backed verifier pointed at your real authorization server:

```typescript
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(
  new URL("https://auth.example.com/.well-known/jwks.json")
);

server.startHttp({
  port: 3000,
  oauth: {
    resourceUrl: "https://mcp.example.com",
    authorizationServers: ["https://auth.example.com"],
    verifySignature: async (token) => {
      try {
        await jwtVerify(token, jwks, { audience: "https://mcp.example.com" });
        return true;
      } catch {
        return false;
      }
    },
  },
});
```

Delta-MCP still enforces audience + expiry independently; `verifySignature` adds the cryptographic proof.

[View on GitHub →](https://github.com/norhther/delta-mcp/tree/main/examples/http-oauth-server/)

## See also

- [OAuth 2.1 — how it works](/delta-mcp/how-it-works/oauth/)
- [Filesystem server](/delta-mcp/examples/filesystem-server/) for a simpler HTTP server without auth
