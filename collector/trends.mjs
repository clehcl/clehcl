#!/usr/bin/env node
/**
 * 식자재 클리핑 — 키워드 트렌드 수집기
 *
 * config/keywords.json 의 trends.groups 키워드로 네이버 데이터랩 검색어 트렌드를
 * 일·주·월 단위로 받아, 일/주/월/연 핵심 키워드 트렌드를 계산해 data/news.json 의
 * "trends" 필드에 병합합니다. (fetch.mjs 실행 뒤에 돌리세요.)
 *
 * 실행:  NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=... node collector/trends.mjs
 * 키가 없으면 기존 trends 를 유지하고 종료합니다.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG_PATH = resolve(ROOT, "config/keywords.json");
const OUT_PATH = resolve(ROOT, "data/news.json");

const CLIENT_ID = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function pct(a, b) {
  return b ? Math.round(((a - b) / b) * 1000) / 10 : 0;
}
function r1(x) {
  return Math.round(x * 10) / 10;
}

async function datalab(startDate, endDate, timeUnit, groups) {
  const res = await fetch("https://openapi.naver.com/v1/datalab/search", {
    method: "POST",
    headers: {
      "X-Naver-Client-Id": CLIENT_ID,
      "X-Naver-Client-Secret": CLIENT_SECRET,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      startDate,
      endDate,
      timeUnit,
      keywordGroups: groups.map((g) => ({ groupName: g.name, keywords: g.keywords }))
    })
  });
  if (!res.ok) throw new Error(`DataLab ${res.status}: ${await res.text()}`);
  const json = await res.json();
  // groupName → ratio[] (period 오름차순)
  const map = {};
  for (const r of json.results) map[r.title] = r.data.map((d) => d.ratio);
  return map;
}

// 마지막 구간이 아직 진행 중이면(값이 직전의 40% 미만으로 급락) 미완성으로 보고 제거
function dropPartialTail(arr) {
  if (arr.length >= 2 && arr[arr.length - 1] < arr[arr.length - 2] * 0.4) {
    return arr.slice(0, -1);
  }
  return arr;
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const groups = (config.trends && config.trends.groups) || [];
  if (!groups.length) {
    console.warn("[trends] config.trends.groups 가 비어 있어 건너뜁니다.");
    return;
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn("[trends] NAVER 키가 없어 트렌드 수집을 건너뜁니다. 기존 trends 유지.");
    return;
  }

  const today = ymd(new Date());
  const dayMap = await datalab(ymd(daysAgo(29)), today, "date", groups);
  const weekMap = await datalab(ymd(daysAgo(91)), today, "week", groups);
  const monthMap = await datalab(ymd(daysAgo(400)), today, "month", groups);

  function build(period) {
    return groups
      .map((g) => {
        let spark, value, change;
        if (period === "day") {
          spark = dayMap[g.name] || [];
          value = spark[spark.length - 1];
          change = pct(value, spark[spark.length - 8]); // 7일 전 대비
        } else if (period === "week") {
          spark = dropPartialTail(weekMap[g.name] || []);
          value = spark[spark.length - 1];
          change = pct(value, spark[spark.length - 2]);
        } else if (period === "month") {
          spark = dropPartialTail(monthMap[g.name] || []);
          value = spark[spark.length - 1];
          change = pct(value, spark[spark.length - 2]);
        } else {
          spark = dropPartialTail(monthMap[g.name] || []);
          value = spark[spark.length - 1];
          change = pct(value, spark[Math.max(0, spark.length - 13)]); // 전년 동월
        }
        return { name: g.name, color: g.color, value: r1(value), change, spark: spark.map(r1) };
      })
      .sort((a, b) => b.value - a.value);
  }

  const trends = {
    generatedAt: new Date().toISOString(),
    source: "네이버 데이터랩 검색어 트렌드 (상대 관심도, 최대=100)",
    periods: {
      day: { label: "일별", basis: "최근 30일 · 7일 전 대비", items: build("day") },
      week: { label: "주별", basis: "최근 13주 · 전주 대비", items: build("week") },
      month: { label: "월별", basis: "최근 13개월 · 전월 대비", items: build("month") },
      year: { label: "연간", basis: "전년 동월 대비", items: build("year") }
    }
  };

  const nj = JSON.parse(await readFile(OUT_PATH, "utf8"));
  nj.trends = trends;
  await writeFile(OUT_PATH, JSON.stringify(nj, null, 2) + "\n", "utf8");
  console.log("[trends] 병합 완료 — 일별 1위:", trends.periods.day.items[0].name);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
