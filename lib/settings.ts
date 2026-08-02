"use client";

import type { DiscordConfig } from "./types";

const KEY = "recon.settings.v1";
const MODEL_KEY = "recon.model.v1";

export const emptyConfig: DiscordConfig = {
  openrouterKey: "",
  serperKey: "",
  botToken: "",
  channelId: "",
  applicantName: "",
  applicantEmail: "",
  autoSend: true,
};

export function loadConfig(): DiscordConfig {
  if (typeof window === "undefined") return emptyConfig;
  try {
    return { ...emptyConfig, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return emptyConfig;
  }
}

export function saveConfig(c: DiscordConfig) {
  localStorage.setItem(KEY, JSON.stringify(c));
}

export function loadModel(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(MODEL_KEY) || fallback;
}

export function saveModel(id: string) {
  localStorage.setItem(MODEL_KEY, id);
}
