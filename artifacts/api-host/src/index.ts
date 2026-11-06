// Forwards every request to the single staging API container.
import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  API: DurableObjectNamespace<ApiContainer>;
  [key: string]: unknown;
}

/** Plain-text vars and secrets from the Worker, passed to the API process. */
function stringVars(env: Env): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") vars[key] = value;
  }
  return vars;
}

export class ApiContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "15m";
  envVars = { ...stringVars(this.env), PORT: "8080" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One named instance, so every request (and the API's in-memory state)
    // lands on the same container.
    return getContainer(env.API, "staging").fetch(request);
  },
} satisfies ExportedHandler<Env>;
