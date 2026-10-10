// محرك الصفحات: يبني صفحات الخطبة داخل عنصر DOM ويقسّمها بالقياس الفعلي.
// يُستخدم في المعاينة بالمتصفح وفي صفحة /print التي يطبعها Chromium إلى PDF، فتتطابق النتيجتان.
import { toArabicDigits } from './arabic';
import type { Block, KhutbahDoc, RenderOptions, SegKind } from './types';

interface Atom {
  kind: SegKind;
  html: string;
  /** 2 = نهاية جملة/معنى، 1 = نهاية عبارة (فاصلة)، 0 = داخل الجملة */
  brk: 0 | 1 | 2;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** تفريق رموز ﷺ ونحوها في خط خاص */
const sym = (s: string) => esc(s).replace(/([ﷺﷻﷺ-﷽])/g, '<span class="kh-sym">$1</span>');

function atomsOf(block: Block): Atom[] {
  const atoms: Atom[] = [];
  for (const seg of block.segs) {
    // ترقيم مستقل (كالنقطة بعد الآية) يلتصق بما قبله
    if (atoms.length && seg.k !== 'quran' && !/[\p{L}\p{N}]/u.test(seg.t)) {
      const prev = atoms[atoms.length - 1];
      prev.html += `<span class="kh-punct">${esc(seg.t.trim())}</span>`;
      prev.brk = /[.!؟?؛:]/.test(seg.t) ? 2 : /[،,]/.test(seg.t) ? 1 : prev.brk;
      continue;
    }
    const ws = seg.t.split(/\s+/).filter(Boolean);
    ws.forEach((w, i) => {
      let html = seg.k === 'quran' ? esc(w) : sym(w);
      if (seg.k === 'quran') {
        if (i === 0) html = `<span class="kh-qb">﴿</span> ` + html;
        if (i === ws.length - 1) html = html + ` <span class="kh-qb">﴾</span>`;
      }
      const end = w.replace(/[ً-ْٰ]/g, '').slice(-1);
      const brk: Atom['brk'] =
        seg.k === 'quran' && i === ws.length - 1 ? 1 : /[.!؟?؛:»”]/.test(end) ? 2 : /[،,]/.test(end) ? 1 : 0;
      atoms.push({ kind: seg.k, html, brk });
    });
  }
  return atoms;
}

/** HTML لمجموعة كلمات: الكلمات المتتالية من النوع نفسه في span واحد (لاستمرار التسطير) */
function htmlOf(atoms: Atom[]): string {
  let out = '';
  let i = 0;
  while (i < atoms.length) {
    const k = atoms[i].kind;
    const parts: string[] = [];
    while (i < atoms.length && atoms[i].kind === k) parts.push(atoms[i++].html);
    const body = parts.join(' ');
    out += (out ? ' ' : '') + (k === 'text' ? body : `<span class="kh-${k}">${body}</span>`);
  }
  return out;
}

const SCROLL_ICON = `<svg class="kh-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h11a3 3 0 0 1 3 3v1h-3V6a1 1 0 0 0-2 0v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-1h3V6a3 3 0 0 1 1-3z" fill="currentColor" opacity=".18"/><path d="M6 3h11a3 3 0 0 1 3 3v1h-3M17 6v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-1h12v1a3 3 0 0 0 3 3M6 3a3 3 0 0 0-1 2v12M8 8h6M8 11h6M8 14h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

const ORNAMENT = `<svg class="kh-orn-svg" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">${[0, 45, 90, 135]
  .map((a) => `<ellipse cx="12" cy="12" rx="2.6" ry="10.5" transform="rotate(${a} 12 12)"/>`)
  .join('')}</g><circle cx="12" cy="12" r="2.4" fill="#fff"/></svg>`;

function markerFor(kind: Block['kind'], cont: boolean): string {
  if (cont) return '';
  if (kind === 'lead') return '<span class="kh-mark kh-square" aria-hidden="true"></span>';
  if (kind === 'bullet') return '<span class="kh-mark kh-dot" aria-hidden="true">•</span>';
  return '';
}

export function renderKhutbah(root: HTMLElement, doc: KhutbahDoc, opts: RenderOptions): number {
  const mobile = opts.layout === 'mobile';
  root.innerHTML = '';
  root.className = `kh-root layout-${opts.layout} c-${opts.color}`;

  const headText = esc(doc.title) + (doc.preacher ? ` <span class="kh-sep">|</span> ${esc(doc.preacher)}` : '');
  let body!: HTMLElement;
  const pages: HTMLElement[] = [];

  const newPage = () => {
    const page = document.createElement('section');
    page.className = 'kh-page';
    page.innerHTML = `<div class="kh-head"><div class="kh-hbox">${headText}</div><div class="kh-rule"></div><div class="kh-pnum"></div></div><div class="kh-body"></div>`;
    root.appendChild(page);
    pages.push(page);
    body = page.querySelector('.kh-body') as HTMLElement;
  };
  const overflow = () => body.scrollHeight > body.clientHeight + 1;
  const fill = () => {
    const last = body.lastElementChild as HTMLElement | null;
    if (!last) return 0;
    return (last.offsetTop + last.offsetHeight) / body.clientHeight; // .kh-body موضعه relative
  };

  newPage();

  // العنوان الرئيس في الصفحة الأولى
  const title = document.createElement('h1');
  title.className = 'kh-title';
  // الزخرفة مرسومة SVG (رمز ❉ غير موجود في خطوط بعض الخوادم والأجهزة)
  title.innerHTML = `<span class="kh-orn">${ORNAMENT}|</span> ${esc(doc.title)} <span class="kh-orn">|${ORNAMENT}</span>`;
  body.appendChild(title);

  for (const block of doc.blocks) {
    if (block.kind === 'heading') {
      const make = () => {
        const el = document.createElement('p');
        el.className = 'kh-heading';
        el.innerHTML = `${SCROLL_ICON}<span class="kh-hb">[</span> <span class="kh-htext">${htmlOf(atomsOf(block))}</span> <span class="kh-hb">]</span>`;
        return el;
      };
      let el = make();
      body.appendChild(el);
      // لا يُترك العنوان وحيداً أسفل الصفحة
      if (overflow() || fill() > 0.88) {
        el.remove();
        newPage();
        el = make();
        body.appendChild(el);
      }
      continue;
    }

    const atoms = atomsOf(block);
    const mkEl = (cont: boolean) => {
      const el = document.createElement('p');
      el.className = `kh-b kh-blk-${block.kind}${cont ? ' kh-cont' : ''}`;
      body.appendChild(el);
      return el;
    };
    const setHtml = (el: HTMLElement, cont: boolean, from: number, to: number) => {
      el.innerHTML = markerFor(block.kind, cont) + htmlOf(atoms.slice(from, to));
    };

    // المحاولة الأولى: الفقرة كاملة
    let cont = false;
    let el = mkEl(cont);
    setHtml(el, cont, 0, atoms.length);
    if (!overflow()) continue;

    // في الجوال: إن كانت الصفحة ممتلئة بما يكفي نبدأ الفقرة/النقطة في صفحة جديدة
    if (mobile && fill() > 0.5) {
      el.remove();
      newPage();
      el = mkEl(cont);
      setHtml(el, cont, 0, atoms.length);
      if (!overflow()) continue;
    }

    // التقسيم: الجوال بالجمل ثم العبارات ثم الكلمات، والطباعة بالكلمات
    const levels: Array<0 | 1 | 2> = mobile ? [2, 1, 0] : [0];
    let start = 0; // أول كلمة في عنصر الصفحة الحالية
    let placed = 0; // عدد الكلمات الموضوعة حتى الآن
    const nextEnd = (level: 0 | 1 | 2) => {
      for (let k = placed; k < atoms.length; k++) if (atoms[k].brk >= level) return k + 1;
      return atoms.length;
    };
    setHtml(el, cont, start, placed);
    while (placed < atoms.length) {
      let ok = false;
      for (const lv of levels) {
        setHtml(el, cont, start, placed);
        // الجوال: لا نقطع الجملة إلا إذا كانت الصفحة قليلة الامتلاء
        if (mobile && lv < 2 && fill() > (lv === 1 ? 0.6 : 0.35)) break;
        const end = nextEnd(lv);
        setHtml(el, cont, start, end);
        if (!overflow()) {
          placed = end;
          ok = true;
          break;
        }
      }
      setHtml(el, cont, start, placed);
      if (ok) continue;
      if (placed === start) {
        // كلمة أطول من صفحة فارغة: تُوضع على أي حال لتجنّب الحلقة اللانهائية
        if (body.childElementCount === 1) {
          placed = nextEnd(0);
          setHtml(el, cont, start, placed);
          continue;
        }
        el.remove();
      } else if (start === 0 && el.offsetHeight < 1.5 * parseFloat(getComputedStyle(el).lineHeight)) {
        // سطر يتيم في أسفل الصفحة: تُنقل الفقرة كلها إلى الصفحة التالية
        el.remove();
        placed = 0;
      }
      newPage();
      cont = placed > 0;
      start = placed;
      el = mkEl(cont);
      setHtml(el, cont, start, placed);
    }
  }

  pages.forEach((p, i) => {
    (p.querySelector('.kh-pnum') as HTMLElement).textContent = toArabicDigits(i + 1);
  });
  return pages.length;
}

/** تحميل الخطوط قبل القياس */
export async function ensureFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(
    ['400 20px KhBody', '700 20px KhBody', '400 20px KhQuran', '700 20px KhTitle', '400 20px KhSym'].map((f) =>
      document.fonts.load(f, 'بسم الله ﷺ').catch(() => undefined),
    ),
  );
  await document.fonts.ready;
}
