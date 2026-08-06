/**
 * Talks to OpenRouter directly, with no app code in the way, and reports
 * exactly when bytes arrive. Run it with:
 *
 *   node scripts/diagnose.mjs
 *   node scripts/diagnose.mjs google/gemma-4-26b-a4b-it:free
 *
 * The question it answers: is the delay OpenRouter's delivery, or ours?
 */

import fs from "node:fs";
import path from "node:path";

/* ── read the key the same way Next does ─────────────────────── */
function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.argv[2] || "google/gemma-4-26b-a4b-it:free";

if (!KEY) {
  console.error("No OPENROUTER_API_KEY found in .env.local — run this from the project root.");
  process.exit(1);
}

const ms = (t) => `${((performance.now() - t) / 1000).toFixed(1)}s`;

async function probe(label, { promptChars, maxTokens, streamed, jsonMode, provider }) {
  // A filler prompt of a realistic size, so we test the actual payload shape.
  const filler = "Zerodha is an Indian discount stock broker. ".repeat(Math.ceil(promptChars / 44));
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: "You are a business analyst. Reply with one JSON object and nothing else." },
      {
        role: "user",
        content: `${filler.slice(0, promptChars)}\n\nReturn {"summary":"3 sentences about this company"}`,
      },
    ],
    stream: streamed,
    temperature: 0.25,
    max_tokens: maxTokens,
    ...(provider ? { provider } : {}),
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  console.log(`\n── ${label}`);
  console.log(
    `   prompt ${promptChars} chars · max_tokens ${maxTokens} · stream ${streamed} · json_mode ${jsonMode} · provider_sort ${
      provider?.sort ?? "default"
    }`
  );

  const t0 = performance.now();
  const ctl = new AbortController();
  const kill = setTimeout(() => ctl.abort(), 90_000);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    console.log(`   headers at ${ms(t0)} · HTTP ${res.status}`);

    if (!res.ok) {
      console.log(`   FAILED: ${(await res.text()).slice(0, 300)}`);
      return;
    }

    let bytes = 0;
    let chunks = 0;
    let firstByteAt = null;
    let biggestGap = 0;
    let last = performance.now();
    let text = "";

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const now = performance.now();
      if (firstByteAt === null) firstByteAt = now;
      biggestGap = Math.max(biggestGap, now - last);
      last = now;
      chunks++;
      bytes += value.length;
      text += dec.decode(value, { stream: true });
    }

    console.log(`   FIRST BYTE at ${((firstByteAt - t0) / 1000).toFixed(1)}s`);
    console.log(`   longest silence between chunks: ${(biggestGap / 1000).toFixed(1)}s`);
    console.log(`   complete at ${ms(t0)} · ${chunks} chunks · ${bytes} bytes`);
    console.log(`   body starts: ${text.slice(0, 110).replace(/\n/g, " ")}`);
  } catch (err) {
    console.log(`   ABORTED/ERROR after ${ms(t0)}: ${err.message}`);
  } finally {
    clearTimeout(kill);
  }
}

console.log(`Diagnosing ${MODEL}`);
console.log("The number that matters is FIRST BYTE and longest silence.");

await probe("A · tiny prompt, streamed", { promptChars: 200, maxTokens: 200, streamed: true, jsonMode: false });
await probe("B · tiny prompt, NOT streamed", { promptChars: 200, maxTokens: 200, streamed: false, jsonMode: false });
await probe("C · real prompt size, streamed", { promptChars: 14000, maxTokens: 1300, streamed: true, jsonMode: false });
await probe("D · real prompt, throughput routing", {
  promptChars: 14000,
  maxTokens: 1300,
  streamed: true,
  jsonMode: false,
  provider: { sort: "throughput", allow_fallbacks: true },
});
await probe("E · real prompt, JSON mode", { promptChars: 14000, maxTokens: 1300, streamed: true, jsonMode: true });

console.log("\nDone. Paste the whole output back.");
