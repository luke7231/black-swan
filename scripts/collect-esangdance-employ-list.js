#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const { Agent } = require("undici");
const cheerio = require("cheerio");
const dotenv = require("dotenv");

dotenv.config();

const BASE_URL = "https://www.esangdance.net";
const LIST_PATH = "/M01";
const CATEGORY = "발레";

const args = parseArgs(process.argv.slice(2));
const targetDate = args.date || "2026-06-11";
const maxPages = Number(args.maxPages || 10);
const delayMs = Number(args.delayMs || 400);
const retries = Number(args.retries || 3);
const timeoutMs = Number(args.timeoutMs || 45000);
const outputPath =
  args.output ||
  path.join("data", `esangdance-employ-${targetDate}.json`);

const fetchDispatcher = new Agent({
  connect: {
    timeout: timeoutMs,
  },
});

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  validateDate(targetDate);

  const targetShortDate = toShortDate(targetDate);
  const todayKst = getTodayKstDate();
  const collected = [];
  const pages = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildListUrl(page);
    const html = await fetchUtf8Html(url, { retries, timeoutMs });
    const listings = parseListings(html, {
      listPage: page,
      targetYear: targetDate.slice(0, 4),
      todayKst,
    });
    const dates = [...new Set(listings.map((listing) => listing.postedDate).filter(Boolean))];

    pages.push({
      page,
      url,
      parsedCount: listings.length,
      dates,
    });

    const matched = listings.filter((listing) => listing.postedDate === targetDate);
    collected.push(...matched);

    if (listings.length === 0) break;

    const hasOlderDate = listings.some((listing) => compareIsoDate(listing.postedDate, targetDate) < 0);
    const hasTargetDate = matched.length > 0;

    if (hasOlderDate && !hasTargetDate) break;
    if (hasOlderDate && hasTargetDate) break;

    await sleep(delayMs);
  }

  const deduped = dedupeByPostId(collected);
  const payload = {
    source: "esangdance",
    sourceUrl: buildListUrl(1),
    category: CATEGORY,
    targetDate,
    targetShortDate,
    fetchedAt: new Date().toISOString(),
    total: deduped.length,
    pages,
    listings: deduped,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Saved ${deduped.length} listings to ${outputPath}`);
  for (const listing of deduped) {
    console.log(`${listing.postId}\t${listing.postedDate}\t${listing.status || ""}\t${listing.title}`);
  }
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") parsed.date = argv[++index];
    else if (arg === "--output") parsed.output = argv[++index];
    else if (arg === "--max-pages") parsed.maxPages = argv[++index];
    else if (arg === "--delay-ms") parsed.delayMs = argv[++index];
    else if (arg === "--retries") parsed.retries = argv[++index];
    else if (arg === "--timeout-ms") parsed.timeoutMs = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: npm run collect:esangdance -- --date 2026-06-11",
        "",
        "Options:",
        "  --date YYYY-MM-DD       등록일 기준 수집 날짜",
        "  --output PATH           JSON 저장 경로",
        "  --max-pages NUMBER      순회할 최대 페이지 수",
        "  --delay-ms NUMBER       페이지 요청 사이 대기 시간(ms)",
        "  --retries NUMBER        요청 실패 시 재시도 횟수",
        "  --timeout-ms NUMBER     요청별 최대 대기 시간(ms)",
      ].join("\n"));
      process.exit(0);
    }
  }

  return parsed;
}

function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid --date: ${date}. Expected YYYY-MM-DD.`);
  }
}

function buildListUrl(page) {
  const url = new URL(LIST_PATH, BASE_URL);
  url.searchParams.set("sca", CATEGORY);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

async function fetchUtf8Html(url, options) {
  let lastError = null;

  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        dispatcher: fetchDispatcher,
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: {
          "user-agent": "Mozilla/5.0 compatible; black-swan-ballet-crawler/0.1",
          "accept": "text/html,application/xhtml+xml",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt < options.retries) await sleep(1000 * attempt);
    }
  }

  throw lastError;
}

function parseListings(html, options) {
  const $ = cheerio.load(html, { decodeEntities: true });
  const rows = [];

  $("tr").each((_, row) => {
    const $row = $(row);
    const titleAnchor = $row.find("td.text-start a.text-dark[href*='/M01/']").first();
    const href = titleAnchor.attr("href");
    const postId = extractPostId(href);

    if (!postId) return;

    const cells = $row.children("td");
    const dateText = cleanText(cells.eq(4).text()) || null;
    const postedDate = normalizePostedDate(dateText, options);

    rows.push({
      postId,
      boardNo: cleanText(cells.eq(0).text()) || null,
      category: cleanText($row.find("td.text-start a.badge").first().text()) || null,
      title: cleanText(titleAnchor.text()),
      writer: cleanText(cells.eq(2).find(".dropdown > a").first().text()) || cleanText(cells.eq(2).text()) || null,
      viewCount: toNumber(cleanText(cells.eq(3).text())),
      dateText,
      postedDate,
      status: cleanText(cells.eq(5).text()) || null,
      listPage: options.listPage,
      url: new URL(href, BASE_URL).toString(),
    });
  });

  return rows;
}

function extractPostId(href) {
  if (!href) return null;
  const match = href.match(/\/M01\/(\d+)/);
  return match ? match[1] : null;
}

function normalizePostedDate(dateText, { targetYear, todayKst }) {
  if (!dateText) return null;

  if (/^\d{2}:\d{2}$/.test(dateText)) return todayKst;

  if (/^\d{2}-\d{2}$/.test(dateText)) {
    return `${targetYear}-${dateText}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return dateText;

  return null;
}

function getTodayKstDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date());
}

function toShortDate(date) {
  return date.slice(5);
}

function compareIsoDate(left, right) {
  if (!left || !right) return 0;
  return left.localeCompare(right);
}

function dedupeByPostId(listings) {
  const seen = new Set();
  return listings.filter((listing) => {
    if (seen.has(listing.postId)) return false;
    seen.add(listing.postId);
    return true;
  });
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
