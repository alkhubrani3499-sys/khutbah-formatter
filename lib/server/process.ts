import { letters, normalizeForMatch, splitPunct, stripDiacritics, words } from '@/lib/arabic';
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

const WEAK = 'ويى';
const PRONOUN = /^(ه|ها|هم|هما|هن|ك|كم|كما|كن|نا|ني|ي)$/;

/**
 * هل الفرق بين الكلمتين من جنس التغيير الإعرابي؟ (يُستعمل لرفض التصحيحات الإملائية المتنكّرة)
 * المقبول: ألف تنوين النصب، حذف حرف علة للجزم/البناء، تبادل و/ا/ي (جمع المذكر والمثنى والأسماء الخمسة)،
 * حذف نون الأفعال الخمسة، همزة إنّ/أنّ.
 */
function looksLikeIrab(lo: string, lc: string): boolean {
  if (lc === lo + 'ا' && !lo.endsWith('و')) return true; // قليل ← قليلا (لا: كانو ← كانوا)
  // حذف حرف علة للجزم/البناء: آخر الكلمة، أو قبل ضمير متصل فقط (لا واو العطف ولا حرفاً في أول الكلمة أو وسطها)
  for (let i = 1; i < lo.length; i++)
    if (
      WEAK.includes(lo[i]) &&
      lo.slice(0, i) + lo.slice(i + 1) === lc &&
      (i === lo.length - 1 || PRONOUN.test(lo.slice(i + 1)))
    )
      return true; // يدعو ← يدع، يبديه ← يبده
  if (lo.endsWith('ون') && lc === lo.slice(0, -2) + 'وا') return true; // يفعلون ← يفعلوا
  if ((lo.endsWith('ين') || lo.endsWith('ان')) && lc === lo.slice(0, -1)) return true; // تفعلين ← تفعلي
  if (lo.length === lc.length) {
    const pos = [...lo].findIndex((ch, i) => ch !== lc[i]);
    const single = pos >= 0 && lo.slice(pos + 1) === lc.slice(pos + 1);
    if (single) {
      const a = lo[pos];
      const b = lc[pos];
      const rest = lo.slice(pos + 1);
      // تبادل و/ا/ي في علامة الإعراب فقط: آخر الكلمة (أبو ← أبي)، أو قبل نون الجمع/المثنى (المسلمون ← المسلمين)،
      // أو قبل ضمير متصل (أبوه ← أبيه) — لا في وسط الكلمة (قال ← قيل مرفوض)
      if ('واي'.includes(a) && 'واي'.includes(b) && (rest === '' || rest === 'ن' || PRONOUN.test(rest))) return true;
      // همزة إنّ/أنّ في أول الكلمة أو بعد واو/فاء العطف
      if ('أإ'.includes(a) && 'أإ'.includes(b) && (pos === 0 || (pos === 1 && 'وف'.includes(lo[0])))) return true;
    }
  }
  return false;
}

/** وضع حركات كلمة النموذج على حروف الأصل (حين يغيّر النموذج رسم الهمزة/الألف فقط) */
function transplant(origCore: string, outCore: string): string | null {
  const base = [...stripDiacritics(origCore)];
  const clusters = outCore.match(/[^ً-ٰٟ][ً-ٰٟ]*/g) ?? [];
  if (clusters.length !== base.length) return null;
  return base.map((ch, i) => ch + clusters[i].slice(1)).join('');
}

type Decision =
  | { action: 'accept'; correction: Correction }
  | { action: 'diacritize'; text: string } // حروف الأصل بحركات النموذج
  | { action: 'revert' };

/** الحكم على كلمة غيّر النموذج حروفها */
function judge(orig: string, out: string, list: LlmOutput['corrections'], spelling: boolean): Decision {
  const lo = letters(orig);
  const lc = letters(out);
  const oc = splitPunct(orig).core;
  const cc = splitPunct(out).core;
  if (!lo || !lc) return { action: 'revert' };
  const hamzaOnly = normalizeForMatch(lo) === normalizeForMatch(lc);
  const listed = list.find((c) => words(c.original).map(letters).includes(lo) && words(c.corrected).map(letters).includes(lc));
  const close = levenshtein(lo, lc) <= 2;

  // التغيير الإعرابي يُقبل ولو لم يسجّله النموذج (بعض النماذج تصحّح دون أن تذكر)، لأن أنماطه محصورة في أواخر الكلم
  if (close && looksLikeIrab(lo, lc))
    return {
      action: 'accept',
      correction: { original: oc, corrected: cc, reason: listed?.reason || 'تصحيح إعرابي', type: 'i3rab' },
    };
  if (spelling && (hamzaOnly || (close && listed)))
    return {
      action: 'accept',
      correction: { original: oc, corrected: cc, reason: listed?.reason || 'تصحيح إملائي (رسم الهمزة أو الألف)', type: 'imla' },
    };
  // التصحيح الإملائي غير مفعّل: نُبقي حروف الأصل ونأخذ حركات النموذج إن أمكن
  // (فقط حين يكون الفرق في رسم الهمزة/الألف؛ أما كلمة مختلفة فحركاتها لا تصلح للأصل)
  if (hamzaOnly) {
    const t = transplant(oc, cc);
    if (t) return { action: 'diacritize', text: t };
  }
  return { action: 'revert' };
}

function reconcile(
  inTokens: string[],
  outToks: OutTok[],
  corrections: LlmOutput['corrections'],
  accepted: Correction[],
  stats: { reverted: number },
  spelling: boolean,
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
      const d: Decision = out && sameCount ? judge(orig, out.text, corrections, spelling) : { action: 'revert' };
      if (d.action === 'accept' && out) {
        merge(orig, out);
        accepted.push(d.correction);
      } else if (d.action === 'diacritize' && out) {
        const o = splitPunct(orig);
        res.push({ orig, text: o.pre + d.text + o.post, kind: out.kind, group: out.group });
      } else {
        keepOrig(orig, out);
        reverted++;
      }
    }
  }
  stats.reverted += reverted;
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
  opts: { title: string; preacher?: string; mode: DiacriticsMode; spelling?: boolean },
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
        !!opts.spelling,
      );
      for (const p of out.paragraphs) results.set(p.id, p);
      corrections.push(...out.corrections);
      onProgress(++done, chunks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));

  return { title: opts.title.trim(), preacher: opts.preacher?.trim() || undefined, ...assemble(paras, results, corrections, !!opts.spelling) };
}

/** دمج مخرجات النموذج مع النص الأصلي وبناء الفقرات (منفصلة لتسهيل الاختبار) */
export function assemble(
  paras: Para[],
  results: Map<number, LlmOutput['paragraphs'][number]>,
  corrections: LlmOutput['corrections'],
  spelling = false,
): Pick<KhutbahDoc, 'blocks' | 'corrections' | 'warnings'> {
  const warnings: string[] = [];
  const accepted: Correction[] = [];
  const blocks: Block[] = [];
  const stats = { reverted: 0 };
  for (const p of paras) {
    const r = results.get(p.id);
    if (!r) {
      warnings.push(`لم تُشكَّل الفقرة رقم ${p.id + 1} فأُدرجت كما هي.`);
      blocks.push({ kind: p.hint ?? 'para', segs: [{ k: 'text', t: p.text }] });
      continue;
    }
    const finals = reconcile(p.tokens, parseMarked(r.marked), corrections, accepted, stats, spelling);
    const segs = toSegments(finals, warnings);
    const prev = blocks[blocks.length - 1];
    // سطر مقطوع من وسط جملة: يُدمج في الفقرة السابقة
    if (r.kind === 'cont' && p.hint !== 'heading' && prev && prev.kind !== 'heading') {
      prev.segs.push(...segs);
      continue;
    }
    blocks.push({ kind: p.hint === 'heading' ? 'heading' : r.kind === 'cont' ? 'para' : r.kind, segs });
  }
  if (stats.reverted)
    warnings.unshift(`أُبقيت ${stats.reverted} كلمة على أصلها دون تشكيل لأن النموذج حاول تغيير حروفها.`);
  return { blocks, corrections: accepted, warnings };
}
