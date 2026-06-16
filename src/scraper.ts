import path from "node:path";
import fs from "node:fs/promises";
import type { Prisma, SourceName as PrismaSourceName } from "@prisma/client";
import { runCommand, type CommandResult } from "./command.js";
import { config, type LlmMode, type SourceName } from "./config.js";
import { prisma } from "./db.js";
import { importClassifiedFile } from "./import-classified.js";

export interface RunScraperOptions {
  source?: SourceName;
  date: string;
  llmMode?: LlmMode;
}

export interface RunScraperResult {
  runId: string;
  status: "success" | "failed";
  collected: number;
  classified: number;
  imported: number;
  logs: CommandResult[];
}

export async function runScraper(options: RunScraperOptions): Promise<RunScraperResult> {
  validateDate(options.date);

  const sources = options.source ? [options.source] : config.scheduleSources;
  const llmMode = options.llmMode || config.defaultLlmMode;
  const run = await prisma.scraperRun.create({
    data: {
      source: options.source ? (options.source as PrismaSourceName) : null,
      targetDate: options.date,
      llmMode,
      status: "running",
    },
  });

  const logs: CommandResult[] = [];
  let collected = 0;
  let classified = 0;
  let imported = 0;

  try {
    for (const source of sources) {
      const result = await runSourcePipeline(source, options.date, llmMode);
      logs.push(...result.logs);
      collected += result.collected;
      classified += result.classified;
      imported += result.imported;
    }

    await prisma.scraperRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        collected,
        classified,
        imported,
        logs: logs as unknown as Prisma.InputJsonValue,
      },
    });

    return { runId: run.id, status: "success", collected, classified, imported, logs };
  } catch (error) {
    await prisma.scraperRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        collected,
        classified,
        imported,
        errorMessage: error instanceof Error ? error.message : String(error),
        logs: logs as unknown as Prisma.InputJsonValue,
      },
    });
    throw error;
  }
}

async function runSourcePipeline(source: SourceName, date: string, llmMode: LlmMode) {
  await fs.mkdir(config.scraperWorkDir, { recursive: true });

  const listPath = path.join(config.scraperWorkDir, `${source}-employ-${date}.json`);
  const classifiedPath = path.join(config.scraperWorkDir, `${source}-employ-${date}-classified.json`);
  const logs: CommandResult[] = [];

  logs.push(
    await runCommand("npm", [
      "run",
      `collect:${source}`,
      "--",
      "--date",
      date,
      "--output",
      listPath,
    ]),
  );
  logs.push(
    await runCommand("npm", [
      "run",
      `classify:${source}`,
      "--",
      "--input",
      listPath,
      "--output",
      classifiedPath,
      "--llm",
      llmMode,
    ]),
  );

  const classifiedPayload = JSON.parse(await fs.readFile(classifiedPath, "utf8")) as { total?: number };
  const importResult = await importClassifiedFile(classifiedPath);

  return {
    logs,
    collected: classifiedPayload.total || 0,
    classified: classifiedPayload.total || 0,
    imported: importResult.imported,
  };
}

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date: ${date}. Expected YYYY-MM-DD.`);
  }
}
