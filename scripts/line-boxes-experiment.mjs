// Experiment: asks the scan model where each receipt line item sits on the photo,
// then writes an HTML page that draws those boxes over the image so we can judge the accuracy.
//
// Usage (key is read from the environment, never printed):
//   node --env-file=PATH\TO\.env scripts/line-boxes-experiment.mjs path\to\receipt.jpg
// Output: design/line-boxes-<name>.html (open it in a browser)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, extname } from 'node:path';

const imagePath = process.argv[2];
const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

if (!imagePath) {
  console.error('Give the path of a receipt image.');
  process.exit(1);
}
if (!apiKey) {
  console.error('No GEMINI_API_KEY found. Pass your env file with --env-file=...');
  process.exit(1);
}

const mimeByExt = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const mimeType = mimeByExt[extname(imagePath).toLowerCase()] || 'image/jpeg';
const base64 = readFileSync(imagePath).toString('base64');

const prompt = `Look at the receipt in this image. For every purchased line item on the receipt, return its description and a bounding box around the whole printed line (description and price).
Use box_2d = [ymin, xmin, ymax, xmax] with each number from 0 to 1000, relative to the whole image.
Only include real purchased items, not totals, tax, store info or payment lines.`;

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: base64, mimeType } }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            description: { type: 'STRING' },
            box_2d: { type: 'ARRAY', items: { type: 'NUMBER' } }
          },
          required: ['description', 'box_2d']
        }
      }
    }
  })
});

if (!res.ok) {
  console.error('Request failed:', res.status, (await res.text()).slice(0, 300));
  process.exit(1);
}

const payload = await res.json();
const text = payload.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '[]';
const items = JSON.parse(text.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));

const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16'];
const boxes = items.map((item, i) => {
  const [ymin, xmin, ymax, xmax] = item.box_2d;
  const color = colors[i % colors.length];
  return `<div style="position:absolute;left:${xmin / 10}%;top:${ymin / 10}%;width:${(xmax - xmin) / 10}%;height:${(ymax - ymin) / 10}%;border:3px solid ${color};background:${color}33;box-sizing:border-box"></div>`;
}).join('\n');
const legend = items.map((item, i) => `<li><span style="color:${colors[i % colors.length]}">■</span> ${item.description} <small>${JSON.stringify(item.box_2d)}</small></li>`).join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>Line boxes</title>
<body style="font-family:sans-serif;background:#111;color:#eee;margin:16px">
<h3>${basename(imagePath)} (${model}) - ${items.length} items found</h3>
<div style="position:relative;display:inline-block;max-width:700px"><img style="width:100%;display:block" src="data:${mimeType};base64,${base64}">
${boxes}</div>
<ul>${legend}</ul></body>`;

mkdirSync('design', { recursive: true });
const out = `design/line-boxes-${basename(imagePath, extname(imagePath))}.html`;
writeFileSync(out, html);
console.log(`Found ${items.length} items. Open ${out}`);
