/**
 * Delta-MCP over HTTP with full OAuth 2.1 resource-server mode.
 *
 * Self-contained and runnable with zero external dependencies — it generates an
 * RSA keypair at boot and verifies RS256 tokens against it, standing in for a
 * real authorization server's JWKS. In production you'd replace `verifySignature`
 * with a JWKS-backed verifier (e.g. `jose`'s createRemoteJWKSet) pointed at your AS.
 *
 * Run it, then follow the printed curl commands to walk the discovery dance:
 *   401 → PRM document → authenticated tool call.
 */
import {
  generateKeyPairSync,
  createSign,
  createVerify,
  type KeyObject,
} from "crypto";
import { DeltaServer } from "@delta-mcp/server";

const PORT = 3000;
const RESOURCE_URL = `http://127.0.0.1:${PORT}`;
const AS_URL = "https://auth.example.com"; // advertised in the PRM; not contacted here

// ── Stand-in authorization server: RSA keypair + RS256 sign/verify ───────────

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const b64url = (input: object | Buffer): string =>
  (Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input))).toString("base64url");

/** Mint an RS256 JWT — the kind a real AS would hand the client after PKCE. */
function mintToken(privKey: KeyObject, audience: string, ttlSeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const payload = b64url({ sub: "demo-user", aud: audience, iat: now, exp: now + ttlSeconds, scope: "mcp:tools" });
  const signingInput = `${header}.${payload}`;
  const sig = createSign("RSA-SHA256").update(signingInput).end().sign(privKey).toString("base64url");
  return `${signingInput}.${sig}`;
}

/** Verify the RS256 signature against our public key. */
function verifyRs256(token: string, pubKey: KeyObject): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [header, payload, sig] = parts as [string, string, string];
  return createVerify("RSA-SHA256")
    .update(`${header}.${payload}`)
    .end()
    .verify(pubKey, Buffer.from(sig, "base64url"));
}

// ── The MCP server ───────────────────────────────────────────────────────────

class OAuthDemoServer extends DeltaServer {
  constructor() {
    super({ name: "delta-mcp-oauth-demo", version: "0.2.1" });

    this.tool({
      name: "whoami",
      description: "Return the caller identity from the validated token", // ≤60 chars
      inputSchema: { type: "object", properties: {} },
    });
  }

  protected async callTool(name: string): Promise<unknown> {
    if (name === "whoami") return { authenticated: true, subject: "demo-user" };
    throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new OAuthDemoServer();
server.startHttp({
  port: PORT,
  oauth: {
    resourceUrl: RESOURCE_URL,
    authorizationServers: [AS_URL],
    // Audience + expiry are enforced before this runs; here we add signature proof.
    verifySignature: async (token) => verifyRs256(token, publicKey),
  },
});

// ── Print a walkthrough the user can paste into a terminal ────────────────────

const validToken = mintToken(privateKey, RESOURCE_URL);
const wrongAudToken = mintToken(privateKey, "https://other.example.com");

/* eslint-disable no-console */
console.log(`
Delta-MCP OAuth demo server listening on ${RESOURCE_URL}

1) Unauthenticated call → 401 pointing at the PRM:
   curl -i -X POST ${RESOURCE_URL} \\
     -H 'Content-Type: application/json' \\
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

2) Follow the challenge → fetch the Protected Resource Metadata (RFC 9728):
   curl -s ${RESOURCE_URL}/.well-known/oauth-protected-resource | jq

3) Authenticated call with a valid token → 200:
   curl -i -X POST ${RESOURCE_URL} \\
     -H 'Content-Type: application/json' \\
     -H 'Authorization: Bearer ${validToken}' \\
     -d '{"jsonrpc":"2.0","id":2,"method":"initialize"}'

4) Wrong-audience token → 401 invalid_token (RFC 8707):
   curl -i -X POST ${RESOURCE_URL} \\
     -H 'Content-Type: application/json' \\
     -H 'Authorization: Bearer ${wrongAudToken}' \\
     -d '{"jsonrpc":"2.0","id":3,"method":"initialize"}'

Ctrl-C to stop.
`);
