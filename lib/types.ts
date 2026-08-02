export type Stage =
  | "resolve"
  | "search"
  | "crawl"
  | "analyse"
  | "competitors"
  | "compile";

export type StepStatus = "running" | "done" | "skipped" | "failed";

export interface TrailStep {
  id: string;
  stage: Stage;
  label: string;
  detail?: string;
  status: StepStatus;
  ms?: number;
}

export interface CrawledPage {
  url: string;
  title: string;
  kind: string;
  words: number;
  text: string;
}

export interface SearchHit {
  title: string;
  link: string;
  snippet: string;
}

export interface Competitor {
  name: string;
  website: string;
  reason?: string;
}

export interface PainPoint {
  title: string;
  detail: string;
}

export interface CompanyReport {
  docket: string;
  generatedAt: string;
  model: string;

  name: string;
  website: string;
  legalName?: string;
  industry?: string;
  headquarters?: string;
  country?: string;
  founded?: string;
  employees?: string;

  phone?: string;
  email?: string;
  address?: string;

  summary: string;
  products: string[];
  painPoints: PainPoint[];
  competitors: Competitor[];

  sources: { url: string; label: string; via: "crawl" | "search" }[];
  stats: { pagesCrawled: number; searchQueries: number; elapsedMs: number };
}

/** Everything the client streams down from /api/research. */
export type ResearchEvent =
  | { type: "step"; step: TrailStep }
  | { type: "note"; text: string }
  | { type: "report"; report: CompanyReport }
  | { type: "error"; message: string; hint?: string };

export interface DiscordConfig {
  /** Optional per-browser API key overrides. Blank means "use the server's own keys". */
  openrouterKey: string;
  serperKey: string;
  botToken: string;
  channelId: string;
  applicantName: string;
  applicantEmail: string;
  autoSend: boolean;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  context?: number;
  promptPrice?: number;
  free: boolean;
}
