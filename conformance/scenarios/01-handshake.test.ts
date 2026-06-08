/**
 * Conformance: Initialize handshake
 * Verifies: protocol version negotiation, capability exchange, initialized notification
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServerFixture, type ServerFixture } from "../harness/server-fixture.js";
import { MCP2_PROTOCOL_VERSION } from "@mcp2/core";

describe("CS-01: Initialize handshake", () => {
  let fx: ServerFixture;
  beforeAll(async () => { fx = await createServerFixture(); });
  afterAll(async () => { await fx.teardown(); });

  it("CS-01-01: server returns protocolVersion", () => {
    expect(fx.client.sessionInfo.protocolVersion).toBe(MCP2_PROTOCOL_VERSION);
  });

  it("CS-01-02: server returns serverInfo.name and serverInfo.version", () => {
    expect(fx.client.sessionInfo.serverName).toBeTruthy();
    expect(fx.client.sessionInfo.serverVersion).toBeTruthy();
  });

  it("CS-01-03: server advertises progressive disclosure capability", () => {
    expect(fx.client.sessionInfo.capabilities.tools?.progressiveDisclosure).toBe(true);
    expect(fx.client.sessionInfo.progressiveDisclosure).toBe(true);
  });

  it("CS-01-04: server advertises encoding capabilities", () => {
    const enc = fx.client.sessionInfo.capabilities.encoding;
    expect(enc?.compactJson).toBe(true);
    expect(enc?.schemaHashReferencing).toBe(true);
  });
});
