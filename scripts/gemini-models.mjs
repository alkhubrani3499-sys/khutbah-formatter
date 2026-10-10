// يعرض نماذج Gemini المتاحة للمفتاح في .env.local (لا يطبع المفتاح)
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const env = fs.readFileSync('.env.local', 'utf8');
const apiKey = env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim();
if (!apiKey) throw new Error('GEMINI_API_KEY غير موجود في .env.local');

const ai = new GoogleGenAI({ apiKey });
const pager = await ai.models.list();
const names = [];
for await (const m of pager) {
  if (m.supportedActions?.includes('generateContent')) names.push(m.name);
}
console.log(names.filter((n) => /gemini/.test(n)).join('\n'));
