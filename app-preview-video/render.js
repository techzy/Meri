// Renders the transparent overlay. Usage: node render.js <v> frames [worker] [nWorkers] | node render.js <v> stills t1,t2,...
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const v = process.argv[2], mode = process.argv[3], B = path.join(__dirname, 'build', v);
  const html = fs.readFileSync(path.join(__dirname, 'overlay.html'), 'utf8').replace('/*CAPTIONS*/null', fs.readFileSync(path.join(B, 'captions.json'), 'utf8'));
  fs.writeFileSync(path.join(B, 'overlay.built.html'), html);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
  await p.goto('file://' + path.join(B, 'overlay.built.html')); await p.evaluate(() => document.fonts.ready);
  const total = await p.evaluate(() => window.TOTAL);
  if (mode === 'stills') { fs.mkdirSync(path.join(B, 'stills'), { recursive: true });
    for (const t of process.argv[4].split(',').map(Number)) { await p.evaluate(t => window.render(t), t); await p.screenshot({ path: path.join(B, 'stills', `t${t.toFixed(2).padStart(6, '0')}.png`), omitBackground: true }); }
  } else { const wk = +(process.argv[4] || 0), nw = +(process.argv[5] || 1), out = path.join(B, 'ov'); fs.mkdirSync(out, { recursive: true }); const n = Math.round(total * 30);
    for (let f = wk; f < n; f += nw) { await p.evaluate(t => window.render(t), f / 30); await p.screenshot({ path: path.join(out, `f${String(f).padStart(5, '0')}.png`), omitBackground: true }); }
    console.log('worker', wk, 'done', n); }
  await b.close();
})();
