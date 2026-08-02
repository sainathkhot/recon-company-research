import { NextRequest, NextResponse } from "next/server";
import { buildPdf, pdfFilename } from "@/lib/pdf";
import { sendReportToDiscord, testDiscord } from "@/lib/discord";
import type { CompanyReport } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action === "test" ? "test" : "send";

    // Values typed into /settings win; env vars are the fallback.
    const botToken = (body.botToken || process.env.DISCORD_BOT_TOKEN || "").trim();
    const channelId = (body.channelId || process.env.DISCORD_CHANNEL_ID || "").trim();

    if (!botToken) return NextResponse.json({ error: "Add a Discord bot token in Settings." }, { status: 400 });
    if (!channelId) return NextResponse.json({ error: "Add a Discord channel ID in Settings." }, { status: 400 });

    if (action === "test") {
      const info = await testDiscord(botToken, channelId);
      return NextResponse.json({ ok: true, ...info });
    }

    const report = body.report as CompanyReport;
    if (!report?.name) return NextResponse.json({ error: "No report to send." }, { status: 400 });

    const pdf = await buildPdf(report);
    const { messageId } = await sendReportToDiscord({
      botToken,
      channelId,
      applicantName: String(body.applicantName ?? ""),
      applicantEmail: String(body.applicantEmail ?? ""),
      report,
      pdf,
      filename: pdfFilename(report),
    });

    return NextResponse.json({ ok: true, messageId });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Discord request failed." }, { status: 500 });
  }
}
