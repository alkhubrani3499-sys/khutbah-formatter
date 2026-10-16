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
  : 'low'; // منخفض: بالقياس يساوي المتوسط جودةً (مع قائمة فحص الإعراب) وأرخص بالثلث

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

## قائمة فحص الإعراب (راجع كل جملة عليها قبل الإخراج — الخطيب كثيراً ما يخطئ فيها)
- المضارع بعد لام الأمر (فلْ/ولْ/لِ) أو «لا» الناهية أو «لم» أو «لمّا» أو أداة شرط جازمة: مجزوم، والمعتل الآخر يُحذف حرف علّته:
  فليخفيه ← فَلْيُخْفِهِ، ولا يبديه ← وَلَا يُبْدِهِ، وليدعو ← وَلْيَدْعُ، لم يأتي ← لَمْ يَأْتِ.
- خبر «كان» وأخواتها منصوب: كان عيشهم قليل ← قَلِيلًا. واسم «إنّ» وأخواتها منصوب: إن المسلمون ← إِنَّ الْمُسْلِمِينَ.
- الأسماء الخمسة (أبو، أخو، ذو، فو، حمو): بالواو رفعاً، وبالألف نصباً، وبالياء جراً: عن أبو بكر ← عَنْ أَبِي بَكْرٍ.
- جمع المذكر السالم والمثنى: بالواو/الألف رفعاً، وبالياء نصباً وجراً.
- المفعول به والظرف والحال والتمييز منصوبة: يتمنون يوم واحد ← يَوْمًا وَاحِدًا.
- الأفعال الخمسة تُحذف نونها في النصب والجزم: لن يفعلون ← لَنْ يَفْعَلُوا.
- همزة «إنّ» تُكسر في ابتداء الكلام وبعد «حتى» الابتدائية وبعد القول: حتى أنه ← حَتَّى إِنَّهُ.
- النعت يتبع منعوته، والمعطوف يتبع المعطوف عليه، في الإعراب.
كل تصحيح من هذا النوع اكتبه في marked مصحَّحاً، وسجّله في corrections.
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

/**
 * متى نرجع من Claude إلى Gemini (إن وُجد مفتاحه): نفاد الرصيد، مشكلة المفتاح، الازدحام، الانقطاع، أو الاعتذار.
 * أما الأخطاء التي سببها الطلب نفسه فلا رجوع فيها.
 */
function claudeShouldFallback(err: unknown): boolean {
  if (!process.env.GEMINI_API_KEY) return false;
  if (err instanceof Anthropic.APIError) {
    const s = err.status ?? 0;
    if (s === 400) return /credit|balance|billing/i.test(err.message); // نفاد الرصيد
    return s === 401 || s === 403 || s === 429 || s >= 500;
  }
  if (err instanceof Error) return /تعذّرت معالجة|fetch failed|ECONNRESET|ETIMEDOUT|network|authentication method/i.test(err.message);
  return false;
}

/** Claude أولاً، ثم Gemini احتياطاً */
async function withFallback<T>(claude: () => Promise<T>, gemini: () => Promise<T>): Promise<T> {
  if (PROVIDER === 'gemini') return gemini();
  try {
    return await claude();
  } catch (err) {
    if (!claudeShouldFallback(err)) throw err;
    console.warn('Claude تعذّر، الرجوع إلى Gemini:', err instanceof Error ? err.message.slice(0, 200) : err);
    return gemini();
  }
}

export function diacritizeChunk(paragraphs: LlmParagraph[], mode: DiacriticsMode, spelling = false): Promise<LlmOutput> {
  const prompt = userPrompt(paragraphs, mode, spelling);
  return withFallback(
    () => claudeChunk(prompt),
    () => geminiChunk(prompt),
  );
}

// ---------------- Claude ----------------
/** أسعار Haiku 5.5 بالدولار لكل مليون وحدة (لتقدير التكلفة في السجل فقط) */
const PRICE = { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 };

/** تسجيل استهلاك كل طلب في سجلّ الخادم (يظهر في Vercel ← Logs) */
function logUsage(kind: string, u: Anthropic.Messages.Usage | Anthropic.Beta.Messages.BetaUsage) {
  const cw = u.cache_creation_input_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  const cost =
    (u.input_tokens * PRICE.input + u.output_tokens * PRICE.output + cw * PRICE.cacheWrite + cr * PRICE.cacheRead) / 1e6;
  console.info(
    `[claude ${kind}] ${MODEL} دخل=${u.input_tokens} خرج=${u.output_tokens} كاش=${cw}/${cr} ≈ $${cost.toFixed(4)}`,
  );
}

async function claudeChunk(prompt: string): Promise<LlmOutput> {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    ...(FALLBACK ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    // التفكير متوقف افتراضياً لخفض التكلفة (قياساً: 0.7 سنت للخطبة بدل 2.4، واكتشاف 96% من أخطاء الإعراب بدل 100%)
    // CLAUDE_THINKING=on يعيده. (Haiku 5.5 يقبل إيقافه عند جهد high فأقل)
    thinking: process.env.CLAUDE_THINKING === 'on' ? { type: 'adaptive' } : { type: 'disabled' },
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: JSON_SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  });
  const msg = await stream.finalMessage();
  logUsage('ضبط', msg.usage);

  if (msg.stop_reason === 'refusal') throw new Error('تعذّرت معالجة هذا الجزء من النص.');
  if (msg.stop_reason === 'max_tokens') throw new Error('النص أطول من المسموح في جزء واحد.');
  return parseOutput(msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''));
}

// ---------------- Gemini (Google AI Studio — فيه خطة مجانية) ----------------
// قائمة نماذج بالترتيب: الحد المجاني لكل نموذج مستقل، فإذا امتلأت حصة نموذج انتقلنا إلى التالي.
const modelList = (v: string) =>
  v
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
// التشكيل: النماذج القوية فقط. (flash-lite أُزيل: أخطاء إعرابية ملحوظة في التجربة؛ الأفضل «حاول لاحقاً» من تشكيل خاطئ)
const GEMINI_MODELS = modelList(
  process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-3.8-flash,gemini-3.5-flash,gemini-flash-latest',
);
// قراءة ملفات PDF: يُسمح بالنموذج الأخف أيضاً، لأن الخطيب يراجع النص المقروء قبل الضبط
const GEMINI_EXTRACT_MODELS = modelList(
  process.env.GEMINI_EXTRACT_MODELS || [...GEMINI_MODELS, 'gemini-flash-lite-latest'].join(','),
);
let gemini: GoogleGenAI | null = null;
/** نماذج امتلأت حصتها اليومية: لا نعيد تجربتها حتى تتجدد */
const dayExhausted = new Map<string, number>();
/** نماذج امتلأ حدّ الدقيقة فيها: متاحة مجدداً بعد ثوانٍ */
const minuteBlocked = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GeminiRequest = {
  contents: ContentListUnion;
  system: string;
  schema: object;
  thinking?: number;
  models?: string[];
};

/** تحليل رفض الحصة (429): هل هو حدّ اليوم أم الدقيقة؟ وكم ننتظر؟ */
function quotaInfo(err: unknown): { daily: boolean; waitMs: number } {
  const msg = String((err as Error)?.message ?? '');
  const secs = Number(msg.match(/retryDelay\W+(\d+)s/)?.[1] ?? msg.match(/retry in (\d+(?:\.\d+)?)s/i)?.[1]);
  if (/PerDay/i.test(msg)) return { daily: true, waitMs: Math.max(secs || 0, 3600) * 1000 };
  return { daily: false, waitMs: Math.min(Math.max(secs || 20, 3), 60) * 1000 };
}

/** رقم حالة HTTP من خطأ جوجل (بالقراءة المباشرة لا بفحص النوع، فتعدد نسخ المكتبة لا يضر) */
function statusOf(err: unknown): number {
  if (err instanceof ApiError) return err.status;
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : 0;
}

/** المهلة القصوى لمحاولات جزء واحد (حد تنفيذ الطلب في Vercel 300 ثانية) */
const GEMINI_DEADLINE_MS = 200_000;

// قابل للاستبدال في الاختبار الذاتي لمحاكاة ردود جوجل دون استهلاك الحصة
let geminiCall: (req: GeminiRequest, model: string) => Promise<string> = (req, model) => geminiOnce(req, model);
export const __testing = {
  setGeminiCall(fn: (req: { contents: unknown }, model: string) => Promise<string>) {
    geminiCall = fn;
    dayExhausted.clear();
    minuteBlocked.clear();
  },
  generate: (models: string[]) => geminiGenerate({ contents: 'x', system: '', schema: {}, models }),
};

async function geminiChunk(prompt: string): Promise<LlmOutput> {
  const text = await geminiGenerate({
    contents: prompt,
    system: SYSTEM,
    schema: JSON_SCHEMA,
    thinking: Number(process.env.GEMINI_THINKING ?? 2048),
  });
  return parseOutput(text);
}

/**
 * استدعاء Gemini مع التنقّل بين النماذج:
 * - حدّ الدقيقة (429): ننتظر الثواني التي تحددها جوجل ونعيد على النموذج نفسه.
 * - حدّ اليوم (429): ننتقل إلى النموذج التالي ونتجنّبه حتى يتجدد.
 * - الازدحام (503/500) أو انقطاع الاتصال: نعيد مرة ثم ننتقل.
 * - بعد المرور على الكل: إن بقي نموذج محجوب بحدّ الدقيقة فقط ننتظره ونمرّ مرة أخرى.
 */
async function geminiGenerate(req: GeminiRequest): Promise<string> {
  let lastErr: unknown;
  const deadline = Date.now() + GEMINI_DEADLINE_MS;
  const chain = req.models ?? GEMINI_MODELS;

  for (let pass = 0; pass < 4 && Date.now() < deadline; pass++) {
    const usable = chain.filter((m) => (dayExhausted.get(m) ?? 0) < Date.now());
    if (!usable.length) break;
    let soonest = Infinity; // أقرب وقت يعود فيه نموذج محجوب بحدّ الدقيقة

    for (const model of usable) {
      const blocked = minuteBlocked.get(model) ?? 0;
      if (blocked > Date.now()) {
        soonest = Math.min(soonest, blocked);
        continue;
      }
      let current = req;
      for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
        try {
          return await geminiCall(current, model);
        } catch (err) {
          lastErr = err;
          const status = statusOf(err);
          console.warn(`[gemini] ${model} محاولة ${attempt + 1}: ${status || 'شبكة'} ${status === 429 ? (quotaInfo(err).daily ? 'حد اليوم' : 'حد الدقيقة') : ''}`);
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
            const q = quotaInfo(err);
            if (q.daily) {
              dayExhausted.set(model, Date.now() + q.waitMs);
              break; // إلى النموذج التالي
            }
            // حدّ الدقيقة: انتظار قصير على النموذج نفسه، أو تأجيله إلى المرور التالي
            if (q.waitMs <= 25_000 && Date.now() + q.waitMs < deadline) {
              await sleep(q.waitMs + Math.random() * 1500);
              continue;
            }
            minuteBlocked.set(model, Date.now() + q.waitMs);
            soonest = Math.min(soonest, Date.now() + q.waitMs);
            break;
          }
          const network = status === 0 && !(err instanceof Error && /أطول|استجابة|تعذّرت/.test(err.message));
          if (status === 503 || status === 500 || network) {
            if (attempt >= 1) break; // مرتان ثم ننتقل للتالي
            await sleep(2_000 + Math.random() * 2_000);
            continue;
          }
          throw err; // خطأ في الطلب نفسه (مفتاح، صلاحية، نص)
        }
      }
    }

    // لم ينجح شيء في هذا المرور: إن كان نموذج سيعود قريباً ننتظره، وإلا انتهينا
    if (chain.every((m) => (dayExhausted.get(m) ?? 0) > Date.now())) break; // حصة اليوم امتلأت للكل
    if (soonest === Infinity || soonest > deadline) {
      // النماذج المزدحمة (503) قد تهدأ: مرور أخير بعد مهلة قصيرة
      if (pass === 0 && Date.now() + 8_000 < deadline) {
        await sleep(8_000);
        continue;
      }
      break;
    }
    await sleep(Math.max(0, soonest - Date.now()) + 500);
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
  const viaGemini = () =>
    geminiGenerate({
      contents: [
        {
          role: 'user',
          parts: [...images.map((data) => ({ inlineData: { mimeType: 'image/jpeg', data } })), { text: instruction }],
        },
      ],
      system: EXTRACT_SYSTEM,
      schema: EXTRACT_JSON_SCHEMA,
      models: GEMINI_EXTRACT_MODELS,
      // بلا إعداد تفكير: بعض النماذج (كـ flash-lite) ترفض thinkingBudget=0 بخطأ 400
    });
  const viaClaude = async () => {
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
    logUsage('قراءة PDF', msg.usage);
    if (msg.stop_reason === 'refusal') throw new Error('تعذّرت معالجة الملف.');
    return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  };
  const raw = await withFallback(viaClaude, viaGemini);
  try {
    const parsed = ExtractSchema.safeParse(JSON.parse(raw));
    // توحيد الحروف الفارسية المتشابهة، وحذف ما تسرّب في النسخ: الحركات وعلامات المصحف (ٰ ۖ ۚ…)
    // والتطويل داخل الكلمة («يكشــف»)، مع إبقاء «ـ» المنفردة التي تُستعمل شَرطة («ـ سبحانك ـ»)
    const clean = (s: string) =>
      s
        .replace(/ی/g, 'ي')
        .replace(/ک/g, 'ك')
        .replace(/[ً-ْٰۖ-ۭ]/g, '')
        .replace(/(?<=[ء-ي])ـ+(?=[ء-ي])/g, '')
        .replace(/[ \t]{2,}/g, ' ');
    if (parsed.success) return { title: clean(parsed.data.title), text: clean(parsed.data.text) };
  } catch {}
  throw new Error('تعذّر استخراج النص من الملف.');
}
