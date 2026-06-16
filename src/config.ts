import "dotenv/config";

export type SourceName = "balletmania" | "esangdance";
export type LlmMode = "off" | "fallback" | "all";

export const config = {
  port: Number(process.env.WORKER_PORT || 4300),
  defaultLlmMode: (process.env.DEFAULT_LLM_MODE || "off") as LlmMode,
  scheduleEnabled: process.env.SCRAPER_SCHEDULE_ENABLED === "true",
  scheduleDailyAt: process.env.SCRAPER_DAILY_AT || "03:00",
  scheduleSources: parseSources(process.env.SCRAPER_SOURCES || "balletmania,esangdance"),
};

function parseSources(value: string): SourceName[] {
  return value
    .split(",")
    .map((source) => source.trim())
    .filter((source): source is SourceName => source === "balletmania" || source === "esangdance");
}
