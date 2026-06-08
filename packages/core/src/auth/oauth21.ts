/**
 * OAuth 2.1 resource-server role implementation.
 *
 * MCP2 acts as resource-server only — validates tokens, never issues them.
 * Keeps the server stateless and scalable.
 *
 * Spec requirements:
 * - PKCE mandatory (S256) for all clients
 * - RFC 9728: Protected Resource Metadata for discovery
 * - RFC 8414: Authorization server metadata
 * - RFC 8707: Resource indicators (token bound to specific server)
 * - No implicit flow, no ROPC, no bearer in URI query strings
 */

export interface ProtectedResourceMetadata {
  resource: string;                    // RFC 9728 resource identifier
  authorization_servers: string[];     // RFC 8414 AS discovery URLs
  bearer_methods_supported: string[];  // ["header"] — no query string
  resource_signing_alg_values_supported?: string[];
}

export interface TokenValidationResult {
  valid: boolean;
  subject?: string;
  scopes?: string[];
  error?: string;
}

export function buildPRMDocument(
  resourceUrl: string,
  authorizationServers: string[]
): ProtectedResourceMetadata {
  return {
    resource: resourceUrl,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ["header"], // RFC 8707 — no URI query strings
  };
}

/**
 * Build WWW-Authenticate header for 401 responses.
 * Clients use resource_metadata URL to discover auth servers (RFC 9728).
 */
export function buildWWWAuthenticate(resourceMetadataUrl: string): string {
  return `Bearer realm="mcp2", resource_metadata="${resourceMetadataUrl}"`;
}

/**
 * Validate bearer token against introspection endpoint or local JWKS.
 * Stub — wire up to your AS's introspection endpoint or JWT validation.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function validateToken(
  token: string,
  resourceUrl: string
): Promise<TokenValidationResult> {
  void token; void resourceUrl;
  // TODO Phase 3: implement JWT validation or AS introspection
  // Must verify: aud matches resourceUrl (RFC 8707 resource indicators)
  throw new Error("Not implemented — Phase 3");
}
