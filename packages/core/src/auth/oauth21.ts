/**
 * OAuth 2.1 resource-server role.
 *
 * MCP2 as resource-server: validate tokens, never issue them.
 * Returns HTTP 401 with WWW-Authenticate → client discovers AS via RFC 9728 PRM.
 *
 * Mandatory requirements (spec):
 * - PKCE S256 for all clients (enforced at AS — we verify proof of code_challenge)
 * - RFC 9728: Protected Resource Metadata
 * - RFC 8414: Authorization server metadata
 * - RFC 8707: resource indicators — token must be bound to this server's URL
 * - No implicit flow, no ROPC, no bearer in URI query strings
 */

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  resource_signing_alg_values_supported?: string[];
  resource_documentation?: string;
}

export interface TokenValidationResult {
  valid: boolean;
  subject?: string;
  scopes?: string[];
  clientId?: string;
  expiresAt?: Date;
  error?:
    | "expired"
    | "missing_expiry"
    | "invalid_audience"
    | "invalid_signature"
    | "introspection_failed";
}

export interface JwtHeader {
  alg: string;
  kid?: string;
}

export interface JwtPayload {
  sub?: string;
  aud?: string | string[];
  scope?: string;
  exp?: number;
  iat?: number;
  client_id?: string;
}

/** Build RFC 9728 Protected Resource Metadata document */
export function buildPRMDocument(
  resourceUrl: string,
  authorizationServers: string[],
  opts: { signingAlgs?: string[]; documentationUrl?: string } = {}
): ProtectedResourceMetadata {
  return {
    resource: resourceUrl,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ["header"],
    ...(opts.signingAlgs && { resource_signing_alg_values_supported: opts.signingAlgs }),
    ...(opts.documentationUrl && { resource_documentation: opts.documentationUrl }),
  };
}

/**
 * Build WWW-Authenticate header for 401 responses.
 * Client uses resource_metadata URL to discover auth servers (RFC 9728).
 */
export function buildWWWAuthenticate(
  resourceMetadataUrl: string,
  opts: { error?: string; errorDescription?: string } = {}
): string {
  let header = `Bearer realm="delta-mcp", resource_metadata="${resourceMetadataUrl}"`;
  if (opts.error) header += `, error="${opts.error}"`;
  if (opts.errorDescription) header += `, error_description="${opts.errorDescription}"`;
  return header;
}

/**
 * Validate a JWT bearer token.
 *
 * This is a structural validator — it checks format, expiry, and audience
 * without crypto verification. Wire up `verifySignature` for production use.
 *
 * RFC 8707: token aud must include resourceUrl (resource indicators).
 * Implicit flow + ROPC tokens are rejected by convention (no grant_type check here;
 * enforce at the AS level via PKCE requirement).
 */
export async function validateToken(
  token: string,
  resourceUrl: string,
  opts: {
    verifySignature?: (token: string, header: JwtHeader, payload: JwtPayload) => Promise<boolean>;
    introspectionEndpoint?: string;
    clientCredentials?: { id: string; secret: string };
    /**
     * Require an `exp` claim. Default true — a token without expiry never
     * expires, which a resource server should not silently accept. Set false
     * only when the AS genuinely issues exp-less tokens and revocation is
     * handled elsewhere (e.g. introspection).
     */
    requireExpiry?: boolean;
  } = {}
): Promise<TokenValidationResult> {
  // JWT structure check
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, error: "invalid_signature" };

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString()) as JwtHeader;
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as JwtPayload;
  } catch {
    return { valid: false, error: "invalid_signature" };
  }

  // Expiry check. `exp: 0` is a real (long-past) timestamp, so test for
  // presence with typeof, not truthiness.
  const hasExp = typeof payload.exp === "number";
  if (!hasExp && (opts.requireExpiry ?? true)) {
    return { valid: false, error: "missing_expiry" };
  }
  if (hasExp && payload.exp! < Math.floor(Date.now() / 1000)) {
    return { valid: false, error: "expired" };
  }

  // RFC 8707: audience must include this resource server's URL
  const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!aud.includes(resourceUrl)) {
    return { valid: false, error: "invalid_audience" };
  }

  // Signature verification (delegate to caller or introspection endpoint)
  if (opts.verifySignature) {
    const sigOk = await opts.verifySignature(token, header, payload);
    if (!sigOk) return { valid: false, error: "invalid_signature" };
  } else if (opts.introspectionEndpoint) {
    const introspected = await introspect(token, opts.introspectionEndpoint, opts.clientCredentials);
    if (!introspected) return { valid: false, error: "introspection_failed" };
  }

  return {
    valid: true,
    subject: payload.sub,
    scopes: payload.scope?.split(" ").filter(Boolean) ?? [],
    clientId: payload.client_id,
    expiresAt: payload.exp ? new Date(payload.exp * 1000) : undefined,
  };
}

/** RFC 7662 token introspection */
async function introspect(
  token: string,
  endpoint: string,
  credentials?: { id: string; secret: string }
): Promise<boolean> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (credentials) {
    headers["Authorization"] =
      "Basic " + Buffer.from(`${credentials.id}:${credentials.secret}`).toString("base64");
  }

  // Bounded: a hung AS must fail the token, not pin the request open until
  // the transport's own deadline.
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: `token=${encodeURIComponent(token)}&token_type_hint=access_token`,
      signal: AbortSignal.timeout(INTROSPECTION_TIMEOUT_MS),
    });
  } catch {
    return false;
  }

  if (!res.ok) return false;
  const body = (await res.json()) as { active?: boolean };
  return body.active === true;
}

const INTROSPECTION_TIMEOUT_MS = 10_000;

/**
 * Middleware factory: validates bearer token on every request.
 * Returns 401 with PRM discovery if missing or invalid.
 */
export function createTokenMiddleware(opts: {
  resourceUrl: string;
  resourceMetadataUrl: string;
  verifySignature?: (token: string, header: JwtHeader, payload: JwtPayload) => Promise<boolean>;
  introspectionEndpoint?: string;
  clientCredentials?: { id: string; secret: string };
}) {
  return async (
    authHeader: string | undefined
  ): Promise<{ ok: true; validation: TokenValidationResult } | { ok: false; status: 401; wwwAuthenticate: string }> => {
    if (!authHeader?.startsWith("Bearer ")) {
      return {
        ok: false,
        status: 401,
        wwwAuthenticate: buildWWWAuthenticate(opts.resourceMetadataUrl),
      };
    }

    const token = authHeader.slice(7);
    const validation = await validateToken(token, opts.resourceUrl, {
      verifySignature: opts.verifySignature,
      introspectionEndpoint: opts.introspectionEndpoint,
      clientCredentials: opts.clientCredentials,
    });

    if (!validation.valid) {
      return {
        ok: false,
        status: 401,
        wwwAuthenticate: buildWWWAuthenticate(opts.resourceMetadataUrl, {
          error: "invalid_token",
          errorDescription: validation.error ?? "Token validation failed",
        }),
      };
    }

    return { ok: true, validation };
  };
}

/** RFC 7591 Dynamic Client Registration request shape */
export interface DynamicClientRegistrationRequest {
  redirect_uris: string[];
  client_name?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
}

/** Client ID Metadata Document (for zero-friction onboarding) */
export interface ClientIdMetadata {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
}
