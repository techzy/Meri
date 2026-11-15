// Renders three 1280x720 YouTube thumbnails in the same line-drawn style as the video.
const { chromium } = require('playwright'); const path = require('path');
const C = { bg: '#ECEDEA', line: '#3A3C40', dark: '#15161A', mid: '#6E7075', red: '#D8455F', panel: '#E0E1DE' };
const V = n => 25000 * Math.pow(1.08, n) + 6000 * (Math.pow(1.08, n) - 1) / 0.08;
const yearAt = v => { let lo = 0, hi = 60; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; V(m) < v ? lo = m : hi = m } return lo };
const T = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 100}" font-weight="${o.weight || 800}" fill="${o.c || C.dark}" text-anchor="${o.anchor || 'start'}" letter-spacing="${o.ls === undefined ? -3 : o.ls}">${s}</text>`;
const stick = (x, y, k, o = {}) => { const c = C.line, sw = 6, hr = 30 * k, hip = y - 110 * k, neck = hip - 120 * k, hx = x + (o.lean || 0) * k, sh = neck + 26 * k;
  const arm = h => `<path d="M${hx} ${sh} Q${(hx + hx + h[0] * k) / 2} ${sh + h[1] * k / 2 - 14 * k} ${hx + h[0] * k} ${sh + h[1] * k}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`;
  const m = o.mood === undefined ? 1 : o.mood;
  return `<g stroke="${c}" stroke-width="${sw}" stroke-linecap="round" fill="none"><line x1="${x}" y1="${hip}" x2="${x - 30 * k}" y2="${y}"/><line x1="${x}" y1="${hip}" x2="${x + 30 * k}" y2="${y}"/><line x1="${x}" y1="${hip}" x2="${hx}" y2="${neck}"/></g>${arm(o.armL || [-46, 92])}${arm(o.armR || [46, 92])}<circle cx="${hx}" cy="${neck - hr}" r="${hr}" fill="${C.bg}" stroke="${c}" stroke-width="${sw}"/><circle cx="${hx - 10 * k + 5 * k}" cy="${neck - hr - 4 * k}" r="${4.5 * k}" fill="${c}"/><circle cx="${hx + 10 * k + 5 * k}" cy="${neck - hr - 4 * k}" r="${4.5 * k}" fill="${c}"/><path d="M${hx - 6 * k} ${neck - hr + 12 * k} Q${hx + 5 * k} ${neck - hr + 12 * k + 9 * k * m} ${hx + 16 * k} ${neck - hr + 12 * k}" fill="none" stroke="${c}" stroke-width="${sw * .8}" stroke-linecap="round"/>` };
function thumbA() { // the number
  const gx = 700, gy = 610, gw = 500, gh = 500, maxN = 29.2, maxV = 880000, X = n => gx + gw * n / maxN, Y = v => gy - gh * v / maxV, y4 = yearAt(4e5), y8 = yearAt(8e5);
  const pts = (a, b) => { let d = ''; for (let n = a; n <= b + 1e-6; n += .2) d += (d ? 'L' : 'M') + X(n).toFixed(1) + ' ' + Y(V(n)).toFixed(1); return d + 'L' + X(b).toFixed(1) + ' ' + Y(V(b)).toFixed(1) };
  return `<path d="M${gx} ${gy - gh - 20} L${gx} ${gy} L${gx + gw + 20} ${gy}" fill="none" stroke="${C.line}" stroke-width="5" stroke-linecap="round"/>
  <path d="${pts(0, y4)}" fill="none" stroke="${C.dark}" stroke-width="9" stroke-linecap="round"/><path d="${pts(y4, y8)}" fill="none" stroke="${C.red}" stroke-width="12" stroke-linecap="round"/>
  <line x1="${X(y4)}" y1="${Y(4e5)}" x2="${X(y4)}" y2="${gy}" stroke="${C.line}" stroke-width="3" stroke-dasharray="6 10"/>
  <circle cx="${X(y4)}" cy="${Y(4e5)}" r="14" fill="${C.dark}"/><circle cx="${X(y8)}" cy="${Y(8e5)}" r="17" fill="${C.red}"/>
  ${T(X(y4 / 2), gy + 62, '21 yrs', { size: 46, anchor: 'middle', ls: -1 })}${T((X(y4) + X(y8)) / 2, gy + 62, '8 yrs', { size: 46, anchor: 'middle', c: C.red, ls: -1 })}
  ${T(70, 200, 'First $400k:', { size: 84, weight: 700, c: C.mid })}${T(70, 326, '21 YEARS', { size: 122 })}
  ${T(70, 470, 'Next $400k:', { size: 84, weight: 700, c: C.mid })}${T(70, 596, '8 YEARS', { size: 122, c: C.red })}`;
}
function thumbB() { // the ball
  const ex = 560, gy = 470, r = 74, ang = Math.atan2(250, 720), d = 300, bx = ex + Math.cos(ang) * d + Math.sin(ang) * r, by = gy + Math.sin(ang) * d - Math.cos(ang) * r;
  let sp = ''; for (let i = 0; i < 3; i++) sp += `<line x1="${bx - 110 - i * 40}" y1="${by - 70 - i * 34}" x2="${bx - 230 - i * 40}" y2="${by - 112 - i * 34}" stroke="${C.red}" stroke-width="6" stroke-linecap="round"/>`;
  return `<path d="M-20 ${gy} L${ex} ${gy} L${ex + 760} ${gy + 264}" fill="none" stroke="${C.dark}" stroke-width="7" stroke-linejoin="round"/>
  <line x1="${ex}" y1="${gy - 120}" x2="${ex}" y2="${gy}" stroke="${C.red}" stroke-width="5" stroke-dasharray="12 12"/>
  ${stick(300, gy, 1.25, { armR: [70, 30], mood: 1 })}
  <circle cx="${bx}" cy="${by}" r="${r}" fill="${C.red}"/>${sp}
  ${T(1210, 150, 'THE BALL ROLLS', { size: 104, anchor: 'end' })}${T(1210, 262, 'ON ITS OWN.', { size: 104, anchor: 'end', c: C.red })}
  ${T(1210, 330, 'activation energy, explained', { size: 40, weight: 500, anchor: 'end', c: C.mid, ls: 0 })}`;
}
function thumbC() { // the hill
  const hill = 'M40 470 L330 470 C 520 470, 560 235, 720 235 C 880 235, 930 560, 1100 560 L1260 560';
  return `<path d="${hill}" fill="none" stroke="${C.dark}" stroke-width="9" stroke-linecap="round"/>
  <line x1="350" y1="470" x2="800" y2="470" stroke="${C.line}" stroke-width="3" stroke-dasharray="6 10"/>
  <g stroke="${C.red}" stroke-width="7" stroke-linecap="round"><line x1="720" y1="456" x2="720" y2="262"/><line x1="720" y1="262" x2="704" y2="286"/><line x1="720" y1="262" x2="736" y2="286"/><line x1="720" y1="456" x2="704" y2="432"/><line x1="720" y1="456" x2="736" y2="432"/></g>
  ${stick(150, 470, .95, { armR: [86, 44], lean: 26, mood: -1 })}
  <circle cx="292" cy="418" r="50" fill="${C.red}"/>
  ${T(640, 118, 'THE START IS THE', { size: 92, anchor: 'middle' })}
  ${T(640, 690, 'HARDEST PART', { size: 120, anchor: 'middle', c: C.red })}
  ${T(720, 200, 'activation energy', { size: 40, weight: 600, c: C.red, ls: 0, anchor: 'middle' })}`;
}
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const all = { 'thumbnail-1-21-years-vs-8': thumbA(), 'thumbnail-2-rolls-on-its-own': thumbB(), 'thumbnail-3-hardest-part': thumbC() };
  for (const [name, inner] of Object.entries(all)) {
    await p.setContent(`<html><body style="margin:0;background:${C.bg}"><svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" style="display:block;font-family:Inter,sans-serif"><rect width="1280" height="720" fill="${C.bg}"/>${inner}</svg></body></html>`);
    await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: path.join(__dirname, name + '.png') });
  }
  await b.close();
})();
