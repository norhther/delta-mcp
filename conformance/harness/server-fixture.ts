import { DeltaClient, StdioClientTransport } from "@delta-mcp/client";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const DEMO_SERVER = join(__dir, "../../packages/server/dist/demo.js");

export interface ServerFixture {
  client: DeltaClient;
  transport: StdioClientTransport;
  teardown: () => Promise<void>;
}

/** Spin up demo server, initialize client, return fixture for use in tests */
export async function createServerFixture(): Promise<ServerFixture> {
  const transport = new StdioClientTransport("node", [DEMO_SERVER]);
  const client = new DeltaClient(transport);
  await client.initialize();
  return {
    client,
    transport,
    teardown: () => transport.close(),
  };
}
