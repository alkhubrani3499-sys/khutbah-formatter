import fs from 'node:fs';
import path from 'node:path';
import { normalizeForMatch } from '@/lib/arabic';

// بيانات المصحف من Tanzil (حفص عن عاصم): w = الكلمات الإملائية، u = الكلمات بالرسم العثماني،
// m[j] = رقم الكلمة العثمانية المقابلة للكلمة الإملائية j، ok = تطابق كامل كلمةً بكلمة.
interface Ayah {
  s: number;
  a: number;
  w: string[];
  u: string[];
  m: number[];
  ok: boolean;
}

interface Index {
  ayahs: Ayah[];
  flat: string[]; // الكلمات المطبَّعة لكل المصحف متتابعة
  pos: Int32Array; // pos[2p] = رقم الآية، pos[2p+1] = رقم الكلمة داخلها
  uni: Map<string, number[]>;
  bi: Map<string, number[]>;
}

let cache: Index | null = null;

function load(): Index {
  if (cache) return cache;
  const file = path.join(process.cwd(), 'data', 'quran.json');
  if (!fs.existsSync(file)) throw new Error('بيانات المصحف غير موجودة: شغّل npm run setup:data');
  const ayahs: Ayah[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const flat: string[] = [];
  const posArr: number[] = [];
  ayahs.forEach((ay, ai) =>
    ay.w.forEach((w, j) => {
      flat.push(normalizeForMatch(w));
      posArr.push(ai, j);
    }),
  );
  const uni = new Map<string, number[]>();
  const bi = new Map<string, number[]>();
  for (let p = 0; p < flat.length; p++) {
    (uni.get(flat[p]) ?? uni.set(flat[p], []).get(flat[p])!).push(p);
    if (p + 1 < flat.length) {
      const k = flat[p] + ' ' + flat[p + 1];
      (bi.get(k) ?? bi.set(k, []).get(k)!).push(p);
    }
  }
  cache = { ayahs, flat, pos: Int32Array.from(posArr), uni, bi };
  return cache;
}

export interface QuranMatch {
  text: string; // النص بالرسم العثماني
  ref: string;
  score: number;
}

/** تحويل مدى من مواضع المصحف [from..to] إلى النص العثماني */
function uthmaniRange(ix: Index, from: number, to: number): { text: string; ref: string } {
  const out: string[] = [];
  let lastKey = '';
  const firstAyah = ix.ayahs[ix.pos[2 * from]];
  const lastAyah = ix.ayahs[ix.pos[2 * to]];
  for (let p = from; p <= to; p++) {
    const ai = ix.pos[2 * p];
    const j = ix.pos[2 * p + 1];
    const ay = ix.ayahs[ai];
    if (!ay.ok) {
      // الآيات القليلة التي لا تتطابق كلمةً بكلمة تُنقل كاملة
      const key = `${ai}:*`;
      if (lastKey !== key) out.push(...ay.u);
      lastKey = key;
      continue;
    }
    const key = `${ai}:${ay.m[j]}`;
    if (key !== lastKey) out.push(ay.u[ay.m[j]]);
    lastKey = key;
  }
  const ref =
    firstAyah.s === lastAyah.s && firstAyah.a !== lastAyah.a
      ? `${firstAyah.s}:${firstAyah.a}-${lastAyah.a}`
      : `${firstAyah.s}:${firstAyah.a}`;
  return { text: out.join(' '), ref };
}

/** مطابقة مقطع نصي (كما كتبه الخطيب) مع موضعه في المصحف */
export function matchQuran(inputWords: string[]): QuranMatch | null {
  const ix = load();
  const nw = inputWords.map(normalizeForMatch).filter(Boolean);
  const n = nw.length;
  if (n === 0) return null;

  // نقاط ارتكاز: أندر كلمات المقطع
  const anchors = nw
    .map((w, o) => ({ o, list: ix.uni.get(w) ?? [] }))
    .filter((x) => x.list.length > 0)
    .sort((x, y) => x.list.length - y.list.length)
    .slice(0, 3);
  const starts = new Set<number>();
  for (const { o, list } of anchors) for (const p of list) if (p - o >= 0) starts.add(p - o);

  let best: { score: number; from: number; to: number } | null = null;
  for (const st of starts) {
    // أطول تتابع مشترك بين المقطع ونافذة من المصحف (يتسامح مع كلمة ناقصة أو زائدة)
    const win = Math.min(n + 2, ix.flat.length - st);
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(win + 1).fill(0));
    for (let i = 1; i <= n; i++)
      for (let j = 1; j <= win; j++)
        dp[i][j] = nw[i - 1] === ix.flat[st + j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    const lcs = dp[n][win];
    if (!lcs) continue;
    // تحديد أول وآخر موضع مطابق
    let i = n;
    let j = win;
    let first = -1;
    let last = -1;
    while (i > 0 && j > 0) {
      if (nw[i - 1] === ix.flat[st + j - 1]) {
        if (last < 0) last = st + j - 1;
        first = st + j - 1;
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
      else j--;
    }
    const score = lcs / n;
    if (!best || score > best.score || (score === best.score && last - first < best.to - best.from))
      best = { score, from: first, to: last };
  }
  if (!best) return null;
  const need = n >= 3 ? 0.8 : 1;
  if (best.score < need) return null;
  const { text, ref } = uthmaniRange(ix, best.from, best.to);
  return { text, ref, score: best.score };
}

/** البحث عن آيات لم يُعلَّم عليها: أي تتابع من ٥ كلمات فأكثر يطابق المصحف حرفياً */
export function findUntaggedVerses(inputWords: string[], minLen = 5): Array<{ start: number; end: number }> {
  const ix = load();
  const nw = inputWords.map(normalizeForMatch);
  const found: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < nw.length - 1) {
    let bestLen = 0;
    const list = nw[i] && nw[i + 1] ? ix.bi.get(nw[i] + ' ' + nw[i + 1]) ?? [] : [];
    for (const p of list) {
      let len = 0;
      while (i + len < nw.length && p + len < ix.flat.length && nw[i + len] === ix.flat[p + len]) len++;
      if (len > bestLen) bestLen = len;
    }
    if (bestLen >= minLen) {
      found.push({ start: i, end: i + bestLen - 1 });
      i += bestLen;
    } else i++;
  }
  return found;
}
