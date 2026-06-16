import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { Prisma, SourceName as PrismaSourceName } from "@prisma/client";
import { prisma } from "./db.js";
import type { SourceName } from "./config.js";

interface ClassifiedPayload {
  source: SourceName;
  total: number;
  listings: ClassifiedItem[];
}

interface ClassifiedItem {
  source: SourceName;
  sourcePostId: string;
  url: string;
  collectedAt: string;
  raw: Record<string, unknown>;
  classification: Record<string, unknown>;
}

interface ImportResult {
  imported: number;
}

export async function importClassifiedFile(filePath: string): Promise<ImportResult> {
  const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as ClassifiedPayload;
  let imported = 0;

  for (const item of payload.listings) {
    await importClassifiedItem(payload.source, item);
    imported += 1;
  }

  return { imported };
}

async function importClassifiedItem(source: SourceName, item: ClassifiedItem): Promise<void> {
  const normalized = normalizeItem(source, item);
  const sourcePost = await prisma.sourcePost.upsert({
    where: {
      source_sourcePostId: {
        source: source as PrismaSourceName,
        sourcePostId: item.sourcePostId,
      },
    },
    update: {
      sourceUrl: item.url,
      title: normalized.title,
      postedAt: normalized.postedAt,
      rawJson: item.raw as Prisma.InputJsonValue,
      classificationJson: item.classification as Prisma.InputJsonValue,
      contentHash: normalized.contentHash,
      fetchedAt: new Date(item.collectedAt),
    },
    create: {
      source: source as PrismaSourceName,
      sourcePostId: item.sourcePostId,
      sourceUrl: item.url,
      title: normalized.title,
      postedAt: normalized.postedAt,
      rawJson: item.raw as Prisma.InputJsonValue,
      classificationJson: item.classification as Prisma.InputJsonValue,
      contentHash: normalized.contentHash,
      fetchedAt: new Date(item.collectedAt),
    },
  });

  const existingLink = await prisma.jobPostSource.findFirst({
    where: {
      sourcePostId: sourcePost.id,
    },
    select: {
      jobPostId: true,
    },
  });

  const jobPost = existingLink
    ? await prisma.jobPost.update({
        where: { id: existingLink.jobPostId },
        data: normalized.jobPostData,
      })
    : await prisma.jobPost.create({
        data: normalized.jobPostData,
      });

  await prisma.jobPostSource.upsert({
    where: {
      jobPostId_sourcePostId: {
        jobPostId: jobPost.id,
        sourcePostId: sourcePost.id,
      },
    },
    update: {
      sourceUrl: item.url,
      confidence: normalized.sourceConfidence,
    },
    create: {
      jobPostId: jobPost.id,
      sourcePostId: sourcePost.id,
      source: source as PrismaSourceName,
      sourceUrl: item.url,
      confidence: normalized.sourceConfidence,
    },
  });
}

function normalizeItem(source: SourceName, item: ClassifiedItem) {
  const raw = item.raw;
  const classification = item.classification;
  const location = firstObject(classification.locations);
  const schedule = asRecord(classification.schedule);
  const pay = asRecord(classification.pay);
  const contact = asRecord(classification.contact);
  const requirements = asRecord(classification.requirements);
  const llm = asRecord(classification.llm);
  const title = stringValue(raw.title) || "Untitled job post";
  const description = stringValue(raw.detailText);
  const contentHash = hashContent([source, title, description, stringValue(raw.postedDate)].join("\n"));

  const normalizedJson = {
    source,
    sourcePostId: item.sourcePostId,
    sourceUrl: item.url,
    title,
    description,
    raw,
    classification,
  };

  return {
    title,
    postedAt: parseDate(stringValue(raw.postedDate)),
    contentHash,
    sourceConfidence: stringValue(classification.balletConfidence),
    jobPostData: {
      title,
      description,
      sourcePrimary: source as PrismaSourceName,
      status: stringValue(raw.status),
      postedAt: parseDate(stringValue(raw.postedDate)),
      jobType: stringValue(classification.jobType),
      isBallet: Boolean(classification.isBallet),
      balletConfidence: stringValue(classification.balletConfidence),
      audienceTypes: jsonArray(classification.audiences),
      subjectTypes: jsonArray(classification.subjects),
      locationText: stringValue(location.raw) || stringValue(raw.summaryRegionText),
      sido: stringValue(location.sido),
      sigungu: stringValue(location.sigungu),
      dongOrStation: stringValue(location.dongOrStation),
      days: jsonArray(schedule.days),
      timeSlots: jsonArray(schedule.timeSlots),
      times: jsonArray(schedule.times),
      classCount: numberValue(schedule.classCount),
      durationMinutes: numberValue(schedule.durationMinutes),
      payType: stringValue(pay.type),
      payMinManwon: numberValue(pay.minManwon),
      payMaxManwon: numberValue(pay.maxManwon),
      payText: stringValue(pay.amountText),
      payNegotiable: Boolean(pay.isNegotiable),
      contactMethods: jsonArray(contact.applyMethods),
      contactEmails: jsonArray(contact.emails),
      contactPhones: jsonArray(contact.phones),
      requirementsJson: requirements as Prisma.InputJsonValue,
      confidenceJson: llm as Prisma.InputJsonValue,
      normalizedJson: normalizedJson as Prisma.InputJsonValue,
      contentHash,
    },
  };
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function firstObject(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {};
  return asRecord(value[0]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonArray(value: unknown): Prisma.InputJsonValue {
  return Array.isArray(value) ? (value as Prisma.InputJsonValue) : [];
}
