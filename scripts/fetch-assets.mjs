// تنزيل نص المصحف (Tanzil: الرسم العثماني + الإملائي المجرد) والخطوط، ثم بناء جدول المطابقة.
// الاستخدام: npm run setup:data
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const fontDir = path.join(root, 'public', 'fonts');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(fontDir, { recursive: true });

const TANZIL = (type) =>
  `https://tanzil.net/pub/download/index.php?marks=true&sajdah=true&rub=false&tatweel=true&quranType=${type}&outType=txt-2&agree=true`;

const FONTS = {
  'AmiriQuran-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/amiriquran/AmiriQuran-Regular.ttf',
  'Amiri-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf',
  'Amiri-Bold.ttf': 'https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Bold.ttf',
  'NotoNaskhArabic-Regular.ttf':
    'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoNaskhArabic/hinted/ttf/NotoNaskhArabic-Regular.ttf',
  'NotoNaskhArabic-Bold.ttf':
    'https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoNaskhArabic/hinted/ttf/NotoNaskhArabic-Bold.ttf',
};

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return console.log('موجود:', path.basename(dest));
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log('تم:', path.basename(dest));
}

await download(TANZIL('uthmani'), path.join(dataDir, 'quran-uthmani.txt'));
await download(TANZIL('simple-clean'), path.join(dataDir, 'quran-simple-clean.txt'));
for (const [name, url] of Object.entries(FONTS)) await download(url, path.join(fontDir, name));

// ---------- بناء جدول المطابقة بين الكلمات الإملائية والعثمانية ----------
const STOP = /^[ۖ-ۭ۞۩]+$/; // علامات الوقف ونحوها تأتي كلمات مستقلة
const lines = (f) =>
  fs.readFileSync(path.join(dataDir, f), 'utf8').split(/\r?\n/).filter((l) => /^\d+\|\d+\|/.test(l));

// هيكل الكلمة: حذف الحركات والألفات والمدود لمقارنة الرسمين
const skel = (w) =>
  w
    .replace(/[ً-ٰٟۖ-ۭـ]/g, '')
    .replace(/[اأإآٱٰ]/g, '')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/ء/g, '');

const uth = lines('quran-uthmani.txt');
const sim = lines('quran-simple-clean.txt');
if (uth.length !== 6236 || sim.length !== 6236) throw new Error('عدد الآيات غير صحيح');

const ayahs = [];
let unaligned = 0;
for (let k = 0; k < uth.length; k++) {
  const [s, a, ut] = uth[k].split('|');
  const st = sim[k].split('|')[2];
  // نُبقي علامات الوقف ملتصقة بالكلمة السابقة في العثماني
  const uw = [];
  for (const w of ut.split(' ').filter(Boolean)) {
    if (w === '۞' || w === '۩') continue; // علامات الأحزاب والسجدة لا تُنقل في الاقتباس
    if (STOP.test(w)) {
      // علامة الوقف حرف مُركَّب يُرسم فوق آخر الكلمة كما في المصحف، فتُلصق بها دون مسافة
      if (uw.length) uw[uw.length - 1] += w;
      else uw.push(w);
    } else uw.push(w);
  }
  const sw = st.split(' ').filter((w) => w && !STOP.test(w));
  // map[j] = رقم الكلمة العثمانية المقابلة للكلمة الإملائية j
  const map = [];
  let i = 0;
  for (let j = 0; j < sw.length; j++) {
    const uMain = uw[i] ?? '';
    const deficit = sw.length - j - (uw.length - i);
    if (deficit > 0 && j + 1 < sw.length && skel(sw[j] + sw[j + 1]) === skel(uMain)) {
      map.push(i, i);
      j++;
      i++;
      continue;
    }
    map.push(Math.min(i, uw.length - 1));
    i++;
  }
  if (i !== uw.length) unaligned++;
  ayahs.push({ s: +s, a: +a, w: sw, u: uw, m: map, ok: i === uw.length });
}
fs.writeFileSync(path.join(dataDir, 'quran.json'), JSON.stringify(ayahs));
console.log(`quran.json: ${ayahs.length} آية، غير متطابقة كلمةً بكلمة: ${unaligned}`);
