"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@mcp2/core");
(0, vitest_1.describe)("Progressive disclosure — Phase 2 conformance", () => {
    (0, vitest_1.it)("rejects descriptions > 60 chars", () => {
        const reg = new core_1.ProgressiveToolRegistry();
        (0, vitest_1.expect)(() => reg.register({
            name: "bad_tool",
            description: "This description is way too long and exceeds the sixty character limit",
            inputSchema: { type: "object", properties: {} },
        })).toThrow(/60 chars/);
    });
    (0, vitest_1.it)("listSummaries returns only name+description, not full schema", () => {
        const reg = new core_1.ProgressiveToolRegistry();
        reg.register({
            name: "search",
            description: "Search docs and return top results",
            inputSchema: { type: "object", properties: { q: { type: "string" } } },
        });
        const summaries = reg.listSummaries();
        (0, vitest_1.expect)(summaries).toHaveLength(1);
        (0, vitest_1.expect)(summaries[0]).toEqual({ name: "search", description: "Search docs and return top results" });
        (0, vitest_1.expect)(summaries[0].inputSchema).toBeUndefined();
    });
    (0, vitest_1.it)("describe returns full schema on demand", () => {
        const reg = new core_1.ProgressiveToolRegistry();
        const tool = {
            name: "search",
            description: "Search docs and return top results",
            inputSchema: { type: "object", properties: { q: { type: "string" } } },
        };
        reg.register(tool);
        const full = reg.describe("search");
        (0, vitest_1.expect)(full?.inputSchema).toBeDefined();
    });
    (0, vitest_1.it)("schema hashes are stable and unique", () => {
        const reg = new core_1.ProgressiveToolRegistry();
        reg.register({ name: "a", description: "Tool A — first example tool", inputSchema: { type: "object" } });
        reg.register({ name: "b", description: "Tool B — second example tool", inputSchema: { type: "string" } });
        (0, vitest_1.expect)(reg.schemaHash("a")).toHaveLength(8);
        (0, vitest_1.expect)(reg.schemaHash("a")).not.toBe(reg.schemaHash("b"));
        // Stability: same schema → same hash
        const reg2 = new core_1.ProgressiveToolRegistry();
        reg2.register({ name: "a", description: "Tool A — first example tool", inputSchema: { type: "object" } });
        (0, vitest_1.expect)(reg2.schemaHash("a")).toBe(reg.schemaHash("a"));
    });
});
