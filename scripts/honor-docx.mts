// يبني ملف Word تجريبياً فيه رموز الصلاة والترضّي (للتحقق من ظهورها)
import fs from 'node:fs';
const { buildDocx } = await import('@/lib/server/docx');
const out = process.argv[2];
const doc = {
  title: 'منزلة الصحابة ﵃ وخطورة الطعن بهم',
  preacher: 'الشيخ أبو بكر ﵀',
  blocks: [
    { kind: 'para' as const, segs: [{ k: 'text' as const, t: 'قَالَ رَسُولُ اللهِ ﷺ: إِنَّ أَبَا بَكْرٍ ﵁ وَعَائِشَةَ ﵂ وَالصَّحَابَةَ ﵃ خَيْرُ النَّاسِ.' }] },
    { kind: 'para' as const, segs: [{ k: 'text' as const, t: 'وَمُوسَى ﵇ نَبِيٌّ كَرِيمٌ، وَاللهُ ﷻ أَعْلَمُ.' }] },
  ],
  corrections: [],
  warnings: [],
};
fs.writeFileSync(out, await buildDocx(doc, { layout: 'a4', color: 'maroon' }));
console.log('ok');
