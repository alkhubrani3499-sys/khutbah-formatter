import Anthropic from '@anthropic-ai/sdk';
import { ApiError, GoogleGenAI, type ContentListUnion } from '@google/genai';
import { z } from 'zod';
import type { BlockKind, DiacriticsMode } from '@/lib/types';

// الافتراضي Claude Haiku (الأرخص: نحو سنت للخطبة). للدقة الأعلى: CLAUDE_MODEL=claude-opus-5-5
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
// النموذج الاحتياطي عند الاعتذار متاح لـ Opus و Sonnet فقط، لا لـ Haiku
const FALLBACK = /^claude-(opus|sonnet)-/.test(MODEL);
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORT: Effort = (['low', 'medium', 'high', 'xhigh', 'max'] as const).includes(
  process.env.CLAUDE_EFFORT as Effort,
)
  ? (process.env.CLAUDE_EFFORT as Effort)
  : 'medium'; // متوسط: نحو نصف تكلفة high مع دقة قريبة

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

const KINDS = ['heading', 'lead', 'bullet', 'para', 'closing', 'cont'] as const;

const OutputSchema = z.object({
  paragraphs: z.array(
    z.object({
      id: z.number().int(),
      kind: z.enum(KINDS),
      marked: z.string(),
    }),
  ),
  corrections: z.array(
    z.object({
      original: z.string(),
      corrected: z.string(),
      reason: z.string(),
    }),
  ),
});
export type LlmOutput = z.infer<typeof OutputSchema>;

// مخطط JSON مكافئ للإخراج المنظَّم
const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['paragraphs', 'corrections'],
  properties: {
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'marked'],
        properties: {
          id: { type: 'integer' },
          kind: { type: 'string', enum: [...KINDS] },
          marked: { type: 'string' },
        },
      },
    },
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['original', 'corrected', 'reason'],
        properties: {
          original: { type: 'string' },
          corrected: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

const SYSTEM = `أنت مدقق لغوي ومُشكِّل محترف لخطب الجمعة باللغة العربية الفصحى. تستقبل فقرات مرقَّمة من خطبة، وتعيد كل فقرة مشكولةً ومعلَّمةً بوسوم التنسيق.

## القاعدة العليا: سلامة النص
- ممنوع منعاً باتاً تغيير أي كلمة أو حذفها أو إضافة كلمة أو إعادة ترتيب الكلمات أو إعادة الصياغة أو تصحيح الأسلوب. (الإملاء يُتبع فيه ما يرد في رسالة المستخدم.)
- أعد كل كلمة كما هي بحروفها، ولا تضف إلا الحركات (الفتحة، الضمة، الكسرة، السكون، الشدة، التنوين).
- الاستثناء الوحيد: الخطأ الإعرابي النحوي الصريح الذي يقتضي تغيير حرف (مثل: «المسلمون» في موضع جر ← «المسلمين»، «أبو» في موضع جر ← «أبي»، نصب اسم إن المرفوع خطأً بالألف). صحّحه في النص وسجّله في قائمة corrections بالكلمة الأصلية والمصحَّحة وسبب موجز. لا تعدّ اختلاف المذاهب النحوية أو الأوجه الجائزة أخطاءً.
- لا تغيّر علامات الترقيم، ولا تحوّل «صلى الله عليه وسلم» إلى رمز ولا العكس.
- لا تعالج الأحاديث بأي معالجة خاصة سوى الضبط اللغوي كبقية المتن.

## الوسوم داخل الحقل marked
- <q>…</q> حول نص الآية القرآنية المقتبسة فقط (دون الأقواس المحيطة بها في المدخل مثل ﴿ ﴾ أو { } أو ( ) فتلك تبقى خارج الوسم). اضبط الآية ضبطاً كاملاً كما في المصحف، ولا تغيّر كلماتها (سيستبدلها النظام بالرسم العثماني من قاعدة بيانات المصحف).
- <h>…</h> حول نص الحديث النبوي المقتبس (داخل علامات التنصيص)، لتلوينه فقط.
- <l>…</l> حول افتتاحية النداء في أول الفقرة الرئيسة، مثل: «أَمَّا بَعْدُ: فَيَا أَيُّهَا النَّاسُ:»، «أَيُّهَا الْمُسْلِمُونَ:»، «عِبَادَ اللهِ:»، «أَمَّا بَعْدُ؛ عِبَادَ اللهِ:».
- <e>…</e> حول الكلمات المفتاحية التي تُميَّز بلون مختلف، باعتدال ودون إفراط، على نسق الخطب المطبوعة:
  «الْحَمْدُ للهِ» في الافتتاح، «وَأَشْهَدُ»، «أَحْمَدُهُ»، «اللَّهُمَّ» حيث وردت، «صَلَّى اللهُ وَسَلَّمَ»، العبارة المتكررة في أول النقاط (مثل «أَصْحَابُ رَسُولِ اللهِ»)، أفعال الأمر الوعظية المحورية («أَلَا فَاتَّقُوا اللهَ»، «فَاذْكُرُوا»، «وَاشْكُرُوهُ»، «وَلَذِكْرُ»)، ومداخل الاستدلال («قَالَ ﷺ»، «لِقَوْلِهِ ﷺ»، «قَالَ تَعَالَى»).
- لا تتداخل الوسوم، ولا تضع وسماً داخل آخر.

## نوع الفقرة kind
- heading: عنوان «الخطبة الأولى» أو «الخطبة الثانية».
- lead: فقرة رئيسة تبدأ بنداء أو انتقال (أما بعد، أيها المسلمون، عباد الله…).
- bullet: نقطة فرعية ضمن تعداد (خاصة إذا جاءت في المدخل بعلامة تعداد، أو كانت سلسلة فقرات تبدأ بالعبارة نفسها).
- closing: الخواتيم مثل «أقول ما تسمعون وأستغفر الله لي ولكم…» وفقرة الترضّي الختامية.
- para: ما سوى ذلك (ومنه افتتاحية الحمد والدعاء).
- cont: السطر تكملة للجملة في السطر السابق (قطع الكاتب السطر في وسط الجملة)، فيُدمج معه في فقرة واحدة. لا تستعمله لبداية معنى جديد.
- قد يرد تلميح للنوع في المدخل [hint=…]؛ اعتمده ما لم يكن خطأً بيّناً.

## الإخراج
- أعد كل الفقرات بالأرقام نفسها (id) وبالترتيب نفسه، فقرةً مقابل فقرة، دون دمج أو تقسيم.
- لا تكتب علامات التعداد (• ■ -) ولا أقواس عنوان الخطبة في marked؛ فالتصميم يضيفها.`;

const MODE_TEXT: Record<DiacriticsMode, string> = {
  full: 'مستوى التشكيل المطلوب: تشكيل كامل بنسبة 100% — اضبط كل حرف بحركته (عدا حروف المد، وألف الوصل، واللام الشمسية التي تُترك وتوضع الشدة على ما بعدها).',
  functional:
    'مستوى التشكيل المطلوب: تشكيل وظيفي — اضبط أواخر الكلمات المعربة كلها (علامات الإعراب والبناء)، وأضف الحركات الداخلية فقط حيث يقع اللبس (المبني للمجهول، الكلمات المتشابهة رسماً كـ عِلْم/عَلَم، الشدة المؤثرة في المعنى). اترك ما سوى ذلك دون تشكيل. الآيات تُضبط كاملة دائماً.',
};

const SPELLING_TEXT = {
  off: 'الإملاء: لا تصحّح الأخطاء الإملائية مطلقاً، واكتب كل كلمة بحروفها كما وردت ولو كانت خاطئة إملائياً (مثل: الى، ان، اما، كانو، الأن)، وضع عليها الحركات فقط.',
  on: 'الإملاء: مسموح أيضاً تصحيح الأخطاء الإملائية الصريحة في الكلمة نفسها (رسم الهمزات، الألف المقصورة والياء، التاء المربوطة والهاء، ألف واو الجماعة، حرف ساقط سهواً)، وسجّل كل تصحيح في corrections وابدأ سببه بكلمة «إملائي:». لا تفصل الكلمات الملتصقة ولا تدمج المنفصلة، ولا تستبدل كلمة بأخرى.',
};

export interface LlmParagraph {
  id: number;
  text: string;
  hint?: BlockKind;
}

/**
 * مزوّد النموذج: claude أو gemini. يُحدَّد بـ LLM_PROVIDER، وإلا فـ gemini إن وُجد مفتاحه وحده.
 */
export const PROVIDER: 'claude' | 'gemini' =
  process.env.LLM_PROVIDER === 'gemini' || process.env.LLM_PROVIDER === 'claude'
    ? process.env.LLM_PROVIDER
    : process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY
      ? 'gemini'
      : 'claude';

function userPrompt(paragraphs: LlmParagraph[], mode: DiacriticsMode, spelling: boolean) {
  const input = paragraphs.map((p) => `[${p.id}]${p.hint ? ` [hint=${p.hint}]` : ''} ${p.text}`).join('\n\n');
  return `${MODE_TEXT[mode]}\n${SPELLING_TEXT[spelling ? 'on' : 'off']}\n\nفقرات الخطبة:\n\n${input}`;
}

function parseOutput(text: string): LlmOutput {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('استجابة غير صالحة من نموذج التشكيل.');
  }
  const parsed = OutputSchema.safeParse(json);
  if (!parsed.success) throw new Error('استجابة غير صالحة من نموذج التشكيل.');
  return parsed.data;
}

export function diacritizeChunk(paragraphs: LlmParagraph[], mode: DiacriticsMode, spelling = false): Promise<LlmOutput> {
  const prompt = userPrompt(paragraphs, mode, spelling);
  return PROVIDER === 'gemini' ? geminiChunk(prompt) : claudeChunk(prompt);
}

// ---------------- Claude ----------------
async function claudeChunk(prompt: string): Promise<LlmOutput> {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    ...(FALLBACK ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: JSON_SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  });
  const msg = await stream.finalMessage();

  if (msg.stop_reason === 'refusal') throw new Error('تعذّرت معالجة هذا الجزء من النص.');
  if (msg.stop_reason === 'max_tokens') throw new Error('النص أطول من المسموح في جزء واحد.');
  return parseOutput(msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''));
}

// ---------------- Gemini (Google AI Studio — فيه خطة مجانية) ----------------
// قائمة نماذج بالترتيب: الحد المجاني لكل نموذج مستقل، فإذا امتلأت حصة نموذج انتقلنا إلى التالي.
const GEMINI_MODELS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-3.8-flash,gemini-3.5-flash,gemini-flash-latest,gemini-flash-lite-latest')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
let gemini: GoogleGenAI | null = null;
/** نماذج امتلأت حصتها اليوم: لا نعيد تجربتها حتى ينقضي وقت التبريد */
const exhaustedUntil = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GeminiRequest = { contents: ContentListUnion; system: string; schema: object; thinking?: number };

async function geminiChunk(prompt: string): Promise<LlmOutput> {
  const text = await geminiGenerate({
    contents: prompt,
    system: SYSTEM,
    schema: JSON_SCHEMA,
    thinking: Number(process.env.GEMINI_THINKING ?? 2048),
  });
  return parseOutput(text);
}

/** استدعاء Gemini مع التنقّل بين النماذج عند امتلاء الحصة أو الانشغال */
async function geminiGenerate(req: GeminiRequest): Promise<string> {
  let lastErr: unknown;
  const now = Date.now();
  const models = GEMINI_MODELS.filter((m) => (exhaustedUntil.get(m) ?? 0) < now);
  for (const model of models.length ? models : GEMINI_MODELS) {
    // محاولتان لكل نموذج عند الانشغال المؤقت (503/500)
    let current = req;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await geminiOnce(current, model);
      } catch (err) {
        lastErr = err;
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 400 && !/api key/i.test(String((err as Error).message))) {
          // إعداد لا يدعمه هذا النموذج (غالباً ميزانية التفكير): نعيد دونه مرة، ثم ننتقل للتالي
          if (current.thinking !== undefined) {
            current = { ...current, thinking: undefined };
            continue;
          }
          break;
        }
        if (status === 404) break; // النموذج غير متاح لهذا المفتاح
        if (status === 429) {
          exhaustedUntil.set(model, Date.now() + 10 * 60_000); // نتجنبه عشر دقائق
          break; // إلى النموذج التالي
        }
        const network = status === 0 && !(err instanceof Error && /أطول|استجابة|تعذّرت/.test(err.message));
        if (status === 503 || status === 500 || network) {
          // انشغال مؤقت أو انقطاع اتصال: نعيد المحاولة مرة على النموذج نفسه ثم ننتقل للتالي
          await sleep(2_000 + Math.random() * 2_000);
          continue;
        }
        throw err; // خطأ في الطلب نفسه (مفتاح، صلاحية، نص)
      }
    }
  }
  throw lastErr;
}

async function geminiOnce(req: GeminiRequest, model: string): Promise<string> {
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  // التدفّق يُبقي الاتصال نشطاً فلا تقطعه الشبكات التي تُغلق الاتصالات الخاملة الطويلة
  const stream = await gemini.models.generateContentStream({
    model,
    contents: req.contents,
    config: {
      systemInstruction: req.system,
      responseMimeType: 'application/json',
      responseJsonSchema: req.schema,
      maxOutputTokens: 65536,
      // ميزانية التفكير: أقل = أسرع وأرخص. (-1 = تلقائي)
      ...(req.thinking !== undefined ? { thinkingConfig: { thinkingBudget: req.thinking } } : {}),
    },
  });
  let text = '';
  let finish: string | undefined;
  for await (const chunk of stream) {
    text += chunk.text ?? '';
    finish = chunk.candidates?.[0]?.finishReason ?? finish;
  }
  if (finish === 'MAX_TOKENS') throw new Error('النص أطول من المسموح في جزء واحد.');
  if (!text) throw new Error('تعذّرت معالجة هذا الجزء من النص.');
  return text;
}

// ================= استخراج نص خطبة من صور صفحات PDF =================
const ExtractSchema = z.object({ title: z.string(), text: z.string() });
const EXTRACT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'text'],
  properties: { title: { type: 'string' }, text: { type: 'string' } },
};

const EXTRACT_SYSTEM = `أنت ناسخ دقيق لنصوص خطب الجمعة العربية من صور صفحات مطبوعة.
انسخ نص الخطبة حرفياً كما هو في الصور، بلا أي تعديل أو تصحيح أو إعادة صياغة أو اختصار، واحذف الحركات (انسخ الحروف فقط).
- تجاهل ما ليس من الخطبة: الترويسة المكررة أعلى الصفحات (عنوان، تاريخ)، أرقام الصفحات، بيانات التواصل والروابط وأسماء القنوات، والزخارف.
- اجعل كل فقرة أو نقطة في سطر مستقل، وابدأ النقاط الفرعية بـ «• » والفقرات الرئيسة المعلَّمة بمربع بـ «■ ».
- اكتب «الخطبة الأولى» و«الخطبة الثانية» في سطر مستقل إن وردتا.
- ضع الآيات القرآنية بين قوسين { } كما هي، وأبقِ علامات تنصيص الأحاديث.
- لا تكرر الكلمة المقطوعة بين نهاية صفحة وبداية التالية؛ صِل النص.
- الرموز المزخرفة الصغيرة (الأختام): انتبه لمعناها بحسب ما بعد الاسم الذي تليه:
  • بعد ذكر النبي ﷺ (رسول الله، النبي، الصادق المأمون…): اكتب الرمز «ﷺ».
  • بعد الصحابة أو صحابي أو صحابية أو أمهات المؤمنين: اكتب الكلمات صريحة «رضي الله عنهم» أو «رضي الله عنه» أو «رضي الله عنها» — ولا تكتب ﷺ أبداً.
  • بعد العلماء: «رحمه الله»، وبعد الأنبياء الآخرين والملائكة: «عليه السلام».
  • لا تحوّل كلمات مكتوبة إلى رمز، ولا رمزاً إلى معنى غير معناه.
- انسخ بالحروف العربية القياسية (ي ك) لا الفارسية (ی ک).
- title: عنوان الخطبة الرئيس إن ظهر في أول صفحة، وإلا فاتركه فارغاً.`;

/** يستخرج نص الخطبة من صور صفحات (JPEG بترميز base64) */
export async function extractFromImages(images: string[], isFirst: boolean): Promise<{ title: string; text: string }> {
  const instruction = isFirst
    ? 'هذه الصفحات الأولى من الخطبة. انسخ نصها، واستخرج العنوان.'
    : 'هذه صفحات تالية من الخطبة نفسها. انسخ نصها، واترك title فارغاً.';
  let raw: string;
  if (PROVIDER === 'gemini') {
    raw = await geminiGenerate({
      contents: [
        {
          role: 'user',
          parts: [...images.map((data) => ({ inlineData: { mimeType: 'image/jpeg', data } })), { text: instruction }],
        },
      ],
      system: EXTRACT_SYSTEM,
      schema: EXTRACT_JSON_SCHEMA,
      // بلا إعداد تفكير: بعض النماذج (كـ flash-lite) ترفض thinkingBudget=0 بخطأ 400
    });
  } else {
    const stream = getClient().messages.stream({
      model: MODEL,
      max_tokens: 32000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACT_JSON_SCHEMA } },
      system: EXTRACT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((data) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
            })),
            { type: 'text' as const, text: instruction },
          ],
        },
      ],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('تعذّر استخراج النص من الملف.');
    raw = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  }
  try {
    const parsed = ExtractSchema.safeParse(JSON.parse(raw));
    // توحيد الحروف الفارسية المتشابهة وحذف أي حركات تسرّبت في النسخ
    const clean = (s: string) => s.replace(/ی/g, 'ي').replace(/ک/g, 'ك').replace(/[ً-ْ]/g, '');
    if (parsed.success) return { title: clean(parsed.data.title), text: clean(parsed.data.text) };
  } catch {}
  throw new Error('تعذّر استخراج النص من الملف.');
}
