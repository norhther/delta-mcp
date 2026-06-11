/**
 * Conformance: OAuth 2.1 resource-server (Phase 3)
 * Verifies: PRM document structure, WWW-Authenticate header, JWT validation logic
 */
import { describe, it, expect } from "vitest";
import { createServer } from "http";
import {
  buildPRMDocument,
  buildWWWAuthenticate,
  validateToken,
} from "@delta-mcp/core";

const RESOURCE_URL = "https://mcp2.example.com";
const AS_URL = "https://auth.example.com";
const PRM_URL = `${RESOURCE_URL}/.well-known/oauth-protected-resource`;

describe("CS-06: OAuth 2.1 resource-server", () => {
  // ── PRM document ─────────────────────────────────────────────────────────

  it("CS-06-01: PRM document has required RFC 9728 fields", () => {
    const prm = buildPRMDocument(RESOURCE_URL, [AS_URL]);
    expect(prm.resource).toBe(RESOURCE_URL);
    expect(prm.authorization_servers).toContain(AS_URL);
    expect(prm.bearer_methods_supported).toContain("header");
    // Must NOT contain query string bearer method
    expect(prm.bearer_methods_supported).not.toContain("query");
  });

  it("CS-06-02: PRM document accepts optional fields", () => {
    const prm = buildPRMDocument(RESOURCE_URL, [AS_URL], {
      signingAlgs: ["RS256", "ES256"],
      documentationUrl: "https://mcp2.example.com/docs",
    });
    expect(prm.resource_signing_alg_values_supported).toEqual(["RS256", "ES256"]);
    expect(prm.resource_documentation).toBe("https://mcp2.example.com/docs");
  });

  // ── WWW-Authenticate header ───────────────────────────────────────────────

  it("CS-06-03: WWW-Authenticate header contains realm and resource_metadata", () => {
    const header = buildWWWAuthenticate(PRM_URL);
    expect(header).toContain('Bearer realm="delta-mcp"');
    expect(header).toContain(`resource_metadata="${PRM_URL}"`);
  });

  it("CS-06-04: WWW-Authenticate header includes error fields when provided", () => {
    const header = buildWWWAuthenticate(PRM_URL, {
      error: "invalid_token",
      errorDescription: "Token expired",
    });
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain('error_description="Token expired"');
  });

  // ── JWT validation ────────────────────────────────────────────────────────

  it("CS-06-05: rejects non-JWT tokens (wrong structure)", async () => {
    const result = await validateToken("not.a.jwt.at.all", RESOURCE_URL);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("invalid_signature");
  });

  it("CS-06-06: rejects expired tokens (RFC 8707)", async () => {
    // Build a JWT with exp in the past — no signature verification needed for expiry check
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "user1",
      aud: RESOURCE_URL,
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    })).toString("base64url");
    const sig = Buffer.from("fakesig").toString("base64url");

    const result = await validateToken(`${header}.${payload}.${sig}`, RESOURCE_URL);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("expired");
  });

  it("CS-06-07: rejects tokens where aud does not match resource URL (RFC 8707)", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "user1",
      aud: "https://other-server.example.com", // wrong audience
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const sig = Buffer.from("fakesig").toString("base64url");

    const result = await validateToken(`${header}.${payload}.${sig}`, RESOURCE_URL);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("invalid_audience");
  });

  it("CS-06-08: accepts structurally valid token with correct aud (no sig check)", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "user42",
      aud: RESOURCE_URL,
      scope: "tools:read tools:call",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const sig = Buffer.from("fakesig").toString("base64url");

    // No verifySignature provided → structural check only
    const result = await validateToken(`${header}.${payload}.${sig}`, RESOURCE_URL);
    expect(result.valid).toBe(true);
    expect(result.subject).toBe("user42");
    expect(result.scopes).toContain("tools:read");
    expect(result.scopes).toContain("tools:call");
  });

  it("CS-06-09: aud array containing resource URL is accepted", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "u1",
      aud: [RESOURCE_URL, "https://other.example.com"], // array aud
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const sig = Buffer.from("fakesig").toString("base64url");

    const result = await validateToken(`${header}.${payload}.${sig}`, RESOURCE_URL);
    expect(result.valid).toBe(true);
  });

  it("CS-06-11: rejects tokens without an exp claim by default", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "u1",
      aud: RESOURCE_URL, // no exp — must not be accepted as a never-expiring token
    })).toString("base64url");
    const sig = Buffer.from("fakesig").toString("base64url");

    const result = await validateToken(`${header}.${payload}.${sig}`, RESOURCE_URL);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("missing_expiry");
  });

  it("CS-06-12: requireExpiry: false opts back into exp-less tokens", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "u1", aud: RESOURCE_URL })).toString("base64url");
    const sig = Buffer.from("fakesig").toString("base64url");

    const result = await validateToken(`${header}.${payload}.${sig}`, RESOURCE_URL, {
      requireExpiry: false,
    });
    expect(result.valid).toBe(true);
  });

  // ── Opaque tokens via RFC 7662 introspection ─────────────────────────────

  function startIntrospectionAS(answer: Record<string, unknown>): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const server = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(answer));
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as { port: number };
        resolve({
          url: `http://127.0.0.1:${port}/introspect`,
          close: () => new Promise((r) => server.close(() => r())),
        });
      });
    });
  }

  it("CS-06-13: opaque (non-JWT) token is accepted via introspection", async () => {
    // RFC 7662 exists for tokens that cannot be parsed locally — an opaque
    // token must reach the introspection endpoint, not die on JWT parsing.
    const as = await startIntrospectionAS({
      active: true,
      sub: "user7",
      aud: RESOURCE_URL,
      scope: "tools:call",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    try {
      const result = await validateToken("opaque-token-abc123", RESOURCE_URL, {
        introspectionEndpoint: as.url,
      });
      expect(result.valid).toBe(true);
      expect(result.subject).toBe("user7");
      expect(result.scopes).toContain("tools:call");
    } finally {
      await as.close();
    }
  });

  it("CS-06-14: opaque token the AS reports inactive is rejected", async () => {
    const as = await startIntrospectionAS({ active: false });
    try {
      const result = await validateToken("opaque-revoked", RESOURCE_URL, {
        introspectionEndpoint: as.url,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("introspection_failed");
    } finally {
      await as.close();
    }
  });

  it("CS-06-15: opaque token with mismatched introspected aud is rejected (RFC 8707)", async () => {
    const as = await startIntrospectionAS({ active: true, aud: "https://other.example.com" });
    try {
      const result = await validateToken("opaque-wrong-aud", RESOURCE_URL, {
        introspectionEndpoint: as.url,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("invalid_audience");
    } finally {
      await as.close();
    }
  });

  it("CS-06-16: opaque token without introspection configured is rejected", async () => {
    const result = await validateToken("opaque-no-introspection", RESOURCE_URL);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("invalid_signature");
  });

  it("CS-06-10: custom verifySignature hook is called", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "u1",
      aud: RESOURCE_URL,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const sig = Buffer.from("fakesig").toString("base64url");
    const token = `${header}.${payload}.${sig}`;

    let hookCalled = false;
    const result = await validateToken(token, RESOURCE_URL, {
      verifySignature: async () => { hookCalled = true; return false; },
    });

    expect(hookCalled).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("invalid_signature");
  });
});
