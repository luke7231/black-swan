#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const cheerio = require("cheerio");
const dotenv = require("dotenv");
const iconv = require("iconv-lite");
const OpenAI = require("openai");

dotenv.config();

const BASE_URL = "https://www.balletmania.com";

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input || path.join("data", "balletmania-employ-2026-06-11.json");
const outputPath =
  args.output || path.join("data", "balletmania-employ-2026-06-11-classified.json");
const llmMode = args.llm || "fallback";
const llmModel = process.env.OPENAI_MODEL || "gpt-5.5";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  validateLlmMode(llmMode);

  const listPayload = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const cookie = await login();
  const openai = createOpenAiClient(llmMode);
  const results = [];

  for (const listing of listPayload.listings) {
    const detail = await fetchDetail(listing.url, cookie);
    const raw = {
      title: detail.title || listing.title,
      company: listing.company,
      companyType: listing.companyType,
      postedDate: listing.postedDateIso,
      closingDateText: detail.closingDateText || listing.closingDate,
      summaryMajorText: detail.summary.major || listing.major || null,
      summaryRegionText: detail.summary.region || null,
      summaryPayText: detail.summary.pay || null,
      detailText: detail.detailText,
    };

    let classification = classify(raw);
    const llmReasons = classificationNeedsLlm(classification, raw);

    if (shouldUseLlm(llmMode, llmReasons)) {
      try {
        const llmResult = await callLlmFallback(openai, raw, classification, llmReasons);
        classification = mergeLlmClassification(classification, llmResult, {
          used: true,
          reason: llmReasons,
          model: llmModel,
        });
      } catch (error) {
        classification.llm = {
          used: true,
          reason: llmReasons,
          model: llmModel,
          appliedFields: [],
          suggestion: null,
          notes: [],
          error: error.message,
        };
      }
    } else {
      classification.llm = {
        used: false,
        reason: llmReasons,
        model: llmMode === "off" ? null : llmModel,
        appliedFields: [],
        suggestion: null,
        notes: [],
      };
    }

    results.push({
      source: "balletmania",
      sourcePostId: listing.no,
      url: listing.url,
      collectedAt: new Date().toISOString(),
      raw,
      classification,
    });

    await sleep(250);
  }

  const payload = {
    source: "balletmania",
    input: inputPath,
    outputSchema: "CRAWLING_CLASSIFICATION_RULES.md",
    total: results.length,
    generatedAt: new Date().toISOString(),
    listings: results,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Saved ${results.length} classified listings to ${outputPath}`);
  for (const item of results) {
    const c = item.classification;
    console.log(
      `${item.sourcePostId}\t${c.jobType}\t${c.audiences.join(",") || "unknown"}\t${c.schedule.days.join(",") || "-"}\t${c.pay.amountText || "-"}\t${item.raw.title}`,
    );
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") parsed.input = argv[++index];
    else if (arg === "--output") parsed.output = argv[++index];
    else if (arg === "--llm") parsed.llm = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: npm run classify:balletmania -- --input data/balletmania-employ-2026-06-11.json",
        "",
        "Options:",
        "  --input PATH    목록 수집 JSON 경로",
        "  --output PATH   분류 결과 JSON 경로",
        "  --llm MODE      off | fallback | all (default: fallback)",
      ].join("\n"));
      process.exit(0);
    }
  }
  return parsed;
}

function validateLlmMode(mode) {
  if (!["off", "fallback", "all"].includes(mode)) {
    throw new Error(`Invalid --llm mode: ${mode}. Expected off, fallback, or all.`);
  }
}

function createOpenAiClient(mode) {
  if (mode === "off") return null;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when --llm is fallback or all. Use --llm off to run rule-only classification.");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function login() {
  const id = process.env.BALLET_MANIA_ID;
  const passwd = process.env.BALLET_MANIA_PW;

  if (!id || !passwd) {
    throw new Error("BALLET_MANIA_ID and BALLET_MANIA_PW are required in .env");
  }

  const params = new URLSearchParams({ kind: "general", id, passwd });
  const response = await fetch(`${BASE_URL}/rankup_module/rankup_member/login_regist.php`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 compatible; black-swan-ballet-crawler/0.1",
    },
    body: params,
    redirect: "manual",
  });

  const cookie = (response.headers.get("set-cookie") || "")
    .split(",")
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");

  if (!cookie) throw new Error("Failed to create Balletmania login session.");
  return cookie;
}

async function fetchDetail(url, cookie) {
  const response = await fetch(url, {
    headers: {
      cookie,
      "user-agent": "Mozilla/5.0 compatible; black-swan-ballet-crawler/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const html = iconv.decode(Buffer.from(await response.arrayBuffer()), "euc-kr");
  const $ = cheerio.load(html, { decodeEntities: false });
  const summary = parseSummary($);

  return {
    title: cleanText($(".detail_title").first().text()),
    summary,
    closingDateText: parseContactTable($)["접수기간"] || null,
    detailText: cleanDetailText($("#employ_detail_textarea").val() || ""),
  };
}

function parseSummary($) {
  let major = null;
  let region = null;
  let pay = null;

  $("#d_em_con1 table.tb_tb2 tr").each((_, row) => {
    const cells = $(row).children("td").map((__, td) => cleanText($(td).text())).get();
    if (cells.length === 3 && cells[0] !== "모집 전공 분야") {
      [major, region, pay] = cells;
    }
  });

  return { major, region, pay };
}

function parseContactTable($) {
  const values = {};
  $("#d_em_con3 tr").each((_, row) => {
    const cells = $(row).children("td").map((__, td) => cleanText($(td).text())).get();
    for (let index = 0; index < cells.length - 1; index += 2) {
      values[cells[index]] = cells[index + 1];
    }
  });
  return values;
}

function classify(raw) {
  const text = `${raw.title}\n${raw.summaryMajorText || ""}\n${raw.summaryRegionText || ""}\n${raw.summaryPayText || ""}\n${raw.detailText || ""}`;
  const primaryContentText = `${raw.title}\n${raw.detailText || ""}`;
  const subjects = classifySubjects(primaryContentText) || classifySubjects(text) || [];
  const audiences = classifyAudiences(text);
  const schedule = classifySchedule(text);
  const pay = classifyPay(raw.summaryPayText, raw.detailText, schedule.classCount);
  const contact = classifyContact(raw.detailText);
  const locations = classifyLocations(raw.summaryRegionText, raw.detailText);
  const jobType = classifyJobType(text);
  const isBallet = subjects.includes("ballet");

  return {
    isBallet,
    balletConfidence: isBallet ? "high" : "low",
    dropReason: isBallet ? null : "발레 과목을 확인하지 못함",
    jobType,
    audiences,
    subjects,
    locations,
    schedule,
    pay,
    requirements: classifyRequirements(text),
    contact,
    dedupe: {
      entityKey: buildEntityKey(raw.company, locations),
      sameCompanyCandidates: [],
    },
    evidence: buildEvidence(text, { audiences, schedule, pay, subjects }),
  };
}

function classificationNeedsLlm(classification, raw) {
  const reasons = [];
  const text = `${raw.title || ""}\n${raw.summaryPayText || ""}\n${raw.detailText || ""}`;

  if (classification.audiences.includes("unknown")) reasons.push("audience_unknown");
  if (classification.schedule.timeSlots.includes("unknown")) reasons.push("time_unknown");
  if (classification.schedule.times.length === 0 && hasTimeExpression(text)) reasons.push("time_expression_unparsed");
  if (classification.pay.type === "unknown") reasons.push("pay_unknown");
  if (classification.subjects.length === 0 || classification.balletConfidence === "low") reasons.push("subject_or_ballet_low_confidence");

  return unique(reasons);
}

function shouldUseLlm(mode, reasons) {
  if (mode === "off") return false;
  if (mode === "all") return true;
  return reasons.length > 0;
}

async function callLlmFallback(openai, raw, ruleClassification, reasons) {
  const response = await openai.responses.create({
    model: llmModel,
    input: [
      {
        role: "system",
        content: [
          "너는 발레 강사 채용공고를 구조화하는 분류기다.",
          "원문에 없는 정보는 확정하지 말고 unknown 또는 null로 둔다.",
          "반드시 제공된 enum 값만 사용한다.",
          "근거가 부족하면 해당 필드 confidence를 low로 표시한다.",
          "룰 기반 결과를 참고하되, 원문 근거가 있는 경우에만 수정 제안한다.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            reasons,
            raw,
            ruleClassification: {
              isBallet: ruleClassification.isBallet,
              balletConfidence: ruleClassification.balletConfidence,
              jobType: ruleClassification.jobType,
              audiences: ruleClassification.audiences,
              subjects: ruleClassification.subjects,
              locations: ruleClassification.locations,
              schedule: ruleClassification.schedule,
              pay: ruleClassification.pay,
              requirements: ruleClassification.requirements,
              evidence: ruleClassification.evidence,
            },
          },
          null,
          2,
        ),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ballet_job_llm_fallback",
        strict: true,
        schema: llmFallbackSchema(),
      },
    },
  });

  const outputText = response.output_text || extractResponseText(response);
  if (!outputText) throw new Error("OpenAI response did not include output text.");
  return JSON.parse(outputText);
}

function extractResponseText(response) {
  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("");
}

function mergeLlmClassification(ruleClassification, llmResult, meta) {
  const merged = structuredClone(ruleClassification);
  const appliedFields = [];
  const confidence = llmResult.confidence || {};

  if (isApplicableConfidence(confidence.audiences) && isMeaningfulArray(llmResult.audiences, "unknown")) {
    merged.audiences = llmResult.audiences;
    appliedFields.push("audiences");
  }

  if (isApplicableConfidence(confidence.subjects) && isMeaningfulArray(llmResult.subjects, "other")) {
    merged.subjects = llmResult.subjects;
    merged.isBallet = merged.subjects.includes("ballet");
    merged.balletConfidence = merged.isBallet ? "high" : "low";
    merged.dropReason = merged.isBallet ? null : "발레 과목을 확인하지 못함";
    appliedFields.push("subjects");
  }

  if (isApplicableConfidence(confidence.jobType) && llmResult.jobType && llmResult.jobType !== "unknown") {
    merged.jobType = llmResult.jobType;
    appliedFields.push("jobType");
  }

  if (isApplicableConfidence(confidence.schedule) && llmResult.schedule) {
    const scheduleApplied = mergeSchedule(merged.schedule, llmResult.schedule);
    if (scheduleApplied.length) appliedFields.push(...scheduleApplied.map((field) => `schedule.${field}`));
  }

  if (isApplicableConfidence(confidence.pay) && llmResult.pay) {
    const payApplied = mergePay(merged.pay, llmResult.pay);
    if (payApplied.length) appliedFields.push(...payApplied.map((field) => `pay.${field}`));
  }

  if (isApplicableConfidence(confidence.requirements) && llmResult.requirements) {
    merged.requirements = {
      majorRequired: coalesce(llmResult.requirements.majorRequired, merged.requirements.majorRequired),
      experienceRequired: coalesce(llmResult.requirements.experienceRequired, merged.requirements.experienceRequired),
      certifications: unique([...merged.requirements.certifications, ...llmResult.requirements.certifications]),
      preferred: unique([...merged.requirements.preferred, ...llmResult.requirements.preferred]),
    };
    appliedFields.push("requirements");
  }

  merged.llm = {
    used: meta.used,
    reason: meta.reason,
    model: meta.model,
    appliedFields: unique(appliedFields),
    suggestion: llmResult,
    notes: llmResult.notes || [],
  };

  return merged;
}

function mergeSchedule(ruleSchedule, llmSchedule) {
  const applied = [];

  if (isMeaningfulArray(llmSchedule.days, "unknown")) {
    ruleSchedule.days = llmSchedule.days;
    ruleSchedule.dayRaw = llmSchedule.dayRaw || ruleSchedule.dayRaw;
    applied.push("days");
  }
  if (isMeaningfulArray(llmSchedule.timeSlots, "unknown")) {
    ruleSchedule.timeSlots = llmSchedule.timeSlots;
    applied.push("timeSlots");
  }
  if (Array.isArray(llmSchedule.times) && llmSchedule.times.length > 0) {
    ruleSchedule.times = llmSchedule.times;
    applied.push("times");
  }
  if (llmSchedule.classCount !== null && llmSchedule.classCount !== undefined) {
    ruleSchedule.classCount = llmSchedule.classCount;
    applied.push("classCount");
  }
  if (llmSchedule.durationMinutes !== null && llmSchedule.durationMinutes !== undefined) {
    ruleSchedule.durationMinutes = llmSchedule.durationMinutes;
    applied.push("durationMinutes");
  }
  if (llmSchedule.startDate) {
    ruleSchedule.startDate = llmSchedule.startDate;
    applied.push("startDate");
  }

  return applied;
}

function mergePay(rulePay, llmPay) {
  const applied = [];

  if (llmPay.type && llmPay.type !== "unknown") {
    rulePay.type = llmPay.type;
    applied.push("type");
  }
  for (const field of ["minManwon", "maxManwon", "amountText", "isNegotiable", "classCountBasis"]) {
    if (llmPay[field] !== null && llmPay[field] !== undefined && llmPay[field] !== "") {
      rulePay[field] = llmPay[field];
      applied.push(field);
    }
  }
  if (Array.isArray(llmPay.deductions) && llmPay.deductions.length > 0) {
    rulePay.deductions = unique([...rulePay.deductions, ...llmPay.deductions]);
    applied.push("deductions");
  }

  return applied;
}

function isApplicableConfidence(value) {
  return value === "high" || value === "medium";
}

function isMeaningfulArray(value, onlyMeaninglessValue) {
  return Array.isArray(value) && value.length > 0 && !(value.length === 1 && value[0] === onlyMeaninglessValue);
}

function coalesce(value, fallback) {
  return value === null || value === undefined ? fallback : value;
}

function llmFallbackSchema() {
  const confidenceEnum = ["high", "medium", "low"];
  const audienceEnum = ["toddler", "child", "elementary", "teen", "adult", "exam", "mixed", "unknown"];
  const subjectEnum = ["ballet", "barre", "ballet_fit", "kpop_dance", "modern_dance", "korean_dance", "pilates", "other"];
  const jobTypeEnum = ["regular", "substitute", "one_time", "unknown"];
  const timeSlotEnum = ["morning", "afternoon", "evening", "negotiable", "unknown"];
  const payTypeEnum = ["hourly", "per_class", "per_session_bundle", "monthly", "negotiable", "unknown"];

  return {
    type: "object",
    additionalProperties: false,
    required: ["audiences", "subjects", "jobType", "schedule", "pay", "requirements", "confidence", "notes"],
    properties: {
      audiences: {
        type: "array",
        items: { type: "string", enum: audienceEnum },
      },
      subjects: {
        type: "array",
        items: { type: "string", enum: subjectEnum },
      },
      jobType: { type: "string", enum: jobTypeEnum },
      schedule: {
        type: "object",
        additionalProperties: false,
        required: ["days", "dayRaw", "timeSlots", "times", "classCount", "durationMinutes", "startDate"],
        properties: {
          days: {
            type: "array",
            items: { type: "string", enum: ["월", "화", "수", "목", "금", "토", "일"] },
          },
          dayRaw: { type: ["string", "null"] },
          timeSlots: {
            type: "array",
            items: { type: "string", enum: timeSlotEnum },
          },
          times: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["start", "end", "raw"],
              properties: {
                start: { type: ["string", "null"] },
                end: { type: ["string", "null"] },
                raw: { type: "string" },
              },
            },
          },
          classCount: { type: ["number", "null"] },
          durationMinutes: { type: ["number", "null"] },
          startDate: { type: ["string", "null"] },
        },
      },
      pay: {
        type: "object",
        additionalProperties: false,
        required: ["type", "minManwon", "maxManwon", "amountText", "isNegotiable", "deductions", "classCountBasis"],
        properties: {
          type: { type: "string", enum: payTypeEnum },
          minManwon: { type: ["number", "null"] },
          maxManwon: { type: ["number", "null"] },
          amountText: { type: ["string", "null"] },
          isNegotiable: { type: "boolean" },
          deductions: {
            type: "array",
            items: { type: "string" },
          },
          classCountBasis: { type: ["number", "null"] },
        },
      },
      requirements: {
        type: "object",
        additionalProperties: false,
        required: ["majorRequired", "experienceRequired", "certifications", "preferred"],
        properties: {
          majorRequired: { type: ["boolean", "null"] },
          experienceRequired: { type: ["boolean", "null"] },
          certifications: {
            type: "array",
            items: { type: "string" },
          },
          preferred: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      confidence: {
        type: "object",
        additionalProperties: false,
        required: ["audiences", "subjects", "jobType", "schedule", "pay", "requirements"],
        properties: {
          audiences: { type: "string", enum: confidenceEnum },
          subjects: { type: "string", enum: confidenceEnum },
          jobType: { type: "string", enum: confidenceEnum },
          schedule: { type: "string", enum: confidenceEnum },
          pay: { type: "string", enum: confidenceEnum },
          requirements: { type: "string", enum: confidenceEnum },
        },
      },
      notes: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

function hasTimeExpression(text) {
  return /(?:\d{1,2}[:시]\s*\d{0,2}\s*(?:분)?\s*(?:~|-|부터|\/)\s*\d{1,2}[:시]?\s*\d{0,2})|(?:\d+\s*(?:타임|class|Class|CLASS|T)\b)/.test(
    text,
  );
}

function classifySubjects(text) {
  const subjects = [];
  if (/발레/.test(text)) subjects.push("ballet");
  if (/바레/.test(text)) subjects.push("barre");
  if (/발레\s*핏|발레핏/i.test(text)) subjects.push("ballet_fit");
  if (/k[\s-]?pop|케이팝|댄스/i.test(text)) subjects.push("kpop_dance");
  if (/현대무용/.test(text)) subjects.push("modern_dance");
  if (/한국무용/.test(text)) subjects.push("korean_dance");
  if (/필라테스/.test(text)) subjects.push("pilates");
  const uniqueSubjects = unique(subjects);
  return uniqueSubjects.length ? uniqueSubjects : null;
}

function classifyAudiences(text) {
  const audiences = [];
  if (/영유아|유치원|어린이집|5\s*[,.]?\s*6\s*[,.]?\s*7세|5\s*~\s*7세|5-7세|유아/.test(text)) {
    audiences.push("toddler");
  }
  if (/초등/.test(text)) audiences.push("elementary");
  if (/중등|고등|청소년/.test(text)) audiences.push("teen");
  if (/성인|취미반|직장인/.test(text)) audiences.push("adult");
  if (/입시|전공반/.test(text)) audiences.push("exam");
  return audiences.length ? unique(audiences) : ["unknown"];
}

function classifyJobType(text) {
  if (!/대타\s*가\s*아닌|대타\s*아닌/.test(text) && /대타|대강|당일|이번\s*주/.test(text)) {
    return "substitute";
  }
  if (/단기|이벤트|특강/.test(text)) return "one_time";
  if (/정식|오래|장기|고정|매주|월\s*~\s*금|월~금|함께/.test(text)) return "regular";
  return "regular";
}

function classifyLocations(summaryRegionText, detailText) {
  const source = summaryRegionText || "";
  const locations = source
    .split(",")
    .map((part) => cleanText(part))
    .filter(Boolean)
    .map((raw) => {
      const tokens = raw.split(/\s+/);
      return {
        sido: tokens[0] || null,
        sigungu: tokens.slice(1).join(" ") || null,
        dongOrStation: extractDongOrStation(detailText),
        raw,
      };
    });

  return locations.length ? locations : [{ sido: null, sigungu: null, dongOrStation: extractDongOrStation(detailText), raw: null }];
}

function extractDongOrStation(text) {
  const station = text.match(/[가-힣A-Za-z0-9]+역/);
  if (station) return station[0];
  const dong = text.match(/[가-힣A-Za-z0-9]+동/);
  if (dong) return dong[0];
  return null;
}

function classifySchedule(text) {
  const dayEvidence = [];
  const days = new Set();
  const compactText = text.replace(/\s+/g, "");

  const dayPatterns = [
    ["월", /월요일|(?<![가-힣0-9])월(?![가-힣])|월\s*[~,-]\s*금|월수|월금|월수금|월,\s*화,\s*토/],
    ["화", /화요일|(?<![가-힣0-9])화(?![가-힣])|화목|화,\s*목|월,\s*화,\s*토/],
    ["수", /수요일|(?<![가-힣0-9])수(?![가-힣])|월수|수금|월수금|수,\s*금/],
    ["목", /목요일|(?<![가-힣0-9])목(?![가-힣])|화목|화,\s*목/],
    ["금", /금요일|(?<![가-힣0-9])금(?![가-힣])|월금|수금|월수금|월\s*[~,-]\s*금|수,\s*금/],
    ["토", /토요일|(?<![가-힣0-9])토(?![가-힣])|월,\s*화,\s*토/],
    ["일", /일요일|(?<![가-힣0-9])일(?![가-힣])/],
  ];

  for (const [day, regex] of dayPatterns) {
    if (regex.test(text)) days.add(day);
  }

  const compactPatterns = [
    ["월수금", ["월", "수", "금"]],
    ["월수", ["월", "수"]],
    ["월금", ["월", "금"]],
    ["화목", ["화", "목"]],
    ["수금", ["수", "금"]],
  ];

  for (const [pattern, patternDays] of compactPatterns) {
    if (compactText.includes(pattern)) {
      patternDays.forEach((day) => days.add(day));
    }
  }

  if (/월\s*[~,-]\s*금|월~금/.test(text)) {
    ["월", "화", "수", "목", "금"].forEach((day) => days.add(day));
  }

  if (/일\s*중\s*하루|하루\s*정/.test(text)) {
    days.delete("일");
  }

  const timeMatches = [...text.matchAll(/([01]?\d|2[0-3])[:시]\s*([0-5]\d)?\s*(?:분)?\s*(?:~|-|부터)\s*([01]?\d|2[0-3])[:시]\s*([0-5]\d)?/g)];
  const times = timeMatches.map((match) => {
    const start = normalizeTime(match[1], match[2]);
    const end = normalizeTime(match[3], match[4]);
    return { start, end, raw: cleanText(match[0]) };
  });

  const timeSlots = new Set();
  if (/오전/.test(text) || times.some((time) => hourOf(time.start) < 12)) timeSlots.add("morning");
  if (/오후/.test(text) || times.some((time) => hourOf(time.start) >= 12 && hourOf(time.start) < 18)) timeSlots.add("afternoon");
  if (/저녁|밤/.test(text) || times.some((time) => hourOf(time.start) >= 18)) timeSlots.add("evening");
  if (/협의|조절가능|가능한 시간대/.test(text)) timeSlots.add("negotiable");

  const classCount = extractClassCount(text);
  const durationMinutes = extractDurationMinutes(text);

  if (days.size) dayEvidence.push(...[...days]);

  return {
    days: [...days],
    dayRaw: dayEvidence.length ? dayEvidence.join(",") : null,
    timeSlots: timeSlots.size ? [...timeSlots] : ["unknown"],
    times,
    classCount,
    durationMinutes,
    startDate: null,
  };
}

function classifyPay(summaryPayText, detailText, classCount) {
  const text = `${summaryPayText || ""}\n${detailText || ""}`;
  const deductions = [];
  for (const match of text.matchAll(/(?:소득세\s*)?3\.3%|산재보험료\s*0\.3%|총\s*3\.6%|3\.6%\s*차감/g)) {
    deductions.push(cleanText(match[0]));
  }

  let type = "unknown";
  let minManwon = null;
  let maxManwon = null;
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:만원|만)\s*(?:~|-)\s*(\d+(?:\.\d+)?)\s*(?:만원|만)/);
  const bundle = text.match(/(\d+)\s*회\s*기준\s*(\d+(?:\.\d+)?)\s*만/);
  const single = text.match(/(?:시급|페이|급여|회당|타임당)?\s*(\d+(?:\.\d+)?)\s*(?:만원|만)/);

  if (bundle) {
    type = "per_session_bundle";
    minManwon = Number(bundle[2]);
    maxManwon = Number(bundle[2]);
  } else if (range) {
    type = /시간|시급/.test(text) || summaryPayText ? "hourly" : "per_class";
    minManwon = Number(range[1]);
    maxManwon = Number(range[2]);
  } else if (single) {
    type = /시간|시급/.test(text) || summaryPayText ? "hourly" : "per_class";
    minManwon = Number(single[1]);
    maxManwon = Number(single[1]);
  } else if (/협의|추후\s*협의/.test(text)) {
    type = "negotiable";
  }

  return {
    type,
    minManwon,
    maxManwon,
    amountText: summaryPayText || extractPaySentence(detailText),
    isNegotiable: /협의|조정|가능한/.test(text),
    deductions: unique(deductions),
    classCountBasis: type === "per_session_bundle" ? classCount : null,
  };
}

function classifyRequirements(text) {
  const certifications = [];
  const preferred = [];

  if (/필라테스\s*자격증|필라테스/.test(text)) certifications.push("필라테스");
  if (/스피커\s*지참/.test(text)) preferred.push("스피커 지참");
  if (/튜튜\s*착용/.test(text)) preferred.push("튜튜 착용");
  if (/유치원\/어린이집\s*경험|유치원|어린이집/.test(text)) preferred.push("유치원/어린이집 경험");
  if (/티칭\s*경험|수업\s*경험/.test(text)) preferred.push("티칭 경험");

  return {
    majorRequired: /발레\s*전공\s*필수|발레\s*전공자|발레전공/.test(text) ? true : null,
    experienceRequired: /경력무관/.test(text) ? false : null,
    certifications: unique(certifications),
    preferred: unique(preferred),
  };
}

function classifyContact(text) {
  const emails = unique([...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0]));
  const phones = unique(
    [...text.matchAll(/01[016789][-. ]?\d{3,4}[-. ]?\d{4}/g)].map((match) => normalizePhone(match[0])),
  );
  const applyMethods = [];
  if (/이메일|메일/.test(text) || emails.length) applyMethods.push("email");
  if (/문자|sms/i.test(text)) applyMethods.push("sms");
  if (/전화/.test(text)) applyMethods.push("phone");
  if (/온라인/.test(text)) applyMethods.push("online");
  if (/카카오|톡/.test(text)) applyMethods.push("kakao");

  return {
    emails,
    phones,
    applyMethods: applyMethods.length ? unique(applyMethods) : ["unknown"],
  };
}

function buildEntityKey(company, locations) {
  const location = locations[0] || {};
  return [company, location.sido, location.sigungu].filter(Boolean).join("|");
}

function buildEvidence(text, classification) {
  return {
    audiences: pickEvidence(text, ["성인", "유아", "초등", "5~7세", "어린이집", "유치원", "입시"]),
    subjects: pickEvidence(text, ["발레", "바레", "발레핏", "K-pop", "댄스", "현대무용", "한국무용", "필라테스"]),
    days: pickEvidence(text, ["월", "화", "수", "목", "금", "토", "일", "월~금", "화목", "월수금"]),
    pay: pickEvidence(text, [classification.pay.amountText, "시급", "페이", "만원", "협의", "3.3%", "3.6%"].filter(Boolean)),
  };
}

function pickEvidence(text, needles) {
  return unique(needles.filter((needle) => needle && text.includes(needle))).slice(0, 8);
}

function extractClassCount(text) {
  const match = text.match(/(\d+)\s*(?:타임|class|Class|CLASS|회기|회\s*기준)/);
  return match ? Number(match[1]) : null;
}

function extractDurationMinutes(text) {
  const match = text.match(/(\d+)\s*분/);
  return match ? Number(match[1]) : null;
}

function extractPaySentence(text) {
  const match = text.match(/[^.。\n]*(?:페이|시급|급여|수업료|만원|협의)[^.。\n]*/);
  return match ? cleanText(match[0]) : null;
}

function normalizeTime(hour, minute) {
  return `${hour.padStart(2, "0")}:${(minute || "00").padStart(2, "0")}`;
}

function hourOf(time) {
  return Number(time.slice(0, 2));
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

function cleanDetailText(value) {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
