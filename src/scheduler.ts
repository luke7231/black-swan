import { config } from "./config.js";
import { runScraper } from "./scraper.js";

let running = false;

export function startScheduler(): void {
  if (!config.scheduleEnabled) return;

  const intervalMs = config.scheduleIntervalMinutes * 60_000;

  setInterval(() => {
    void tickScheduler();
  }, intervalMs).unref();

  void tickScheduler();
}

async function tickScheduler(): Promise<void> {
  const date = todayKst();

  if (running) {
    console.info(`[scheduler] skipped ${date}: previous scraper run is still running`);
    return;
  }

  running = true;
  console.info(`[scheduler] started ${date}`);

  try {
    const result = await runScraper({ date });
    console.info(
      `[scheduler] completed ${date}: runId=${result.runId} collected=${result.collected} classified=${result.classified} imported=${result.imported}`,
    );
  } catch (error) {
    console.error(`[scheduler] failed ${date}`, error);
  } finally {
    running = false;
  }
}

function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
