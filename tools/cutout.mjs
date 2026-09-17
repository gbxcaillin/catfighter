import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const SRC = process.argv[2];
const OUTDIR = process.argv[3];
const PANELS = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
fs.mkdirSync(OUTDIR, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
const b64 = fs.readFileSync(SRC).toString('base64');
await page.setContent(`<img id="src" src="data:image/png;base64,${b64}">`);
await page.waitForFunction(() => document.getElementById('src').complete);

const results = await page.evaluate((panels) => {
  const img = document.getElementById('src');
  const out = {};
  for (const [name, box] of Object.entries(panels)) {
    const [x, y, w, h, opts] = box;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, x, y, w, h, 0, 0, w, h);
    const id = g.getImageData(0, 0, w, h); const d = id.data;
    const N = w * h;
    const lum = new Float32Array(N), sat = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      lum[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
      sat[i] = mx === 0 ? 0 : (mx - mn) / mx;
    }
    let a2;
    if (opts && opts.mode === 'chroma') {
      // green-screen key on green dominance, then un-mix the key colour out of soft edges
      const [t0, t1] = opts.chroma || [110, 215];
      a2 = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
        const gdom = gg - Math.max(r, b);
        const a = 1 - Math.max(0, Math.min(1, (gdom - t0) / (t1 - t0)));
        a2[i] = a;
        if (a > 0 && a < 1) {
          const k = 1 - a;
          d[i * 4] = Math.max(0, Math.min(255, (r - k * 0) / a));
          d[i * 4 + 1] = Math.max(0, Math.min(255, (gg - k * 255) / a));
          d[i * 4 + 2] = Math.max(0, Math.min(255, (b - k * 0) / a));
        }
        if (a > 0 && gg > Math.max(r, b) * 1.15 && !(opts.keepGreen)) d[i * 4 + 1] = Math.max(r, b);
      }
    } else if (opts && opts.mode === 'lumkey') {
      const [L0, L1] = opts.lum || [140, 235];
      a2 = new Float32Array(N);
      for (let i = 0; i < N; i++) a2[i] = Math.max(0, Math.min(1, (lum[i] - L0) / (L1 - L0)));
    } else {
    const mask = new Uint8Array(N); // 1 = background
    const morphR = (src, val, r) => {
      const dst = new Uint8Array(N);
      for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
        const i = py * w + px; let hit = false;
        for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const qx = px + dx, qy = py + dy;
          const v = (qx < 0 || qy < 0 || qx >= w || qy >= h) ? 0 : src[qy * w + qx];
          if (v === val) { hit = true; break; }
        }
        dst[i] = hit ? val : 1 - val;
      }
      return dst;
    };
    if (opts && opts.mode === 'key') {
      const [lo, hi, smax] = opts.key || [60, 185, 0.5];
      const isBg = (i) => { const r = d[i*4], gg = d[i*4+1], b = d[i*4+2]; return lum[i] >= lo && lum[i] <= hi && sat[i] < smax && r >= gg - 8 && b >= gg - 8; };
      const stack = [];
      for (let px = 0; px < w; px++) { stack.push(px); stack.push((h - 1) * w + px); }
      for (let py = 0; py < h; py++) { stack.push(py * w); stack.push(py * w + w - 1); }
      while (stack.length) {
        const i = stack.pop();
        if (mask[i] || !isBg(i)) continue;
        mask[i] = 1;
        const px = i % w, py = (i / w) | 0;
        if (px > 0) stack.push(i - 1);
        if (px < w - 1) stack.push(i + 1);
        if (py > 0) stack.push(i - w);
        if (py < h - 1) stack.push(i + w);
      }
    } else if (opts && opts.mode === 'edge') {
      // outline-based: sprites have hard inked edges, the background is blurred
      const ET = (opts.edge || 14) * 4, ER0 = opts.dil || 6;
      const BR = opts.blur || 0;
      let src = d;
      if (BR > 0) {
        src = new Float32Array(N * 4);
        const area = (2 * BR + 1) * (2 * BR + 1);
        for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
          let r = 0, gg = 0, b = 0;
          for (let dy = -BR; dy <= BR; dy++) for (let dx = -BR; dx <= BR; dx++) {
            const qx = Math.min(w - 1, Math.max(0, px + dx)), qy = Math.min(h - 1, Math.max(0, py + dy)); const j = (qy * w + qx) * 4;
            r += d[j]; gg += d[j + 1]; b += d[j + 2];
          }
          const i = (py * w + px) * 4; src[i] = r / area; src[i + 1] = gg / area; src[i + 2] = b / area;
        }
      }
      const edge = new Uint8Array(N);
      for (let py = 1; py < h - 1; py++) for (let px = 1; px < w - 1; px++) {
        const i = py * w + px; let gsum = 0;
        for (let ch = 0; ch < 3; ch++) gsum += Math.abs(src[(i + 1) * 4 + ch] - src[(i - 1) * 4 + ch]) + Math.abs(src[(i + w) * 4 + ch] - src[(i - w) * 4 + ch]);
        if (gsum > ET) edge[i] = 1;
      }
      const dil = morphR(edge, 1, ER0);
      const reach = new Uint8Array(N); const st = [];
      for (let px = 0; px < w; px++) { st.push(px); st.push((h - 1) * w + px); }
      for (let py = 0; py < h; py++) { st.push(py * w); st.push(py * w + w - 1); }
      for (const i of st) if (!dil[i]) reach[i] = 1;
      while (st.length) {
        const i = st.pop(); if (!reach[i]) continue;
        const px = i % w, py = (i / w) | 0;
        for (const j of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1]) if (j >= 0 && !reach[j] && !dil[j]) { reach[j] = 1; st.push(j); }
      }
      const sprite0 = new Uint8Array(N); for (let i = 0; i < N; i++) sprite0[i] = reach[i] ? 0 : 1;
      const sprite = morphR(sprite0, 0, ER0 - 1);
      for (let i = 0; i < N; i++) mask[i] = sprite[i] ? 0 : 1;
    } else {
      // region-grow from the panel edges: follow the smooth background gradient, stop at hard edges/outlines
      const TOL = (opts && opts.tol) || 11;
      const near = (i, j) => Math.abs(d[i*4]-d[j*4]) + Math.abs(d[i*4+1]-d[j*4+1]) + Math.abs(d[i*4+2]-d[j*4+2]) < TOL * 3;
      const stack = [];
      for (let px = 0; px < w; px++) { stack.push(px); stack.push((h - 1) * w + px); }
      for (let py = 0; py < h; py++) { stack.push(py * w); stack.push(py * w + w - 1); }
      for (const i of stack) mask[i] = 1;
      while (stack.length) {
        const i = stack.pop();
        const px = i % w, py = (i / w) | 0;
        const nb = [];
        if (px > 0) nb.push(i - 1);
        if (px < w - 1) nb.push(i + 1);
        if (py > 0) nb.push(i - w);
        if (py < h - 1) nb.push(i + w);
        for (const j of nb) if (!mask[j] && near(i, j)) { mask[j] = 1; stack.push(j); }
      }
    }
    // enclosed background pockets: pixels close to the per-row background average, grown as islands not touching the sprite outline
    const rowBg = new Float32Array(h * 3), rowN = new Float32Array(h);
    for (let i = 0; i < N; i++) if (mask[i]) { const py = (i / w) | 0; rowBg[py*3] += d[i*4]; rowBg[py*3+1] += d[i*4+1]; rowBg[py*3+2] += d[i*4+2]; rowN[py]++; }
    for (let py = 0; py < h; py++) if (rowN[py]) { rowBg[py*3] /= rowN[py]; rowBg[py*3+1] /= rowN[py]; rowBg[py*3+2] /= rowN[py]; }
    const HT = (opts && opts.hole) || 26;
    const cand = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (mask[i]) continue;
      const py = (i / w) | 0; if (!rowN[py]) continue;
      const dist = Math.abs(d[i*4] - rowBg[py*3]) + Math.abs(d[i*4+1] - rowBg[py*3+1]) + Math.abs(d[i*4+2] - rowBg[py*3+2]);
      if (dist < HT) cand[i] = 1;
    }
    const seen = new Uint8Array(N);
    for (let s0 = 0; s0 < N; s0++) {
      if (!cand[s0] || seen[s0]) continue;
      const st = [s0]; seen[s0] = 1; const px0 = [];
      while (st.length) { const i = st.pop(); px0.push(i); const px = i % w, py = (i / w) | 0;
        for (const j of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1]) if (j >= 0 && cand[j] && !seen[j]) { seen[j] = 1; st.push(j); } }
      if (px0.length >= ((opts && opts.holeMin) || 40)) { for (const i of px0) mask[i] = 1; }
    }
    // morphological close on the sprite (dilate R then erode R) to seal thin leaks into fur shading
    const R = (opts && opts.close) || 4;
    const sp = new Uint8Array(N); for (let i = 0; i < N; i++) sp[i] = mask[i] ? 0 : 1;
    const morph = (src, val) => { // val=1: dilate sprite, val=0: erode sprite
      const dst = new Uint8Array(N);
      for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
        const i = py * w + px; let hit = false;
        for (let dy = -R; dy <= R && !hit; dy++) for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const qx = px + dx, qy = py + dy;
          const v = (qx < 0 || qy < 0 || qx >= w || qy >= h) ? 0 : src[qy * w + qx];
          if (v === val) { hit = true; break; }
        }
        dst[i] = hit ? val : 1 - val;
      }
      return dst;
    };
    const closed = morph(morph(sp, 1), 0);
    // drop small islands: keep only components >= 400px
    const comp = new Int32Array(N).fill(-1); let nc = 0; const sizes = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (!closed[s0] || comp[s0] >= 0) continue;
      const st = [s0]; comp[s0] = nc; let sz = 0;
      while (st.length) { const i = st.pop(); sz++; const px = i % w, py = (i / w) | 0;
        for (const j of [i - 1, i + 1, i - w, i + w]) { if (j < 0 || j >= N) continue; if ((j === i - 1 && px === 0) || (j === i + 1 && px === w - 1)) continue; if (closed[j] && comp[j] < 0) { comp[j] = nc; st.push(j); } } }
      sizes.push(sz); nc++;
    }
    const big = Math.max(0, ...sizes); for (let i = 0; i < N; i++) mask[i] = (closed[i] && sizes[comp[i]] >= big * 0.25) ? 0 : 1;
    // erode 1px into the sprite then feather 2px
    const alpha = new Float32Array(N).fill(1);
    for (let i = 0; i < N; i++) if (mask[i]) alpha[i] = 0;
    const ER = (opts && opts.erode) == null ? 1 : opts.erode;
    for (let e = 0; e < ER; e++) { const cp = Float32Array.from(alpha); for (let py = 1; py < h - 1; py++) for (let px = 1; px < w - 1; px++) { const i = py * w + px; if (cp[i] && (!cp[i-1] || !cp[i+1] || !cp[i-w] || !cp[i+w])) alpha[i] = 0; } }
    a2 = new Float32Array(N);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const i = py * w + px;
      if (alpha[i] === 0) { a2[i] = 0; continue; }
      let bgNear = 0, cnt = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        cnt++; if (alpha[qy * w + qx] === 0) bgNear++;
      }
      a2[i] = bgNear === 0 ? 1 : Math.max(0, 1 - bgNear / cnt * 1.6);
    }
    }
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let i = 0; i < N; i++) {
      d[i * 4 + 3] = Math.round(a2[i] * 255);
      if (a2[i] > 0.05) { const px = i % w, py = (i / w) | 0; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
    }
    g.putImageData(id, 0, 0);
    const tw = maxX - minX + 1, th = maxY - minY + 1;
    const t = document.createElement('canvas'); t.width = tw; t.height = th;
    t.getContext('2d').drawImage(c, minX, minY, tw, th, 0, 0, tw, th);
    let fxs = 0, fn = 0;
    for (let py = Math.max(minY, maxY - Math.round(th * 0.12)); py <= maxY; py++) for (let px = minX; px <= maxX; px++) { if (a2[py * w + px] > 0.5) { fxs += px - minX; fn++; } }
    out[name] = { data: t.toDataURL('image/png'), w: tw, h: th, fx: fn ? Math.round(fxs / fn) : Math.round(tw / 2) };
  }
  return out;
}, PANELS);

const manifest = {};
for (const [name, r] of Object.entries(results)) {
  manifest[name] = { w: r.w, h: r.h, fx: r.fx };
  fs.writeFileSync(`${OUTDIR}/${name}.png`, Buffer.from(r.data.split(',')[1], 'base64'));
  console.log(name, r.w + 'x' + r.h);
}
fs.writeFileSync(`${OUTDIR}/manifest.json`, JSON.stringify(manifest, null, 1));
await browser.close();
