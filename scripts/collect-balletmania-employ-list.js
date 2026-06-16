#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const cheerio = require("cheerio");
const dotenv = require("dotenv");
const iconv = require("iconv-lite");

dotenv.config();

const BASE_URL = "https://www.balletmania.com";
const LIST_PATH = "/work/employ_list.html";

const args = parseArgs(process.argv.slice(2));
const targetDate = args.date || "2026-06-11";
const maxPages = Number(args.maxPages || 10);
const outputPath =
  args.output ||
  path.join("data", `balletmania-employ-${targetDate}.json`);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  validateDate(targetDate);

  const targetShortDate = toShortDate(targetDate);
  const todayShortDate = toShortDate(getTodayKstDate());
  const collected = [];
  const pages = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildListUrl(page);
    const html = await fetchEucKrHtml(url);
    const listings = parseListings(html, { todayShortDate });
    const dates = [...new Set(listings.map((listing) => listing.postedDate).filter(Boolean))];

    pages.push({
      page,
      url,
      parsedCount: listings.length,
      dates,
    });

    const matched = listings.filter((listing) => listing.postedDate === targetShortDate);
    collected.push(...matched);

    if (listings.length === 0) break;

    const hasOlderDate = listings.some((listing) => compareShortDate(listing.postedDate, targetShortDate) < 0);
    const hasTargetDate = matched.length > 0;

    if (hasOlderDate && !hasTargetDate) break;
    if (hasOlderDate && hasTargetDate) break;

    await sleep(400);
  }

  const deduped = dedupeByNo(collected);
  const payload = {
    source: "balletmania",
    sourceUrl: new URL(LIST_PATH, BASE_URL).toString(),
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
    console.log(`${listing.no}\t${listing.postedDate}\t${listing.company}\t${listing.title}`);
  }
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") parsed.date = argv[++index];
    else if (arg === "--output") parsed.output = argv[++index];
    else if (arg === "--max-pages") parsed.maxPages = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: npm run collect:balletmania -- --date 2026-06-11",
        "",
        "Options:",
        "  --date YYYY-MM-DD       등록일 기준 수집 날짜",
        "  --output PATH           JSON 저장 경로",
        "  --max-pages NUMBER      순회할 최대 페이지 수",
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
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

async function fetchEucKrHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 compatible; black-swan-ballet-crawler/0.1",
      "accept": "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return iconv.decode(Buffer.from(arrayBuffer), "euc-kr");
}

function parseListings(html, options) {
  const $ = cheerio.load(html, { decodeEntities: true });
  const rows = [];

  $("table.employ_contents tr[height='90']").each((_, row) => {
    const $row = $(row);
    const titleAnchor = $row.find("a[href*='employ_detail.html?no=']").first();
    const href = titleAnchor.attr("href");
    const no = extractNo(href);

    if (!no) return;

    const cells = $row.children("td");
    const title = cleanText(titleAnchor.text());
    const companyRaw = cleanText($row.find("span[style*='#9966CC']").first().clone().children().remove().end().text());
    const company = stripCompanyType(companyRaw);
    const companyType = extractCompanyType(companyRaw);
    const metaText = cleanText($row.find("div").filter((_, element) => cleanText($(element).text()).includes("모집전공")).first().text());
    const major = extractBetween(metaText, "모집전공 :", "|") || null;
    const career = extractAfter(metaText, "경력 :") || null;
    const closingDate = cleanText(cells.eq(cells.length - 2).text()) || null;
    const postedDateCell = cells.eq(cells.length - 1);
    const postedDate = normalizePostedDateCell($, postedDateCell, options.todayShortDate);

    rows.push({
      no,
      title,
      company,
      companyType,
      major,
      career,
      closingDate,
      postedDate,
      postedDateIso: shortDateToIso(postedDate),
      url: new URL(href, BASE_URL).toString(),
    });
  });

  return rows;
}

function normalizePostedDateCell($, cell, todayShortDate) {
  const text = cleanText(cell.text());
  if (text) return text;
  if (cell.find("img[src*='icon_today']").length > 0) return todayShortDate;
  return null;
}

function extractNo(href) {
  if (!href) return null;
  const match = href.match(/[?&]no=(\d+)/);
  return match ? match[1] : null;
}

function stripCompanyType(value) {
  return value.replace(/\([^)]*\)\s*$/, "").trim() || null;
}

function extractCompanyType(value) {
  const match = value.match(/\(([^)]*)\)\s*$/);
  return match ? match[1].trim() : null;
}

function extractBetween(value, start, end) {
  const startIndex = value.indexOf(start);
  if (startIndex === -1) return null;

  const contentStart = startIndex + start.length;
  const endIndex = value.indexOf(end, contentStart);
  return value.slice(contentStart, endIndex === -1 ? undefined : endIndex).trim();
}

function extractAfter(value, marker) {
  const index = value.indexOf(marker);
  if (index === -1) return null;
  return value.slice(index + marker.length).trim();
}

function shortDateToIso(shortDate) {
  if (!/^\d{2}\.\d{2}\.\d{2}$/.test(shortDate)) return null;
  const [year, month, day] = shortDate.split(".");
  return `20${year}-${month}-${day}`;
}

function toShortDate(date) {
  const [year, month, day] = date.split("-");
  return `${year.slice(2)}.${month}.${day}`;
}

function getTodayKstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function compareShortDate(left, right) {
  const leftIso = shortDateToIso(left);
  const rightIso = shortDateToIso(right);

  if (!leftIso || !rightIso) return 0;
  return leftIso.localeCompare(rightIso);
}

function dedupeByNo(listings) {
  const seen = new Set();
  return listings.filter((listing) => {
    if (seen.has(listing.no)) return false;
    seen.add(listing.no);
    return true;
  });
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
