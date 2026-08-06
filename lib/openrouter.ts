import type { OpenRouterModel } from "./types";
import { memo } from "./cache";

const BASE = "https://openrouter.ai/api/v1";

export const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free";

/** Header values must be Latin-1 encodable, so anything else is stripped. */
/** Models with an explicit reasoning phase. */
const REASONS = /(gpt-oss|^openai\/o[0-9]|thinking|reasoner|deepseek-r1|qwq)/i;

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
      const res = await fetch(`${BASE}/models`, {
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
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
 * One completion request, read as a token stream.
 *
 * Non-streaming responses require the whole body before anything is readable,
 * and on a serverless host that turns any slow or stalled body into a silent
 * hang until the platform kills the function. Streaming gives us tokens as the
 * provider produces them, so a stall is detectable and the abort signal stays
 * armed for the entire read rather than just the headers.
 */
async function call(
  model: string,
  messages: any[],
  jsonMode: boolean,
  timeoutMs: number,
  apiKey?: string,
  streamed = true
): Promise<RawReply> {
  const ctl = new AbortController();
  const overall = setTimeout(() => ctl.abort(), timeoutMs);

  // Temporary instrumentation. Set RECON_DEBUG=1 to trace delivery timing.
  const t0 = Date.now();
  const dbg = process.env.RECON_DEBUG === "1";
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const log = (...a: any[]) => dbg && console.log("[openrouter]", at(), ...a);

  // Several free providers buffer the whole completion and send nothing until
  // it is finished, so silence is normal for most of the run. This window only
  // catches a route that has genuinely died, not one that is still thinking.
  const STALL_MS = 20_000;
  let stall = setTimeout(() => ctl.abort(), STALL_MS);
  const beat = () => {
    clearTimeout(stall);
    stall = setTimeout(() => ctl.abort(), STALL_MS);
  };

  try {
    const payload = JSON.stringify({
      model,
      messages,
      stream: streamed,
      temperature: 0.25,
      max_tokens: 1300,
      provider: { sort: "throughput", allow_fallbacks: true },
      ...(REASONS.test(model) ? { reasoning: { effort: "low" } } : {}),
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    });
    log(`REQUEST model=${model} streamed=${streamed} jsonMode=${jsonMode} bodyBytes=${payload.length} budget=${timeoutMs}ms`);

    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: headers(apiKey),
      signal: ctl.signal,
      // Next.js patches global fetch for caching, and the wrapper buffers a
      // streamed body instead of passing chunks through. Opt out on both APIs.
      cache: "no-store",
      body: payload,
    });

    log(`HEADERS status=${res.status} type=${res.headers.get("content-type")}`);

    if (!res.ok || !res.body || !streamed) {
      const text = await res.text().catch(() => "");
      if (!res.ok) return { ok: false, status: res.status, text };
      // Non-streamed: the body is one JSON envelope.
      try {
        const json = JSON.parse(text);
        if (json.error) return { ok: false, status: 500, text: String(json.error.message ?? json.error) };
        const m = json.choices?.[0]?.message ?? {};
        return { ok: true, status: 200, text: m.content || m.reasoning || m.reasoning_content || "" };
      } catch {
        return { ok: false, status: 500, text: "Malformed response body." };
      }
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let out = "";
    let streamError = "";
    let chunks = 0;
    let bytes = 0;
    let sawData = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (chunks === 0) log(`FIRST BYTE (${value.length} bytes)`);

      chunks++;
      bytes += value.length;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      sawData = false;
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith(":")) continue; // comments are keep-alives
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;

        sawData = true;
        try {
          const frame = JSON.parse(payload);
          if (frame.error) {
            streamError = String(frame.error.message ?? frame.error);
            continue;
          }
          const choice = frame.choices?.[0] ?? {};
          const delta = choice.delta ?? {};
          const whole = choice.message ?? {};
          out +=
            delta.content ??
            delta.reasoning ??
            delta.reasoning_content ??
            whole.content ??
            whole.reasoning ??
            "";
        } catch {
          /* partial frame — the next chunk completes it */
        }
      }
      // Only real frames count as progress; comments are keep-alives.
      if (sawData) beat();
    }

    log(`STREAM DONE chunks=${chunks} bytes=${bytes} parsedChars=${out.length} err="${streamError}"`);
    if (streamError && !out.trim()) return { ok: false, status: 500, text: streamError };
    return { ok: true, status: 200, text: out };
  } catch (err: any) {
    log(`ABORT/ERROR name=${err?.name} msg=${err?.message}`);
    if (err?.name === "AbortError") {
      throw new Error(
        `The model stopped responding. Open the model dropdown and pick another — free routes are queued behind paid traffic and throughput varies by hour.`
      );
    }
    throw err;
  } finally {
    clearTimeout(overall);
    clearTimeout(stall);
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

  const started = Date.now();

  /**
   * One real attempt, given the whole budget.
   *
   * Splitting the window across speculative retries starves every one of them:
   * a provider that buffers its output for 25 seconds will never beat three
   * 15-second slots. So the first request gets everything, and a second is only
   * worth making if the first failed *fast* — a fast failure is a real error
   * (bad payload, unsupported field) and is worth one different shape. A slow
   * failure means the route is simply too slow, and repeating it cannot help.
   */
  const FAST_FAILURE_MS = 9_000;

  const attempt = async (jsonMode: boolean, budget: number, streamed = true) => {
    try {
      const r = await call(model, messages, jsonMode, budget, key, streamed);
      if (r.ok && r.text.trim()) return { text: r.text, error: "" };
      if (r.status === 401) throw new Error("OpenRouter rejected the API key (401). Check OPENROUTER_API_KEY.");
      if (r.status === 402) throw new Error("OpenRouter credits exhausted for this model. Pick a free model.");
      if (r.status === 429)
        throw new Error("OpenRouter rate limit reached for this model. Wait a minute or pick another model.");
      return { text: "", error: r.text ? `OpenRouter ${r.status}: ${r.text.slice(0, 200)}` : "Empty response." };
    } catch (err: any) {
      if (/401|402|429|API key|credits|rate limit/i.test(err?.message ?? "")) throw err;
      return { text: "", error: err?.message ?? "Request failed." };
    }
  };

  const first = await attempt(false, timeoutMs);
  if (first.text) return carveJson(first.text);

  const elapsed = Date.now() - started;
  const left = timeoutMs - elapsed;

  // Only a fast failure leaves both the time and the reason to try again.
  if (elapsed < FAST_FAILURE_MS && left > 10_000) {
    const second = await attempt(false, left, false);
    if (second.text) return carveJson(second.text);
    throw new Error(second.error || first.error);
  }

  throw new Error(
    first.error ||
      "The model did not respond in time. Free routes are queued behind paid traffic — pick another model from the dropdown."
  );
}