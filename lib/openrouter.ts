import type { OpenRouterModel } from "./types";
import { memo } from "./cache";

const BASE = "https://openrouter.ai/api/v1";

export const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free";

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

interface RawReply {
  ok: boolean;
  status: number;
  text: string;
}

/**
 * One completion request. The abort signal must stay armed until the body is
 * fully read — clearing it after `fetch` resolves only covers the headers and
 * leaves a stalled body to hang until the platform kills the whole function.
 */
async function call(
  model: string,
  messages: any[],
  jsonMode: boolean,
  timeoutMs: number,
  apiKey?: string
): Promise<RawReply> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: headers(apiKey),
      signal: ctl.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.25,
        max_tokens: 2200,
        // gpt-oss and other reasoning models will happily spend thousands of
        // tokens deliberating. Low effort keeps them inside the time budget;
        // models that don't reason ignore this field.
        reasoning: { effort: "low" },
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(
        `The model took longer than ${Math.round(timeoutMs / 1000)}s to answer. Pick a faster model and try again.`
      );
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

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
    if (res.status === 401) throw new Error("OpenRouter rejected the API key (401). Check OPENROUTER_API_KEY.");
    if (res.status === 402) throw new Error("OpenRouter credits exhausted for this model. Pick a free model.");
    if (res.status === 429)
      throw new Error("OpenRouter rate limit reached for this model. Wait a minute or pick another model.");
    // Not every model supports native JSON mode — retry plainly before failing.
    const first = res;
    res = await call(model, messages, false, timeoutMs, key);
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(res.text || first.text).slice(0, 200)}`);
  }

  let json: any;
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new Error("OpenRouter returned a malformed response. Try a different model.");
  }
  if (json.error) throw new Error(String(json.error.message ?? json.error));

  // Reasoning models (gpt-oss and friends) sometimes leave `content` empty and
  // put everything in `reasoning`, so fall through the alternatives.
  const msg = json.choices?.[0]?.message ?? {};
  const content: string = msg.content || msg.reasoning || msg.reasoning_content || "";
  if (!content.trim()) throw new Error("The model returned an empty response. Try a different model.");
  return carveJson(content);
}