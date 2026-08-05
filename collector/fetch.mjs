#!/usr/bin/env node
/**
 * 식자재 클리핑 — 뉴스 수집기
 *
 * config/keywords.json 의 카테고리별 검색어로 네이버 뉴스 오픈 API를 호출하고,
 * 제외/필수 규칙으로 걸러 카테고리에 배치한 뒤 data/news.json 으로 저장합니다.
 *
 * 실행:  NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=... node collector/fetch.mjs
 *
 * 키가 없으면(예: 로컬에서 그냥 미리보기) 수집을 건너뛰고 기존 data/news.json 을
 * 그대로 둡니다. 시드 데이터가 이미 들어 있으므로 화면은 정상 동작합니다.
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

// 매체명 추정: 원문 링크 호스트 → 표시용 이름/이니셜/색
const SOURCE_MAP = {
  "hankyung.com": ["한국경제", "한", "#1a4d8f"],
  "mk.co.kr": ["매일경제", "매", "#c0392b"],
  "sedaily.com": ["서울경제", "서", "#c0392b"],
  "sentv.co.kr": ["서울경제TV", "S", "#1a4d8f"],
  "asiae.co.kr": ["아시아경제", "아", "#3a7a3a"],
  "newsis.com": ["뉴시스", "뉴", "#333333"],
  "news1.kr": ["뉴스1", "뉴", "#c15a37"],
  "yna.co.kr": ["연합뉴스", "연", "#1a4d8f"],
  "mtn.co.kr": ["머니투데이방송", "M", "#c0392b"],
  "chosun.com": ["조선비즈", "조", "#1a4d8f"],
  "kukinews.com": ["쿠키뉴스", "쿠", "#c15a37"],
  "cnbnews.com": ["CNB뉴스", "C", "#1a4d8f"],
  "theguru.co.kr": ["더구루", "더", "#c0392b"],
  "ziksir.com": ["직썰", "직", "#b03a6a"],
  "goodkyung.com": ["굿모닝경제", "굿", "#3a7a3a"],
  "thefairnews.co.kr": ["페어뉴스", "페", "#8a5cc4"],
  "issuenbiz.com": ["이슈앤비즈", "이", "#1a7a5a"],
  "smartbizn.com": ["스마트비즈", "스", "#3a6ea5"],
  "jibs.co.kr": ["JIBS", "J", "#1a7a5a"],
  "etoday.co.kr": ["이투데이", "이", "#c0392b"],
  "newspim.com": ["뉴스핌", "핌", "#1a4d8f"]
};

function sourceOf(link) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "");
    for (const key of Object.keys(SOURCE_MAP)) {
      if (host.endsWith(key)) return SOURCE_MAP[key];
    }
    // n.news.naver.com 등은 원문 매체를 알 수 없으니 도메인 앞글자로 대체
    const label = host.split(".")[0];
    return [label, label.slice(0, 2).toUpperCase(), "#6b675c"];
  } catch {
    return ["뉴스", "N", "#6b675c"];
  }
}

function stripTags(s) {
  return (s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function normTitle(t) {
  return stripTags(t).replace(/[\s\W]/g, "").toLowerCase();
}

async function searchNaver(query, display = 20) {
  const url =
    "https://openapi.naver.com/v1/search/news.json?sort=date&display=" +
    display +
    "&query=" +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": CLIENT_ID,
      "X-Naver-Client-Secret": CLIENT_SECRET
    }
  });
  if (!res.ok) {
    throw new Error(`Naver API ${res.status} for "${query}": ${await res.text()}`);
  }
  const json = await res.json();
  return json.items || [];
}

function passesFilter(text, global) {
  const t = text || "";
  if (global.exclude?.some((w) => t.includes(w))) return false;
  if (global.require?.length && !global.require.some((w) => t.includes(w))) return false;
  return true;
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn(
      "[collector] NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 가 없어 수집을 건너뜁니다. " +
        "기존 data/news.json 을 유지합니다."
    );
    process.exit(0);
  }

  const seen = new Set(); // 카테고리 간 중복 제거 (config 순서상 앞 카테고리 우선)
  const outCategories = [];

  for (const cat of config.categories) {
    const collected = [];
    for (const q of cat.queries) {
      let items = [];
      try {
        items = await searchNaver(q, 20);
      } catch (e) {
        console.error(`[collector] "${q}" 검색 실패:`, e.message);
        continue;
      }
      for (const it of items) {
        const title = stripTags(it.title);
        const summary = stripTags(it.description);
        const key = normTitle(title);
        if (!key || seen.has(key)) continue;
        if (!passesFilter(title + " " + summary, config.global)) continue;
        const link = it.link || it.originallink;
        const [srcName, srcInitial, srcColor] = sourceOf(it.originallink || it.link);
        // boost 키워드가 제목/요약에 있으면 정렬 시 가점
        const score = (cat.boost || []).reduce(
          (s, w) => s + ((title + summary).includes(w) ? 1 : 0),
          0
        );
        seen.add(key);
        collected.push({
          title,
          summary,
          url: link,
          source: srcName,
          sourceInitial: srcInitial,
          sourceColor: srcColor,
          publishedAt: new Date(it.pubDate).toISOString(),
          tags: (cat.boost || []).filter((w) => (title + summary).includes(w)).slice(0, 2),
          price: null,
          _score: score
        });
      }
      await new Promise((r) => setTimeout(r, 120)); // API 예의상 약간의 간격
    }
    // 가점 → 최신순으로 정렬, 상한만큼 자르고 첫 항목을 대표(feat)로
    collected.sort(
      (a, b) => b._score - a._score || new Date(b.publishedAt) - new Date(a.publishedAt)
    );
    const items = collected.slice(0, config.site.perCategory || 8).map((x, i) => {
      const { _score, ...rest } = x;
      return { ...rest, feat: i === 0 };
    });
    outCategories.push({
      id: cat.id,
      name: cat.name,
      color: cat.color,
      queries: cat.queries,
      total: collected.length,
      items
    });
    console.log(`[collector] ${cat.name}: ${items.length}건 (후보 ${collected.length})`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    site: config.site,
    categories: outCategories
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[collector] 저장 완료 → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
