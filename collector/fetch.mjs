import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG_PATH = resolve(ROOT, "config/keywords.json");
const OUT_PATH = resolve(ROOT, "data/news.json");

const SOURCE_MAP = {
  "한국경제": ["한", "#1a4d8f"], "매일경제": ["매", "#c0392b"], "서울경제": ["서", "#c0392b"],
  "아시아경제": ["아", "#3a7a3a"], "뉴시스": ["뉴", "#333333"], "뉴스1": ["뉴", "#c15a37"],
  "연합뉴스": ["연", "#1a4d8f"], "머니투데이": ["머", "#c0392b"], "조선비즈": ["조", "#1a4d8f"],
  "쿠키뉴스": ["쿠", "#c15a37"], "이데일리": ["이", "#1a7a5a"], "헤럴드경제": ["헤", "#8a5cc4"],
  "파이낸셜뉴스": ["파", "#1a4d8f"], "농민신문": ["농", "#2f7d4f"]
};
const PALETTE = ["#c0392b", "#1a4d8f", "#2f7d4f", "#8a5cc4", "#c98a2b", "#3a6ea5", "#b03a6a", "#1a7a5a", "#c15a37", "#333333"];

function decodeEntities(s) {
  return (s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, "&");
}
function stripTags(s) {
  return (s || "").replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function sourceMeta(name) {
  if (SOURCE_MAP[name]) return SOURCE_MAP[name];
  const initial = (name || "뉴스").replace(/\s/g, "").slice(0, 2) || "N";
  let h = 0;
  for (const c of name || "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [initial, PALETTE[h % PALETTE.length]];
}
function normTitle(t) {
  return (t || "").replace(/[\s\W]/g, "").toLowerCase();
}

async function fetchRSS(query) {
  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query + " when:2d") +
    "&hl=ko&gl=KR&ceid=KR:ko";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (clehcl-clipping)" } });
  if (!res.ok) throw new Error(`RSS ${res.status} for "${query}"`);
  return await res.text();
}

function parseItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const pick = (tag) => {
      const r = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">");
      const x = r.exec(block);
      return x ? x[1] : "";
    };
    let title = decodeEntities(stripTags(pick("title")));
    const link = decodeEntities(pick("link").trim());
    const pub = pick("pubDate").trim();
    let source = decodeEntities(stripTags(pick("source")));
    if (!source && title.includes(" - ")) {
      const i = title.lastIndexOf(" - ");
      source = title.slice(i + 3).trim();
      title = title.slice(0, i).trim();
    } else if (source && title.endsWith(" - " + source)) {
      title = title.slice(0, title.length - (source.length + 3)).trim();
    }
    let summary = decodeEntities(stripTags(pick("description")));
    if (!summary || summary.includes(title.slice(0, 12)) || summary.length < 20) summary = "";
    else if (summary.length > 140) summary = summary.slice(0, 140) + "…";
    if (title) items.push({ title, link, pub, source, summary });
  }
  return items;
}

function passesFilter(text, global) {
  const t = text || "";
  if (global.exclude?.some((w) => t.includes(w))) return false;
  if (global.require?.length && !global.require.some((w) => t.includes(w))) return false;
  return true;
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const perCat = config.site?.perCategory || 8;
  const seen = new Set();
  const outCategories = [];

  for (const cat of config.categories) {
    const collected = [];
    for (const q of cat.queries) {
      let xml;
      try {
        xml = await fetchRSS(q);
      } catch (e) {
        console.error(`[collector] "${q}" 실패:`, e.message);
        continue;
      }
      for (const it of parseItems(xml)) {
        const key = normTitle(it.title);
        if (!key || seen.has(key)) continue;
        if (!passesFilter(it.title + " " + it.summary, config.global)) continue;
        const [initial, color] = sourceMeta(it.source);
        const when = it.pub ? new Date(it.pub) : new Date();
        const score = (cat.boost || []).reduce((s, w) => s + (it.title.includes(w) ? 1 : 0), 0);
        seen.add(key);
        collected.push({
          title: it.title,
          summary: it.summary,
          url: it.link,
          source: it.source || "뉴스",
          sourceInitial: initial,
          sourceColor: color,
          publishedAt: when.toISOString(),
          tags: (cat.boost || []).filter((w) => it.title.includes(w)).slice(0, 2),
          price: null,
          _score: score
        });
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    collected.sort(
      (a, b) => b._score - a._score || new Date(b.publishedAt) - new Date(a.publishedAt)
    );
    const items = collected.slice(0, perCat).map((x, i) => {
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

  let prevTrends = null;
  try {
    prevTrends = JSON.parse(await readFile(OUT_PATH, "utf8")).trends || null;
  } catch {}

  const out = {
    generatedAt: new Date().toISOString(),
    site: config.site,
    categories: outCategories
  };
  if (prevTrends) out.trends = prevTrends;

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[collector] 저장 완료 → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
