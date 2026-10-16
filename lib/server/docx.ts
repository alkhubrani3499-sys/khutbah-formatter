import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type IRunOptions,
} from 'docx';
import type { Block, KhutbahDoc, RenderOptions, SegKind } from '@/lib/types';

// Word لا يقبل خط Noto Naskh المضمَّن، فنستخدم Amiri (يُضمَّن ويعمل بلا تثبيت)
const F_BODY = 'Amiri';
const F_QURAN = 'Amiri Quran';
const F_TITLE = 'Amiri';
// رموز الترضّي الحديثة (؀-؏ مثل «رضي الله عنه») لا يحتويها Amiri، فتُعرض بخط Noto Naskh المضمَّن
const F_HONOR = 'Noto Naskh Arabic';
const HONOR_SPLIT = /([ﷺﷻ]|[﵀-﵏]+)/;

const PALETTE = {
  maroon: { accent: 'C00000', lead: '984806', quran: '2D5A27', hadith: '5C2E0B' },
  bw: { accent: '000000', lead: '000000', quran: '000000', hadith: '000000' },
} as const;

const MM = 56.6929; // twips لكل مليمتر
const LAYOUT = {
  // line: ارتفاع السطر مضروباً في حجم الخط
  a4: { w: 210, h: 297, mx: 17, my: 12, size: 16.5, title: 24, head: 10, line: 1.95 },
  mobile: { w: 100, h: 178, mx: 6, my: 5, size: 18, title: 24, head: 8, line: 1.85 },
} as const;

let fontCache: { name: string; data: Buffer }[] | null = null;
const fonts = () =>
  (fontCache ??= [
    { name: F_BODY, file: 'Amiri-Regular.ttf' },
    { name: F_BODY, file: 'Amiri-Bold.ttf' },
    { name: F_QURAN, file: 'AmiriQuran-Regular.ttf' },
    { name: F_HONOR, file: 'NotoNaskhArabic-Regular.ttf' },
  ].map(({ name, file }) => ({ name, data: fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', file)) })));

const font = (name: string) => ({ ascii: name, hAnsi: name, cs: name, eastAsia: name });

export async function buildDocx(doc: KhutbahDoc, opts: RenderOptions): Promise<Buffer> {
  const L = LAYOUT[opts.layout];
  const P = PALETTE[opts.color];
  const bw = opts.color === 'bw';
  const hp = (pt: number) => Math.round(pt * 2); // نصف نقطة

  const run = (text: string, o: Partial<IRunOptions> & { f?: string; pt?: number } = {}) => {
    const { f = F_BODY, pt = L.size, ...rest } = o;
    return new TextRun({
      text,
      rightToLeft: true,
      font: font(f),
      size: hp(pt),
      sizeComplexScript: hp(pt),
      language: { bidirectional: 'ar-SA' },
      ...rest,
      ...(rest.bold ? { boldComplexScript: true } : {}),
    });
  };

  /** نص مع فصل الرموز: ﷺ بخط Amiri، ورموز الترضّي الحديثة بخط Noto Naskh */
  const textRuns = (text: string, style: Partial<IRunOptions> & { f?: string; pt?: number }) =>
    text
      .split(HONOR_SPLIT)
      .filter(Boolean)
      .map((p) =>
        /^[ﷺﷻ]$/.test(p)
          ? run(p, { ...style, f: F_TITLE, bold: false })
          : /^[﵀-﵏]+$/.test(p)
            ? run(p, { ...style, f: F_HONOR, bold: false })
            : run(p, style),
      );

  const segStyle = (k: SegKind): Partial<IRunOptions> & { f?: string } => {
    switch (k) {
      case 'emph':
        return { color: P.accent, bold: bw };
      case 'lead':
        return { color: P.lead, bold: bw, underline: { type: 'single', color: P.lead } };
      case 'quran':
        return { color: P.quran, f: F_QURAN };
      case 'hadith':
        return { color: P.hadith };
      default:
        return {};
    }
  };

  // ارتفاع سطر ثابت (كما في PDF) حتى لا تتفاوت الأسطر التي فيها آيات
  const spacing = { line: Math.round(L.size * L.line * 20), lineRule: 'exact' as const, after: 40 };

  const blockPara = (b: Block): Paragraph => {
    const children: TextRun[] = [];
    if (b.kind === 'lead') children.push(run('■ ', { color: '000000' }));
    if (b.kind === 'bullet') children.push(run('• ', { color: P.accent, bold: true }));
    const base: Partial<IRunOptions> = b.kind === 'closing' ? { color: P.lead, bold: bw } : {};
    b.segs.forEach((s, i) => {
      const sp = i && /[\p{L}\p{N}]/u.test(s.t) ? ' ' : '';
      if (s.k === 'quran') {
        children.push(run(`${sp}﴿`, { color: P.accent, f: F_QURAN }));
        children.push(run(` ${s.t} `, segStyle('quran')));
        children.push(run('﴾', { color: P.accent, f: F_QURAN }));
      } else {
        children.push(...textRuns(sp + s.t, { ...base, ...segStyle(s.k) }));
      }
    });
    return new Paragraph({ bidirectional: true, alignment: AlignmentType.BOTH, spacing, children });
  };

  const headingPara = (b: Block) =>
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      spacing: { ...spacing, before: hp(2) * 10 },
      keepNext: true,
      children: [
        run('[ ', { color: P.lead, bold: true }),
        ...textRuns(b.segs.map((s) => s.t).join(' '), { color: P.lead, bold: true, underline: { type: 'single', color: P.lead } }),
        run(' ]', { color: P.lead, bold: true }),
      ],
    });

  const titlePara = new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [
      run('❉| ', { pt: L.title * 0.75, f: F_TITLE }),
      ...textRuns(doc.title, { color: P.accent, bold: true, f: F_TITLE, pt: L.title }),
      run(' |❉', { pt: L.title * 0.75, f: F_TITLE }),
    ],
  });

  // الترويسة: جدول من خليتين (العنوان واسم الخطيب | رقم الصفحة) بخط مزدوج أسفلها
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const headerTable = new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: none,
      left: none,
      right: none,
      insideHorizontal: none,
      insideVertical: none,
      bottom: { style: BorderStyle.DOUBLE, size: 6, color: bw ? '000000' : P.accent },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 86, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.START,
                children: [
                  ...textRuns(doc.title, { bold: true, pt: L.head }),
                  ...(doc.preacher ? [run('  |  ', { color: P.accent, pt: L.head }), ...textRuns(doc.preacher, { bold: true, pt: L.head })] : []),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 14, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.END,
                children: [new TextRun({ children: [PageNumber.CURRENT], bold: true, size: hp(L.head), font: font(F_BODY) })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const body: Paragraph[] = [titlePara];
  for (const b of doc.blocks) body.push(b.kind === 'heading' ? headingPara(b) : blockPara(b));

  const document = new Document({
    creator: doc.preacher || 'منسّق الخطب',
    title: doc.title,
    fonts: fonts(),
    styles: {
      default: {
        document: { run: { font: font(F_BODY), size: hp(L.size), sizeComplexScript: hp(L.size), rightToLeft: true } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: Math.round(L.w * MM), height: Math.round(L.h * MM) },
            margin: {
              top: Math.round((L.my + 10) * MM),
              bottom: Math.round(L.my * MM),
              left: Math.round(L.mx * MM),
              right: Math.round(L.mx * MM),
              header: Math.round(L.my * MM),
              footer: 0,
            },
          },
        },
        headers: { default: new Header({ children: [headerTable] }) },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(document);
}
