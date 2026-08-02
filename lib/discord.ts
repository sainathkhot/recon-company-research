import type { CompanyReport } from "./types";

const API = "https://discord.com/api/v10";

function friendly(status: number, body: string): string {
  if (status === 401) return "Discord rejected the bot token. Check it in Settings.";
  if (status === 403)
    return "The bot can't post in that channel. Invite it to the server and grant View Channel, Send Messages and Attach Files.";
  if (status === 404) return "Channel not found. Check the Channel ID in Settings.";
  if (status === 429) return "Discord is rate limiting. Wait a few seconds and send again.";
  return `Discord returned ${status}. ${body.slice(0, 160)}`;
}

/** Confirms the token is valid and the bot can see the channel, before any upload. */
export async function testDiscord(botToken: string, channelId: string) {
  const res = await fetch(`${API}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(friendly(res.status, body));
  const ch = JSON.parse(body);
  return { channelName: ch.name ? `#${ch.name}` : `channel ${channelId}`, guildId: ch.guild_id ?? null };
}

export async function sendReportToDiscord(opts: {
  botToken: string;
  channelId: string;
  applicantName: string;
  applicantEmail: string;
  report: CompanyReport;
  pdf: Uint8Array;
  filename: string;
}) {
  const { report: r } = opts;

  const embed = {
    title: `Company Research Report — ${r.name}`.slice(0, 250),
    url: r.website || undefined,
    color: 0x7a2418,
    description: (r.summary || "").slice(0, 900) || undefined,
    fields: [
      { name: "Applicant Name", value: opts.applicantName || "—", inline: true },
      { name: "Applicant Email", value: opts.applicantEmail || "—", inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Company Name", value: r.name || "—", inline: true },
      { name: "Company Website", value: r.website || "—", inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Competitors", value: String(r.competitors.length), inline: true },
      { name: "Pages Crawled", value: String(r.stats.pagesCrawled), inline: true },
      { name: "AI Model", value: r.model || "—", inline: true },
    ],
    footer: { text: `Docket ${r.docket} · Recon Company Research Assistant` },
    timestamp: new Date().toISOString(),
  };

  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      content: `**New company report filed** — ${r.name}`,
      embeds: [embed],
      attachments: [{ id: 0, filename: opts.filename, description: `Research dossier for ${r.name}` }],
    })
  );
  form.append("files[0]", new Blob([new Uint8Array(opts.pdf)], { type: "application/pdf" }), opts.filename);

  const res = await fetch(`${API}/channels/${opts.channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${opts.botToken}` },
    body: form,
  });

  const body = await res.text();
  if (!res.ok) throw new Error(friendly(res.status, body));
  const msg = JSON.parse(body);
  return { messageId: msg.id as string };
}
