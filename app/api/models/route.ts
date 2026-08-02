import { NextResponse } from "next/server";
import { listModels, DEFAULT_MODEL } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // served live; cached in-process for an hour

export async function GET() {
  try {
    const models = await listModels();
    return NextResponse.json({ models, default: DEFAULT_MODEL });
  } catch (err: any) {
    // The picker still works from a curated fallback if OpenRouter is unreachable.
    return NextResponse.json({
      models: [
        { id: "openai/gpt-oss-20b:free", name: "GPT-OSS 20B (free)", free: true },
        { id: "deepseek/deepseek-chat-v3-0324:free", name: "DeepSeek V3 (free)", free: true },
        { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)", free: true },
        { id: "openai/gpt-4o-mini", name: "GPT-4o mini", free: false },
        { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", free: false },
      ],
      default: DEFAULT_MODEL,
      degraded: String(err?.message ?? err),
    });
  }
}
