// نموذج المستند المنسَّق: ينتجه محرك المعالجة ويستهلكه العارض ومولدا PDF و Word.

/** نوع المقطع داخل الفقرة */
export type SegKind =
  | 'text' // متن عادي
  | 'emph' // كلمات مفتاحية مميزة (الحمد لله، أشهد، اللهم…)
  | 'lead' // افتتاحية النداء المسطَّرة (أما بعد، أيها المسلمون، عباد الله)
  | 'quran' // آية بالرسم العثماني
  | 'hadith'; // نص حديث نبوي (تلوين فقط دون أي معالجة)

export interface Segment {
  k: SegKind;
  t: string;
  /** للآيات: «سورة:آية» أو «سورة:من-إلى» */
  ref?: string;
}

/** نوع الفقرة */
export type BlockKind =
  | 'heading' // [ الخطبة الأولى ] / [ الخطبة الثانية ]
  | 'lead' // فقرة رئيسة تبدأ بمربع ■
  | 'bullet' // نقطة فرعية •
  | 'para' // فقرة عادية
  | 'closing'; // الخواتيم (أقول ما تسمعون…، الدعاء الختامي)

export interface Block {
  kind: BlockKind;
  segs: Segment[];
}

export interface Correction {
  original: string;
  corrected: string;
  reason: string;
  /** i3rab = تصحيح إعرابي، imla = تصحيح إملائي (عند تفعيل الخيار) */
  type?: 'i3rab' | 'imla';
}

export interface KhutbahDoc {
  title: string;
  preacher?: string;
  blocks: Block[];
  corrections: Correction[];
  warnings: string[];
}

export type DiacriticsMode = 'full' | 'functional';
export type LayoutMode = 'a4' | 'mobile';
export type ColorMode = 'maroon' | 'navy' | 'bw';

export interface RenderOptions {
  layout: LayoutMode;
  color: ColorMode;
}

/** أحداث البث من واجهة المعالجة */
export type ProcessEvent =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; doc: KhutbahDoc }
  | { type: 'error'; message: string };
