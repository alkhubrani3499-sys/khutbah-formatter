import fs from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import { ExportSchema, contentDisposition, fileName } from '@/lib/schema';

export const runtime = 'nodejs';
export const maxDuration = 120;

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p): p is string => !!p);

// على الاستضافات الخادومية (Vercel / AWS Lambda) لا يوجد متصفح، فنستخدم Chromium المضغوط من @sparticuz/chromium
const SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

async function launchOptions() {
  if (SERVERLESS && !process.env.CHROME_PATH) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return { executablePath: await chromium.executablePath(), args: [...chromium.args, '--font-render-hinting=none'] };
  }
  const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('لم يُعثر على متصفح Chrome/Edge لتوليد PDF. اضبط CHROME_PATH.');
  return { executablePath, args: ['--no-sandbox', '--font-render-hinting=none'] };
}

let browserPromise: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  browserPromise = launchOptions()
    .then((o) => puppeteer.launch({ ...o, headless: true }))
    .then((b) => {
      b.on('disconnected', () => (browserPromise = null));
      return b;
    });
  browserPromise.catch(() => (browserPromise = null));
  return browserPromise;
}

export async function POST(req: Request) {
  const parsed = ExportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'مستند غير صالح.' }, { status: 400 });
  const { doc, layout, color } = parsed.data;
  const origin = process.env.APP_ORIGIN ?? new URL(req.url).origin;

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    // لا يُسمح للصفحة إلا بموارد الموقع نفسه
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().startsWith(origin) || r.url().startsWith('data:') ? r.continue() : r.abort()));
    await page.goto(`${origin}/print`, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.waitForFunction('window.__khReady === true', { timeout: 30_000 });
    await page.evaluate((d, o) => window.__khRender!(d, o), doc, { layout, color });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(fileName(doc.title, layout, color, 'pdf')),
      },
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'تعذّر توليد PDF.' }, { status: 500 });
  } finally {
    await page?.close().catch(() => undefined);
  }
}
