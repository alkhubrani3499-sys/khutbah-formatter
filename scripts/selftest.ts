// اختبار ذاتي لمحرك المعالجة دون استدعاء النموذج: مخرجات نموذج «محاكاة» تتضمن
// تصحيحاً إعرابياً مصرَّحاً، وتعديلاً غير مصرَّح (يجب أن يُرفض)، وآيات معلَّمة وغير معلَّمة.
// الاستخدام: npx tsx scripts/selftest.ts [مسار حفظ المستند JSON]
import fs from 'node:fs';
import { assemble, prepare } from '@/lib/server/process';
import { matchQuran } from '@/lib/server/quran';
import { stripDiacritics } from '@/lib/arabic';

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

// ---- مطابقة الآيات ----
const m1 = matchQuran('يا أيها الذين آمنوا اتقوا الله حق تقاته ولا تموتن إلا وأنتم مسلمون'.split(' '));
check('آل عمران ١٠٢', m1?.ref === '3:102', `${m1?.ref} ${m1?.text}`);
const m2 = matchQuran('إن الله وملائكته يصلون على النبي يا أيها الذين آمنوا صلوا عليه وسلموا تسليما'.split(' '));
check('الأحزاب ٥٦', m2?.ref === '33:56', m2?.text);
const m3 = matchQuran('محمد رسول الله والذين معه أشداء على الكفار رحماء بينهم'.split(' '));
check('مقطع من آية (الفتح ٢٩)', m3?.ref === '48:29', m3?.text);
const m4 = matchQuran('والسابقون الأولون من المهاجرين والانصار'.split(' ')); // همزة محذوفة
check('تسامح الهمزات', m4?.ref === '9:100', m4?.text);
check('نص غير قرآني لا يطابق', matchQuran('أصحاب رسول الله هم حملة الإسلام الأولون'.split(' ')) === null);

// ---- الدمج وحماية النص ----
const raw = `الخطبة الأولى
• أصحاب رسول الله ﷺ هم أنصاره المدافعون عنه والمنافحون.
أما بعد: فيا أيها الناس: أوصيكم ونفسي بتقوى الله، {يا أيها الذين آمنوا اتقوا الله حق تقاته ولا تموتن إلا وأنتم مسلمون}.
اللهم ارض عن الخلفاء الراشدين أبو بكر وعمر وعثمان وعلي.
قال ﷺ: «آية الإيمان حب الأنصار» متفق عليه، وقال تعالى إن الله يأمر بالعدل والإحسان وإيتاء ذي القربى.`;
const paras = prepare(raw);
check('تحليل الفقرات', paras.length === 5 && paras[0].hint === 'heading' && paras[1].hint === 'bullet');

const results = new Map([
  [0, { id: 0, kind: 'heading' as const, marked: 'الْخُطْبَةُ الْأُولَى' }],
  [1, { id: 1, kind: 'bullet' as const, marked: '<e>أَصْحَابُ رَسُولِ اللهِ</e> ﷺ هُمْ أَنْصَارُهُ الْمُدَافِعُونَ عَنْهُ وَالْمُنَافِحُونَ.' }],
  // «أوصيكم» → «أنصحكم»: تعديل غير مصرّح يجب أن يُرفض
  [2, { id: 2, kind: 'lead' as const, marked: '<l>أَمَّا بَعْدُ: فَيَا أَيُّهَا النَّاسُ:</l> أَنْصَحُكُمْ وَنَفْسِي بِتَقْوَى اللهِ، {<q>يَا أَيُّهَا الَّذِينَ آمَنُوا اتَّقُوا اللهَ حَقَّ تُقَاتِهِ وَلَا تَمُوتُنَّ إِلَّا وَأَنْتُمْ مُسْلِمُونَ</q>}.' }],
  [3, { id: 3, kind: 'para' as const, marked: '<e>اللَّهُمَّ</e> ارْضَ عَنِ الْخُلَفَاءِ الرَّاشِدِينَ أَبِي بَكْرٍ وَعُمَرَ وَعُثْمَانَ وَعَلِيٍّ.' }],
  [4, { id: 4, kind: 'para' as const, marked: '<e>قَالَ ﷺ</e>: «<h>آيَةُ الْإِيمَانِ حُبُّ الْأَنْصَارِ</h>» مُتَّفَقٌ عَلَيْهِ، وَقَالَ تَعَالَى إِنَّ اللهَ يَأْمُرُ بِالْعَدْلِ وَالْإِحْسَانِ وَإِيتَاءِ ذِي الْقُرْبَى.' }],
]);
const out = assemble(paras, results, [{ original: 'أبو بكر', corrected: 'أبي بكر', reason: 'بدل مجرور وعلامة جره الياء' }]);

const plain = (i: number) => out.blocks[i].segs.map((s) => s.t).join(' ');
check('رفض التعديل غير المصرّح', plain(2).includes('أوصيكم') && !plain(2).includes('أنصح'), plain(2));
check('قبول التصحيح الإعرابي', plain(3).includes('أَبِي') && out.corrections.length === 1, JSON.stringify(out.corrections));
const q = out.blocks[2].segs.find((s) => s.k === 'quran');
check('الآية بالرسم العثماني', !!q && stripDiacritics(q.t).includes('ٱلذين') && q.ref === '3:102', q?.t);
check('حذف أقواس المدخل حول الآية', !plain(2).includes('{') && !plain(2).includes('}'));
const q2 = out.blocks[4].segs.find((s) => s.k === 'quran');
check('اكتشاف آية غير معلَّمة', q2?.ref === '16:90', q2?.t);
check('الحديث معلَّم', out.blocks[4].segs.some((s) => s.k === 'hadith'));
check('الشكل مضاف', out.blocks[1].segs[0].t !== stripDiacritics(out.blocks[1].segs[0].t));
console.log('ملاحظات:', out.warnings);

// ---- الإملاء: «الى» ← «إلى» و«كانو» ← «كانوا» ----
const p2 = prepare('كانو يذهبون الى المسجد وكان عيشهم قليل');
const r2 = new Map([[0, { id: 0, kind: 'para' as const, marked: 'كَانُوا يَذْهَبُونَ إِلَى الْمَسْجِدِ وَكَانَ عَيْشُهُمْ قَلِيلًا' }]]);
const c2 = [
  { original: 'كانو', corrected: 'كانوا', reason: 'إعرابي مزعوم' },
  { original: 'قليل', corrected: 'قليلا', reason: 'خبر كان منصوب' },
];
const off = assemble(p2, r2 as never, c2, false);
const offText = off.blocks[0].segs.map((s) => s.t).join(' ');
check('بلا إملاء: «كانو» تبقى كما هي', offText.includes('كانو ') && !offText.includes('كانوا'), offText);
check('بلا إملاء: «الى» تُشكَّل بحروفها', offText.includes('اِلَى'), offText);
check('بلا إملاء: التصحيح الإعرابي مقبول', off.corrections.length === 1 && off.corrections[0].type === 'i3rab');
const on = assemble(p2, r2 as never, c2, true);
check('مع الإملاء: «كانوا» و«إلى» مقبولتان', on.corrections.filter((c) => c.type === 'imla').length === 2, JSON.stringify(on.corrections));

if (process.argv[2]) {
  fs.writeFileSync(
    process.argv[2],
    JSON.stringify({ title: 'منزلة الصحابة رضي الله عنهم وخطورة الطعن بهم', preacher: 'الشيخ الخطيب', ...out }, null, 1),
  );
  console.log('حُفظ المستند في', process.argv[2]);
}
process.exit(failed ? 1 : 0);
