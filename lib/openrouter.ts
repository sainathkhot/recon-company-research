import type { OpenRouterModel } from "./types";
import { memo } from "./cache";

const BASE = "https://openrouter.ai/api/v1";

export const DEFAULT_MODEL = "openai/gpt-oss-20b:free";

/** Header values must be Latin-1 encodable, so anything else is stripped. */
const ascii = (v: string) => v.replace(/[^\x20-\xFF]/g, "");

function headers(override?: string) {
  // A key entered in the UI wins; the deployment's own key is the fallback.
  const key = override?.trim() || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured on the server.");
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": ascii(site),
    "X-Title": "Recon Company Research Assistant",
  };
}

/** Full OpenRouter catalogue, normalised and cached for an hour. */
export async function listModels(): Promise<OpenRouterModel[]> {
  return memo(
    "or:models",
    async () => {
      const res = await fetch(`${BASE}/models`, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) throw new Error(`OpenRouter models ${res.status}`);
      const json: any = await res.json();
      const models: OpenRouterModel[] = (json.data ?? [])
        .filter((m: any) => !/(whisper|tts|embed|stable-diffusion|flux)/i.test(m.id))
        .map((m: any) => {
          const p = Number(m.pricing?.prompt ?? 0);
          return {
            id: String(m.id),
            name: String(m.name ?? m.id),
            context: m.context_length ?? undefined,
            promptPrice: Number.isFinite(p) ? p : undefined,
            free: p === 0 || /:free$/.test(String(m.id)),
          };
        });
      models.sort((a, b) => a.name.localeCompare(b.name));
      return models;
    },
    60 * 60_000
  );
}

function stripFences(s: string): string {
  return s.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
}

/** Pull the outermost JSON object out of a chatty response. */
function carveJson(raw: string): any {
  const t = stripFences(raw);
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const slice = t.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // Last resort: models sometimes emit trailing commas.
      try {
        return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
      } catch {
        /* give up */
      }
    }
  }
  throw new Error("The model did not return valid JSON. Try a different model.");
}

async function call(model: string, messages: any[], jsonMode: boolean, timeoutMs: number, key?: string) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: headers(key),
      signal: ctl.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.25,
        max_tokens: 3000,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Ask the chosen model for a JSON object. Tries native JSON mode first and
 * silently retries without it, since not every OpenRouter model supports it.
 */
export async function completeJson(
  model: string,
  system: string,
  user: string,
  timeoutMs = 75_000,
  key?: string
): Promise<any> {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let res = await call(model, messages, true, timeoutMs, key);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("OpenRouter rejected the API key (401). Check OPENROUTER_API_KEY.");
    if (res.status === 402) throw new Error("OpenRouter credits exhausted for this model. Pick a free model.");
    if (res.status === 429) throw new Error("OpenRouter rate limit hit. Wait a moment or pick another model.");
    res = await call(model, messages, false, timeoutMs, key);
    if (!res.ok) {
      const b2 = await res.text().catch(() => body);
      throw new Error(`OpenRouter ${res.status}: ${b2.slice(0, 200)}`);
    }
  }

  const json: any = await res.json();
  if (json.error) throw new Error(String(json.error.message ?? json.error));
  const content: string = json.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("The model returned an empty response. Try a different model.");
  return carveJson(content);
}
