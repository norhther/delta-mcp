"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@mcp2/core");
(0, vitest_1.describe)("Result handler — Phase 5 conformance", () => {
    (0, vitest_1.it)("passes small results through unchanged", () => {
        const result = { items: [1, 2, 3] };
        (0, vitest_1.expect)((0, core_1.handleToolResult)(result)).toBe(result);
    });
    (0, vitest_1.it)("truncates strings exceeding maxTokens threshold", () => {
        const big = "x".repeat(10000);
        const out = (0, core_1.handleToolResult)(big, { maxTokens: 100 });
        (0, vitest_1.expect)(out.truncated).toBe(true);
        (0, vitest_1.expect)(out.totalChars).toBe(10000);
    });
    (0, vitest_1.it)("paginates large arrays", () => {
        const arr = Array.from({ length: 200 }, (_, i) => i);
        const out = (0, core_1.handleToolResult)(arr, { paginateAfter: 50 });
        (0, vitest_1.expect)(out.paginated).toBe(true);
        (0, vitest_1.expect)(out.items).toHaveLength(50);
        (0, vitest_1.expect)(out.totalItems).toBe(200);
    });
    (0, vitest_1.it)("rate limit becomes reasoner-friendly result, not error", () => {
        const rl = (0, core_1.handleRateLimit)(30, "github-api");
        (0, vitest_1.expect)(rl.type).toBe("rate_limited");
        (0, vitest_1.expect)(rl.retryAfterSeconds).toBe(30);
        (0, vitest_1.expect)(rl.upstream).toBe("github-api");
    });
});
