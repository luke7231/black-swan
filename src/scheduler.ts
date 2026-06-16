import { config } from "./config.js";
import { runScraper } from "./scraper.js";

let lastRunKey: string | null = null;
let running = false;

export function startScheduler(): void {
  if (!config.scheduleEnabled) return;

  setInterval(() => {
    void tickScheduler();
  }, 60_000).unref();

  void tickScheduler();
}

async function tickScheduler(): Promise<void> {
  const now = new Date();
  const kstNow = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const parts = Object.fromEntries(kstNow.map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const runKey = `${date} ${config.scheduleDailyAt}`;

  if (time !== config.scheduleDailyAt || lastRunKey === runKey || running) return;

  running = true;
  lastRunKey = runKey;

  try {
    await runScraper({ date });
  } catch (error) {
    console.error(error);
  } finally {
    running = false;
  }
}
