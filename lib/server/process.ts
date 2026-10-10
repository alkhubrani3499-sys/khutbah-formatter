import { letters, splitPunct, stripDiacritics, words } from '@/lib/arabic';
import type { Block, BlockKind, Correction, DiacriticsMode, KhutbahDoc, SegKind, Segment } from '@/lib/types';
import { diacritizeChunk, type LlmOutput, type LlmParagraph } from './llm';
import { findUntaggedVerses, matchQuran } from './quran';

const CHUNK_WORDS = 450;
const CONCURRENCY = 4;

// ---------- 1) تهيئة المدخل: فصل الفقرات وإزالة رموز التعداد (تنسيق لا نص) ----------
const MARKER = /^\s*(?:[•●○◦▪■◼□◆◇►▶➢✓✔\-–—*·]|\(?[0-9٠-٩]+[.\-)\]]|\(?[أابجده][.\-)])\s*/u;
const HEADING = /^[\s\[\(【❪]*(الخطبة|الخُطبة)\s+(الأولى|الأولي|الثانية|الثانيه)[\s\]\)】❫:]*$/;

export interface Para extends LlmParagraph {
  tokens: string[];
}

export function prepare(raw: string): Para[] {
  const out: Para[] = [];
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    let text = line.trim();
    if (!text) continue;
    let hint: BlockKind | undefined;
    if (HEADING.test(stripDiacritics(text))) {
      hint = 'heading';
      text = text.replace(/^[\s\[\(【❪]+|[\s\]\)】❫:]+$/g, '');
    } else if (MARKER.test(text)) {
      const m = text.match(MARKER)![0];
      hint = /[■◼□◆◇]/.test(m) ? 'lead' : 'bullet';
      text = text.slice(m.length).trim();
    }
    if (!letters(text)) continue;
    out.push({ id: out.length, text, hint, tokens: words(text) });
  }
  return out;
}

function chunk(paras: Para[]): Para[][] {
  const chunks: Para[][] = [];
  let cur: Para[] = [];
  let n = 0;
  for (const p of paras) {
    if (cur.length && n + p.tokens.length > CHUNK_WORDS) {
      chunks.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(p);
    n += p.tokens.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

// ---------- 2) تحليل الوسوم في مخرج النموذج ----------
interface OutTok {
  text: string;
  kind: SegKind;
  group: number; // رقم وسم الآية (لتجميع كلمات الآية الواحدة)
}

const TAG_KIND: Record<string, SegKind> = { q: 'quran', h: 'hadith', l: 'lead', e: 'emph' };

function parseMarked(marked: string): OutTok[] {
  const toks: OutTok[] = [];
  let kind: SegKind = 'text';
  let group = -1;
  let groupCounter = 0;
  for (const piece of marked.split(/(<\/?[qhle]>)/)) {
    const tag = piece.match(/^<(\/?)([qhle])>$/);
    if (tag) {
      if (tag[1]) kind = 'text';
      else {
        kind = TAG_KIND[tag[2]];
        if (kind === 'quran') group = groupCounter++;
      }
      continue;
    }
    for (const w of words(piece)) toks.push({ text: w, kind, group: kind === 'quran' ? group : -1 });
  }
  return toks;
}

// ---------- 3) المطابقة مع النص الأصلي وضمان عدم التغيير ----------
interface FinalTok {
  orig: string; // الكلمة كما كتبها الخطيب
  text: string; // الكلمة النهائية (مشكولة)
  kind: SegKind;
  group: number;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** هل التغيير تصحيح إعرابي مصرَّح به؟ (مسجَّل في القائمة، وفي حدود حرف أو حرفين) */
function allowedCorrection(orig: string, out: string, list: LlmOutput['corrections']): Correction | null {
  const lo = letters(orig);
  const lc = letters(out);
  if (!lo || !lc || levenshtein(lo, lc) > 2) return null;
  for (const c of list) {
    const os = words(c.original).map(letters);
    const cs = words(c.corrected).map(letters);
    if (os.includes(lo) && cs.includes(lc)) return { original: orig, corrected: out, reason: c.reason };
  }
  return null;
}

function reconcile(
  inTokens: string[],
  outToks: OutTok[],
  corrections: LlmOutput['corrections'],
  accepted: Correction[],
  warnings: string[],
): FinalTok[] {
  const A = inTokens.map(letters);
  const B = outToks.map((t) => letters(t.text));
  // رموز بلا حروف في المخرج (ترقيم مستقل) تُهمل؛ الترقيم يؤخذ من الأصل دائماً
  const n = A.length;
  const m = B.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] && A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const res: FinalTok[] = [];
  const keepOrig = (tok: string, near?: OutTok) =>
    res.push({ orig: tok, text: tok, kind: near?.kind === 'quran' ? 'quran' : near?.kind ?? 'text', group: near?.kind === 'quran' ? near.group : -1 });
  const merge = (orig: string, out: OutTok) => {
    const o = splitPunct(orig);
    const c = splitPunct(out.text);
    res.push({ orig, text: o.pre + c.core + o.post, kind: out.kind, group: out.group });
  };

  let i = 0;
  let j = 0;
  let reverted = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] && A[i] === B[j]) {
      merge(inTokens[i++], outToks[j++]);
      continue;
    }
    // منطقة اختلاف: نجمع الكلمات غير المتطابقة من الطرفين حتى نقطة الالتقاء التالية
    const di: number[] = [];
    const dj: number[] = [];
    while (i < n || j < m) {
      if (i < n && j < m && A[i] && A[i] === B[j]) break;
      if (j < m && !B[j]) {
        j++; // ترقيم مستقل في المخرج
      } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) di.push(i++);
      else dj.push(j++);
    }
    // تُقابَل الكلمات ذات الحروف فقط؛ رموز الترقيم المستقلة لا تُحتسب في المقابلة
    const lettered = di.filter((x) => A[x]);
    const sameCount = lettered.length === dj.length;
    for (let k = 0; k < di.length; k++) {
      const orig = inTokens[di[k]];
      const li = lettered.indexOf(di[k]);
      const out = li >= 0 && li < dj.length ? outToks[dj[li]] : undefined;
      if (!A[di[k]]) {
        // رمز بلا حروف (ﷺ، شرطة…) يتبع نوع ما قبله
        const prev = res[res.length - 1];
        res.push({ orig, text: orig, kind: prev && prev.kind !== 'quran' ? prev.kind : 'text', group: -1 });
        continue;
      }
      const ok = out && sameCount ? allowedCorrection(orig, out.text, corrections) : null;
      if (ok && out) {
        merge(orig, out);
        accepted.push({ ...ok, corrected: splitPunct(out.text).core, original: splitPunct(orig).core });
      } else {
        keepOrig(orig, out);
        reverted++;
      }
    }
  }
  if (reverted) warnings.push(`أُعيدت ${reverted} كلمة إلى أصلها لأن النموذج حاول تعديلها دون مسوّغ إعرابي.`);
  return res;
}

// ---------- 4) الآيات: الاستبدال بالرسم العثماني ----------
const QBRACKETS = /[﴿﴾{}()\[\]«»"“”]/g;

function toSegments(toks: FinalTok[], warnings: string[]): Segment[] {
  // آيات لم يعلّم عليها النموذج: تتابع ≥ ٥ كلمات مطابق للمصحف حرفياً
  let gid = 10_000;
  let runStart = 0;
  for (let k = 0; k <= toks.length; k++) {
    const isRun = k < toks.length && toks[k].kind !== 'quran' && toks[k].kind !== 'hadith';
    if (isRun) continue;
    if (k > runStart) {
      const run = toks.slice(runStart, k);
      for (const f of findUntaggedVerses(run.map((t) => t.orig)))
        for (let x = f.start; x <= f.end; x++) Object.assign(run[x], { kind: 'quran', group: gid });
      gid++;
    }
    runStart = k + 1;
  }

  const segs: Segment[] = [];
  const push = (k: SegKind, t: string, ref?: string) => {
    if (!t) return;
    const last = segs[segs.length - 1];
    if (last && last.k === k && k !== 'quran' && !ref) last.t += ' ' + t;
    else segs.push(ref ? { k, t, ref } : { k, t });
  };

  for (let k = 0; k < toks.length; ) {
    const t = toks[k];
    if (t.kind !== 'quran') {
      push(t.kind, t.text);
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < toks.length && toks[e + 1].kind === 'quran' && toks[e + 1].group === t.group) e++;
    const group = toks.slice(k, e + 1);
    const match = matchQuran(group.map((g) => g.orig.replace(QBRACKETS, '')));
    if (match) {
      const pre = splitPunct(group[0].orig).pre.replace(QBRACKETS, '');
      const post = splitPunct(group[group.length - 1].orig).post.replace(QBRACKETS, '');
      if (pre) push('text', pre);
      segs.push({ k: 'quran', t: match.text, ref: match.ref });
      if (post) segs.push({ k: 'text', t: post });
    } else {
      warnings.push(`لم يُعثر في المصحف على المقطع: «${group.map((g) => g.orig).join(' ').slice(0, 60)}…» فبقي كما هو.`);
      for (const g of group) push('text', g.text);
    }
    k = e + 1;
  }
  return segs;
}

// ---------- 5) الواجهة الرئيسة ----------
export async function processKhutbah(
  raw: string,
  opts: { title: string; preacher?: string; mode: DiacriticsMode },
  onProgress: (done: number, total: number) => void,
): Promise<KhutbahDoc> {
  const paras = prepare(raw);
  if (!paras.length) throw new Error('النص فارغ.');
  const chunks = chunk(paras);
  const results = new Map<number, LlmOutput['paragraphs'][number]>();
  const corrections: LlmOutput['corrections'] = [];
  let done = 0;
  onProgress(0, chunks.length);

  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      const out = await diacritizeChunk(
        c.map(({ id, text, hint }) => ({ id, text, hint })),
        opts.mode,
      );
      for (const p of out.paragraphs) results.set(p.id, p);
      corrections.push(...out.corrections);
      onProgress(++done, chunks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));

  return { title: opts.title.trim(), preacher: opts.preacher?.trim() || undefined, ...assemble(paras, results, corrections) };
}

/** دمج مخرجات النموذج مع النص الأصلي وبناء الفقرات (منفصلة لتسهيل الاختبار) */
export function assemble(
  paras: Para[],
  results: Map<number, LlmOutput['paragraphs'][number]>,
  corrections: LlmOutput['corrections'],
): Pick<KhutbahDoc, 'blocks' | 'corrections' | 'warnings'> {
  const warnings: string[] = [];
  const accepted: Correction[] = [];
  const blocks: Block[] = [];
  for (const p of paras) {
    const r = results.get(p.id);
    if (!r) {
      warnings.push(`لم تُشكَّل الفقرة رقم ${p.id + 1} فأُدرجت كما هي.`);
      blocks.push({ kind: p.hint ?? 'para', segs: [{ k: 'text', t: p.text }] });
      continue;
    }
    const finals = reconcile(p.tokens, parseMarked(r.marked), corrections, accepted, warnings);
    const segs = toSegments(finals, warnings);
    const prev = blocks[blocks.length - 1];
    // سطر مقطوع من وسط جملة: يُدمج في الفقرة السابقة
    if (r.kind === 'cont' && p.hint !== 'heading' && prev && prev.kind !== 'heading') {
      prev.segs.push(...segs);
      continue;
    }
    blocks.push({ kind: p.hint === 'heading' ? 'heading' : r.kind === 'cont' ? 'para' : r.kind, segs });
  }
  return { blocks, corrections: accepted, warnings };
}
