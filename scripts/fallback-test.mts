// اختبار التنقّل بين نماذج Gemini بمحاكاة ردود جوجل (لا يتصل بالإنترنت)
// الاستخدام: npx tsx scripts/fallback-test.ts
import { ApiError } from '@google/genai';
import { __testing } from '@/lib/server/llm';

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};
const e429 = (kind: 'PerMinute' | 'PerDay', secs: number) =>
  new ApiError({ status: 429, message: `{"quotaId":"GenerateRequests${kind}PerProjectPerModel-FreeTier","retryDelay":"${secs}s"}` });
const e503 = () => new ApiError({ status: 503, message: 'high demand' });

// ١) الأول مزدحم دائماً، والثاني يعمل
{
  const calls: string[] = [];
  __testing.setGeminiCall(async (_r, m) => {
    calls.push(m);
    if (m === 'A') throw e503();
    return 'ok-' + m;
  });
  const out = await __testing.generate(['A', 'B']);
  check('الأول مزدحم ← ينتقل للثاني', out === 'ok-B', calls.join(','));
}

// ٢) الثاني امتلأ حدّ الدقيقة مرة واحدة ← ينتظر ثوانٍ ويعيد عليه (لا يستسلم)
{
  const calls: string[] = [];
  let bHits = 0;
  __testing.setGeminiCall(async (_r, m) => {
    calls.push(m);
    if (m === 'A') throw e429('PerDay', 30000);
    if (m === 'B' && bHits++ === 0) throw e429('PerMinute', 2);
    return 'ok-' + m;
  });
  const t = Date.now();
  const out = await __testing.generate(['A', 'B', 'C']);
  check('حدّ الدقيقة ← انتظار وإعادة على النموذج نفسه', out === 'ok-B', `${calls.join(',')} بعد ${((Date.now() - t) / 1000).toFixed(1)}ث`);
}

// ٣) حدّ اليوم على الكل ← خطأ واضح دون انتظار طويل
{
  __testing.setGeminiCall(async () => {
    throw e429('PerDay', 30000);
  });
  const t = Date.now();
  let err: unknown;
  try {
    await __testing.generate(['A', 'B']);
  } catch (e) {
    err = e;
  }
  check('امتلاء اليوم للكل ← خطأ 429', err instanceof ApiError && err.status === 429, `بعد ${((Date.now() - t) / 1000).toFixed(1)}ث`);
}

// ٤) حدّ اليوم على الأول ← لا يعيد تجربته في الطلب التالي
{
  const calls: string[] = [];
  __testing.setGeminiCall(async (_r, m) => {
    calls.push(m);
    if (m === 'A') throw e429('PerDay', 30000);
    return 'ok-' + m;
  });
  await __testing.generate(['A', 'B']);
  calls.length = 0;
  await __testing.generate(['A', 'B']);
  check('النموذج الممتلئ يومياً يُتجاوز مباشرة', calls.join(',') === 'B', calls.join(','));
}

process.exit(failed ? 1 : 0);
