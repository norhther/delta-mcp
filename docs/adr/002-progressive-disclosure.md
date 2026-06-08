# ADR-002: Progressive Disclosure as Default Tool Loading Strategy

**Status**: Accepted  
**Date**: 2026-06-08

## Context

Standard MCP loads all tool schemas at `initialize`. With 10 tools averaging 1K tokens each, that's 10K tokens before the agent does any work. Enterprise agents connecting to dozens of servers with thousands of tools make this unworkable.

## Decision

Default to progressive disclosure:
- `tools/list` returns names + ≤60-char descriptions only (~600 tokens total regardless of tool count)
- `tools/describe` returns full schema on demand
- Description cap is enforced at registration time (hard error if exceeded)

The 60-char cap is based on Anthropic research: truncated descriptions maintain tool-selection accuracy. Longer descriptions paradoxically *decrease* accuracy and increase execution steps by 67%.

## Alternatives Considered

1. **Lazy loading by category**: Group tools, load by category. Rejected — adds taxonomy overhead.
2. **Dynamic schema injection**: Inject schemas as model requests them mid-conversation. Harder to implement, same net effect.
3. **LLM-driven tool summarization**: Auto-summarize long descriptions. Rejected — non-deterministic, adds latency.

## Consequences

- 85-95% reduction in tool-definition overhead
- Tool authors must write terse descriptions (good hygiene anyway)
- Clients must implement `tools/describe` round-trip for full schema
- Adds one round-trip latency the first time a tool is used (acceptable)
