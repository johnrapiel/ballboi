import { AGENT_TOOLS, type ModelDecision, type ModerationModel } from "./agent";

// Claude via the Anthropic Messages API, with the agent's four tools and a
// forced tool call. Uses fetch, so there's no SDK to install. Key:
// ANTHROPIC_API_KEY in .env locally and Cloudflare secrets in production.

export const DEFAULT_AGENT_MODEL = "claude-sonnet-5-5";
const TOOL_NAMES = new Set<string>(AGENT_TOOLS.map((t) => t.name));

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class AnthropicModerationModel implements ModerationModel {
  constructor(
    private apiKey: string,
    readonly model: string = DEFAULT_AGENT_MODEL,
    private fetchImpl: Fetch = (url, init) => fetch(url, init),
  ) {}

  async decide(prompt: { system: string; user: string }): Promise<ModelDecision> {
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: prompt.system,
        tools: AGENT_TOOLS,
        // Exactly one of the four tools; never free text.
        tool_choice: { type: "any", disable_parallel_tool_use: true },
        messages: [{ role: "user", content: prompt.user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; name?: string; input?: Record<string, unknown> }[] };
    const call = body.content?.find((b) => b.type === "tool_use" && typeof b.name === "string" && TOOL_NAMES.has(b.name));
    // No usable tool call: escalate, the safe default.
    if (!call) return { tool: "escalate", input: { reason: "The agent didn't return a decision." } };
    return { tool: call.name as ModelDecision["tool"], input: call.input ?? {} };
  }
}
