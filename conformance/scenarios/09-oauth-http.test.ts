/**
 * Conformance: OAuth 2.1 end-to-end over HTTP transport.
 *
 * CS-06 tests the OAuth primitives in isolation. This scenario drives the full
 * RFC 9728 discovery dance against a live HTTP server: 401 → PRM document →
 * authenticated request, plus rejection of wrong-audience and expired tokens.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import {
  createHttpHandler,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ProtectedResourceMetadata,
} from "@delta-mcp/core";

const AS_URL = "https://auth.example.com";

const echo = async (msg: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
  if (msg.method === "notifications/initialized") return null;
  return { jsonrpc: "2.0", id: (msg.id ?? null) as JsonRpcResponse["id"], result: { ok: true } };
};

/** Build an unsigned-but-structurally-valid JWT for tests. */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = Buffer.from("testsig").toString("base64url");
  return `${header}.${body}.${sig}`;
}

describe("CS-09-00: OAuth misconfiguration fails loudly", () => {
  it("createHttpHandler throws when oauth has neither verifySignature nor introspectionEndpoint", () => {
    // Without one of the two, tokens are only structurally checked — anyone can
    // forge an unsigned JWT with the right `aud`. Refuse to start that way.
    expect(() =>
      createHttpHandler(echo, {
        oauth: {
          resourceUrl: "https://mcp.example.com",
          authorizationServers: [AS_URL],
        },
      })
    ).toThrow(/verifySignature|introspectionEndpoint/);
  });
});

describe("CS-09: OAuth 2.1 end-to-end over HTTP", () => {
  let server: Server;
  let url: string;
  let resourceUrl: string;
  // Indirection so beforeAll can build the handler after the listen port is known.
  let handlerRef: (req: import("http").IncomingMessage, res: import("http").ServerResponse) => void =
    () => {};

  beforeAll(async () => {
    // Stand the server up first, then derive its own URL so the PRM `resource`
    // and the token `aud` agree (RFC 8707 audience binding).
    server = createServer((req, res) => void handlerRef(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    url = `http://127.0.0.1:${port}`;
    resourceUrl = url;

    const handler = createHttpHandler(echo, {
      oauth: {
        resourceUrl,
        authorizationServers: [AS_URL],
        // Accept any structurally valid signature; audience/expiry still enforced.
        verifySignature: async () => true,
      },
    });
    handlerRef = (req, res) => void handler(req, res);
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("CS-09-01: unauthenticated POST returns 401 pointing at the PRM", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain("Bearer");
    expect(wwwAuth).toContain("resource_metadata=");
    expect(wwwAuth).toContain("/.well-known/oauth-protected-resource");
  });

  it("CS-09-02: PRM document is served and is RFC 9728 valid", async () => {
    const res = await fetch(`${url}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const prm = (await res.json()) as ProtectedResourceMetadata;
    expect(prm.resource).toBe(resourceUrl);
    expect(prm.authorization_servers).toContain(AS_URL);
    expect(prm.bearer_methods_supported).toContain("header");
  });

  it("CS-09-03: valid token (correct audience, good signature) is accepted", async () => {
    const token = makeJwt({ sub: "user1", aud: resourceUrl, exp: Math.floor(Date.now() / 1000) + 3600 });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as JsonRpcResponse;
    expect((body.result as { ok: boolean }).ok).toBe(true);
  });

  it("CS-09-04: wrong-audience token is rejected (RFC 8707)", async () => {
    const token = makeJwt({ sub: "user1", aud: "https://other.example.com", exp: Math.floor(Date.now() / 1000) + 3600 });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain('error="invalid_token"');
  });

  it("CS-09-05: expired token is rejected with a reason", async () => {
    const token = makeJwt({ sub: "user1", aud: resourceUrl, exp: Math.floor(Date.now() / 1000) - 3600 });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "initialize" }),
    });
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain('error="invalid_token"');
    expect(wwwAuth.toLowerCase()).toContain("expired");
  });
});
