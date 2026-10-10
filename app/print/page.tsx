'use client';

// صفحة داخلية يفتحها Chromium (Puppeteer) لتوليد PDF بالمحرك نفسه المستخدم في المعاينة.
import { useEffect, useRef } from 'react';
import { ensureFonts, renderKhutbah } from '@/lib/render';
import type { KhutbahDoc, RenderOptions } from '@/lib/types';

declare global {
  interface Window {
    __khRender?: (doc: KhutbahDoc, opts: RenderOptions) => Promise<number>;
    __khReady?: boolean;
  }
}

const PAGE_SIZE: Record<RenderOptions['layout'], string> = { a4: '210mm 297mm', mobile: '100mm 178mm' };

export default function PrintPage() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.__khRender = async (doc, opts) => {
      await ensureFonts();
      const style = document.getElementById('kh-page-size') ?? document.head.appendChild(document.createElement('style'));
      style.id = 'kh-page-size';
      style.textContent = `@page { size: ${PAGE_SIZE[opts.layout]}; margin: 0 } html, body { margin: 0; background: #fff }`;
      return renderKhutbah(root.current!, doc, opts);
    };
    window.__khReady = true;
  }, []);
  return <div ref={root} />;
}
