// Usage: node render.js <outDir> [fps] [worker] [nWorkers]  |  node render.js --stills t1,t2,...
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const cap = fs.readFileSync(path.join(__dirname, 'build/captions.json'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'scene.html'), 'utf8').replace('/*CAPTIONS*/null', cap);
  fs.writeFileSync(path.join(__dirname, 'build/scene.built.html'), html);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
  await p.goto('file://' + path.join(__dirname, 'build/scene.built.html')); await p.evaluate(() => document.fonts.ready);
  const total = await p.evaluate(() => window.TOTAL);
  if (process.argv[2] === '--stills') {
    fs.mkdirSync(path.join(__dirname, 'build/'+(process.env.STILLS||'stills')), { recursive: true });
    const ts = process.argv[3] === 'scenes' ? null : process.argv[3].split(',').map(Number);
    for (const t of ts) { await p.evaluate(t => window.render(t), t); await p.screenshot({ path: path.join(__dirname, `build/${process.env.STILLS||'stills'}/t${t.toFixed(2).padStart(6, '0')}.png`) }); }
    console.log('total', total, 'scenes', await p.evaluate(() => window.SCENES.map(x => +x.toFixed(2)).join(' ')));
  } else {
    const out = process.argv[2], fps = +(process.argv[3] || 30), wk = +(process.argv[4] || 0), nw = +(process.argv[5] || 1);
    fs.mkdirSync(out, { recursive: true }); const n = Math.ceil(total * fps);
    for (let f = wk; f < n; f += nw) { await p.evaluate(t => window.render(t), f / fps); await p.screenshot({ path: path.join(out, `f${String(f).padStart(5, '0')}.png`) }); }
    console.log('worker', wk, 'done; frames', n);
  }
  await b.close();
})();
