import { NextRequest } from "next/server";
import { buildPdf, pdfFilename } from "@/lib/pdf";
import type { CompanyReport } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { report } = (await req.json()) as { report: CompanyReport };
    if (!report?.name) return new Response("A report is required.", { status: 400 });

    const bytes = await buildPdf(report);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFilename(report)}"`,
        "Content-Length": String(bytes.length),
      },
    });
  } catch (err: any) {
    return new Response(`Could not build the PDF. ${err?.message ?? ""}`, { status: 500 });
  }
}
