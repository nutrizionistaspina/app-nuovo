/* ============================================================ COMPOSIZIONE CORPOREA DALLE FOTO · NUCLEO COMUNE (app dei pazienti e NutriLab)
   Richiesta del Dottore (18/11/2026). Due foto in piedi, di fronte e di profilo: capelli raccolti, piedi uniti, vestiti aderenti,
   braccia un po' staccate nella foto di fronte e lungo il corpo, dentro la sagoma, in quella di profilo.
   - La sagoma si trova sul dispositivo con MediaPipe Pose (Google, licenza Apache 2.0): punti del corpo e maschera della persona.
     Le foto non escono mai dal dispositivo e si cancellano dopo il calcolo; resta solo il contorno della sagoma di profilo, senza volto
     né pelle, normalizzato sull'altezza, per confrontare le visite.
   - La scala viene dall'altezza: dalla cima della testa ai talloni. Vita (ombelico) e fianchi (punto più largo) si leggono dalla
     maschera come larghezza (di fronte) e profondità (di profilo); la circonferenza è un'ellisse (Ramanujan), corretta dalla taratura
     dello studio quando ci sono abbastanza misure con il metro.
   - Formule: RFM (Woolcott e Bergman 2018, validata sulla DXA, adulti), Navy (Hodgdon e Beckett 1984, solo con il collo al metro),
     vita/altezza, vita/fianchi. Sotto i 18 anni le percentuali non si calcolano (formule non validate).
   - Taratura: retta ai minimi quadrati tra la stima e il riferimento dello studio (metro, BIA), con errore medio stimato
     lasciando fuori una misura alla volta. Si usa da 10 coppie in su.
   Nessuna dipendenza: funziona nel browser (window.FC) e in Node per i test (module.exports). */
(function (root) {
  'use strict';
  const FC = { V: 1, MIN_CAL: 10 };
  const num = (x) => { const v = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(',', '.')); return isFinite(v) ? v : null; };
  FC.num = num;

  /* ---------------- formule */
  FC.ellipse = (W, D) => { if (!(W > 0 && D > 0)) return null; const a = W / 2, b = D / 2; return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); };
  /* RFM = 64 − 20 × altezza/vita + 12 × sesso (0 uomo, 1 donna) */
  FC.rfm = (h, w, sx) => (h > 0 && w > 0 && (sx === 'F' || sx === 'M')) ? 64 - 20 * h / w + (sx === 'F' ? 12 : 0) : null;
  /* Navy, centimetri: uomo con vita e collo, donna con vita, fianchi e collo */
  FC.navy = (sx, h, w, neck, hip) => { const L = Math.log10; if (!(h > 0 && w > 0 && neck > 0)) return null;
    if (sx === 'M') return w - neck > 0 ? 495 / (1.0324 - 0.19077 * L(w - neck) + 0.15456 * L(h)) - 450 : null;
    if (sx === 'F') return hip > 0 && w + hip - neck > 0 ? 495 / (1.29579 - 0.35004 * L(w + hip - neck) + 0.221 * L(h)) - 450 : null;
    return null; };
  const bfOk = (v) => (v != null && isFinite(v) ? Math.round(Math.max(3, Math.min(75, v)) * 10) / 10 : null);
  /* tutti gli indici da altezza, sesso, peso, età e circonferenze (cm) */
  FC.indices = (o) => { const h = num(o.h), w = num(o.wst), hp = num(o.hip), nk = num(o.neck), kg = num(o.kg), age = num(o.age), r = { warn: [] };
    if (w && h) r.whtr = Math.round(w / h * 100) / 100;
    if (w && hp) r.whr = Math.round(w / hp * 100) / 100;
    const adult = age == null || age >= 18; if (!adult) r.warn.push('minore');
    if (adult && w && h) r.rfm = bfOk(o.cal && o.cal.bf ? FC.cal(FC.rfm(h, w, o.sx), o.cal.bf) : FC.rfm(h, w, o.sx));
    if (adult && nk && w && h) r.navy = bfOk(FC.navy(o.sx, h, w, nk, hp));
    if (r.rfm != null && kg) { r.fmKg = Math.round(kg * r.rfm) / 100; r.ffmKg = Math.round((kg - kg * r.rfm / 100) * 10) / 10; }
    return r; };

  /* ---------------- taratura */
  const lsq = (P) => { const n = P.length; let sx = 0, sy = 0, sxx = 0, sxy = 0; for (const [x, y] of P) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const d = n * sxx - sx * sx; if (n < 2 || Math.abs(d) < 1e-9) return null; const b = (n * sxy - sx * sy) / d; return { a: (sy - b * sx) / n, b }; };
  FC.fit = (pairs) => { const P = (pairs || []).map((p) => [num(p[0]), num(p[1])]).filter((p) => p[0] != null && p[1] != null); const n = P.length; if (n < 3) return n ? { n } : null;
    const f = lsq(P); if (!f) return { n }; let raw = 0, fit = 0, ss = 0, st = 0, loo = 0, nl = 0; const my = P.reduce((s, p) => s + p[1], 0) / n;
    for (const [x, y] of P) { raw += Math.abs(y - x); const e = y - (f.a + f.b * x); fit += Math.abs(e); ss += e * e; st += (y - my) ** 2; }
    if (n >= 5) for (let i = 0; i < n; i++) { const g = lsq(P.filter((_, j) => j !== i)); if (g) { loo += Math.abs(P[i][1] - (g.a + g.b * P[i][0])); nl++; } }
    const r1 = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
    return { a: r1(f.a, 3), b: r1(f.b, 4), n, maeRaw: r1(raw / n, 2), mae: r1(fit / n, 2), maeLoo: nl ? r1(loo / nl, 2) : null, rmse: r1(Math.sqrt(ss / n), 2), r2: st ? r1(1 - ss / st, 3) : null }; };
  /* la retta corregge solo se ci sono abbastanza coppie e se lasciando fuori una misura alla volta sbaglia meno del valore grezzo */
  FC.calOk = (c) => !!(c && c.n >= FC.MIN_CAL && isFinite(c.a) && isFinite(c.b) && (c.maeLoo == null || c.maeRaw == null || c.maeLoo < c.maeRaw));
  FC.cal = (x, c) => (x != null && FC.calOk(c) ? c.a + c.b * x : x);

  /* ---------------- maschera e geometria (maschera: Uint8Array w×h, 1 = persona) */
  FC.biggest = (m, w, h) => { const lab = new Int32Array(w * h), st = new Int32Array(w * h); let best = 0, bestN = 0, id = 0;
    for (let i = 0; i < w * h; i++) { if (!m[i] || lab[i]) continue; id++; let top = 0, n = 0; st[top++] = i; lab[i] = id;
      while (top) { const j = st[--top]; n++; const x = j % w, y = (j - x) / w;
        if (x > 0 && m[j - 1] && !lab[j - 1]) { lab[j - 1] = id; st[top++] = j - 1; } if (x < w - 1 && m[j + 1] && !lab[j + 1]) { lab[j + 1] = id; st[top++] = j + 1; }
        if (y > 0 && m[j - w] && !lab[j - w]) { lab[j - w] = id; st[top++] = j - w; } if (y < h - 1 && m[j + w] && !lab[j + w]) { lab[j + w] = id; st[top++] = j + w; } }
      if (n > bestN) { bestN = n; best = id; } }
    const o = new Uint8Array(w * h); if (best) for (let i = 0; i < w * h; i++) o[i] = lab[i] === best ? 1 : 0; return { m: o, n: bestN }; };
  /* tratti pieni di una riga: [[x0, x1], ...] */
  FC.runs = (m, w, y) => { const r = []; let s = -1; const o = y * w; for (let x = 0; x < w; x++) { const v = m[o + x]; if (v && s < 0) s = x; if (!v && s >= 0) { r.push([s, x - 1]); s = -1; } } if (s >= 0) r.push([s, w - 1]); return r; };
  /* tratto che contiene il centro (o il più vicino) */
  FC.runAt = (m, w, y, cx) => { const R = FC.runs(m, w, Math.round(y)); if (!R.length) return null; let b = null, bd = 1e9;
    for (const r of R) { const d = cx >= r[0] && cx <= r[1] ? 0 : Math.min(Math.abs(cx - r[0]), Math.abs(cx - r[1])); if (d < bd) { bd = d; b = r; } } return b ? { x0: b[0], x1: b[1], n: R.length } : null; };
  FC.vbounds = (m, w, h) => { let top = -1, bot = -1; for (let y = 0; y < h && top < 0; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { top = y; break; }
    for (let y = h - 1; y >= 0 && bot < 0; y--) for (let x = 0; x < w; x++) if (m[y * w + x]) { bot = y; break; } return top < 0 ? null : { top, bot }; };
  const lmY = (lm, ids, h) => { const v = ids.map((i) => lm && lm[i]).filter((p) => p && (p.visibility == null || p.visibility > 0.3)); return v.length ? v.reduce((s, p) => s + p.y, 0) / v.length * h : null; };
  const lmX = (lm, ids, w) => { const v = ids.map((i) => lm && lm[i]).filter((p) => p && (p.visibility == null || p.visibility > 0.3)); return v.length ? v.reduce((s, p) => s + p.x, 0) / v.length * w : null; };
  /* profilo: guarda a destra se naso e punte dei piedi stanno a destra di orecchie e talloni */
  FC.facing = (lm) => { let v = 0; const nx = lmX(lm, [0], 1), ex = lmX(lm, [7, 8], 1), tx = lmX(lm, [31, 32], 1), hx = lmX(lm, [29, 30], 1);
    if (nx != null && ex != null) v += nx > ex ? 1 : -1; if (tx != null && hx != null) v += tx > hx ? 1 : -1; return v >= 0 ? 1 : -1; };
  /* proposta automatica: cima, talloni, vita (ombelico) e fianchi (punto più largo o più profondo) */
  FC.propose = (m, w, h, lm, view) => { const b = FC.vbounds(m, w, h); if (!b) return null; let top = b.top, bot = b.bot; const heel = lmY(lm, [29, 30, 31, 32], h);
    if (heel != null && Math.abs(heel - bot) > 0.04 * (bot - top)) bot = Math.round(Math.max(heel, Math.min(bot, heel + 0.03 * (bot - top))));
    const H = bot - top; if (H < 100) return null;
    const sh = lmY(lm, [11, 12], h), hp = lmY(lm, [23, 24], h); const floor = (f) => bot - f * H;
    let wy = sh != null && hp != null && hp > sh ? hp - 0.27 * (hp - sh) : floor(0.6); if (wy < top + 0.25 * H || wy > top + 0.55 * H) wy = floor(0.6);
    const hc = hp != null && hp > top + 0.35 * H && hp < top + 0.65 * H ? hp : floor(0.5);
    const cx = lmX(lm, view === 's' ? [11, 12, 23, 24] : [23, 24], w) ?? (() => { const r = FC.runs(m, w, Math.round(wy)); return r.length ? (r[0][0] + r[r.length - 1][1]) / 2 : w / 2; })();
    let hy = Math.round(hc), hbest = -1;
    for (let y = Math.round(hc - 0.02 * H); y <= Math.round(hc + 0.1 * H); y++) { const r = FC.runAt(m, w, y, cx); if (r && r.x1 - r.x0 > hbest) { hbest = r.x1 - r.x0; hy = y; } }
    const lv = {}; for (const [k, y] of [['waist', Math.round(wy)], ['hip', hy]]) { const r = FC.runAt(m, w, y, cx); lv[k] = r ? { y, x0: r.x0, x1: r.x1 } : { y, x0: Math.round(cx - 0.08 * H), x1: Math.round(cx + 0.08 * H) }; }
    const warn = []; const wr = lm && [15, 16].map((i) => lm[i]).filter((p) => p && (p.visibility == null || p.visibility > 0.5));
    if (view === 'f' && wr && wr.some((p) => { const x = p.x * w, y = p.y * h; return y > lv.waist.y - 0.08 * H && y < lv.hip.y + 0.05 * H && x > lv.waist.x0 - 4 && x < lv.waist.x1 + 4; })) warn.push('braccia');
    if (lv.waist.x1 - lv.waist.x0 > 0.45 * H) warn.push('vita');
    /* piedi uniti (di fronte): caviglie, o talloni, a più di un ottavo dell'altezza → gambe aperte e fianchi letti male */
    if (view === 'f' && lm) { const vis2 = (ids) => { const v = ids.map((i) => lm[i]).filter((p) => p && (p.visibility == null || p.visibility > 0.5)); return v.length === 2 ? v : null; };
      const pr = vis2([27, 28]) || vis2([29, 30]); if (pr && Math.abs(pr[0].x - pr[1].x) * w > 0.12 * H) warn.push('piedi'); }
    /* fianchi molto più larghi della vita: la linea è finita sulle gambe; si riporta all'altezza dell'anca */
    if (lv.hip.x1 - lv.hip.x0 > 1.9 * Math.max(1, lv.waist.x1 - lv.waist.x0)) { const r = FC.runAt(m, w, Math.round(hc), cx); if (r) lv.hip = { y: Math.round(hc), x0: r.x0, x1: r.x1 }; warn.push('fianchi'); }
    return { top, bot, cx: Math.round(cx), lv, warn, face: view === 's' ? FC.facing(lm) : 1 }; };
  /* misure in cm dal modello della foto (cima, talloni, livelli) e dall'altezza */
  FC.measure = (g, hcm) => { if (!g || !(hcm > 0)) return null; const H = g.bot - g.top; if (H < 50) return null; const k = hcm / H, o = { cmpx: k };
    for (const n of ['waist', 'hip']) { const l = g.lv[n]; if (l) o[n] = Math.round(Math.abs(l.x1 - l.x0) * k * 10) / 10; } return o; };
  /* circonferenze dalle due viste, con la taratura dello studio se c'è */
  FC.circ = (mf, ms, cal) => { if (!mf || !ms) return null; const o = {};
    for (const n of ['waist', 'hip']) { const e = FC.ellipse(mf[n], ms[n]); o[n + 'Raw'] = e != null ? Math.round(e * 10) / 10 : null; o[n] = e != null ? Math.round(FC.cal(e, cal && cal[n]) * 10) / 10 : null; }
    o.ok = o.waist != null && o.waist >= 45 && o.waist <= 200 && (o.hip == null || (o.hip >= 55 && o.hip <= 220)) && ms.waist / mf.waist > 0.35 && ms.waist / mf.waist < 1.6;
    return o; };

  /* ---------------- contorno della sagoma, semplificato e normalizzato: altezza 1000, talloni in x = 0, sempre rivolto a destra.
     Di profilo basta l'involucro riga per riga (bordo davanti e bordo dietro): niente buchi, niente volto. */
  FC.trace = (m, w, h) => { const L = [], R = []; for (let y = 0; y < h; y++) { let a = -1, b = -1; const o = y * w; for (let x = 0; x < w; x++) if (m[o + x]) { if (a < 0) a = x; b = x; }
      if (a >= 0) { L.push([a, y]); R.push([b + 1, y]); } } return L.length ? L.concat(R.reverse()) : []; };
  FC.simplify = (P, eps) => { if (P.length < 3) return P.slice(); const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1; const st = [[0, P.length - 1]];
    while (st.length) { const [a, b] = st.pop(); const [ax, ay] = P[a], [bx, by] = P[b], L = Math.hypot(bx - ax, by - ay) || 1; let md = -1, mi = -1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((by - ay) * P[i][0] - (bx - ax) * P[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
      if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
    return P.filter((_, i) => keep[i]); };
  FC.silhouette = (m, w, h, g, lm) => { if (!g) return null; const B = FC.biggest(m, w, h), P = FC.trace(B.m, w, h); if (P.length < 20) return null; const H = g.bot - g.top; if (H < 100) return null;
    const S = FC.simplify(P, Math.max(1.5, H / 400)), s = 1000 / H, face = g.face || 1; const hx = lmX(lm, [29, 30], w);
    let ax = hx; if (ax == null) { const r = FC.runs(B.m, w, Math.min(h - 1, g.bot - 2)); ax = r.length ? (face > 0 ? r[0][0] : r[r.length - 1][1]) : g.cx; }
    const out = []; for (const [x, y] of S) { out.push(Math.round((x - ax) * s * face), Math.round((y - g.top) * s)); } return { v: 1, p: out }; };
  /* due sagome (la vecchia in grigio, la nuova con la linea rossa) in un SVG */
  FC.overlaySvg = (prev, cur, o) => { o = o || {}; const polys = [prev, cur].filter((x) => x && x.p && x.p.length >= 6); if (!polys.length) return '';
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const q of polys) for (let i = 0; i < q.p.length; i += 2) { x0 = Math.min(x0, q.p[i]); x1 = Math.max(x1, q.p[i]); y0 = Math.min(y0, q.p[i + 1]); y1 = Math.max(y1, q.p[i + 1]); }
    const pad = 30, vb = `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`, pts = (q) => { let s = ''; for (let i = 0; i < q.p.length; i += 2) s += (i ? ' ' : '') + q.p[i] + ',' + q.p[i + 1]; return s; };
    const lab = o.label ? ` aria-label="${String(o.label).replace(/"/g, '&quot;')}"` : '';
    return `<svg class="fcsvg" viewBox="${vb}" role="img"${lab} preserveAspectRatio="xMidYMid meet">${prev && prev.p ? `<polygon points="${pts(prev)}" fill="${o.prevFill || '#d9d4cc'}" stroke="${o.prevStroke || '#9a958d'}" stroke-width="3" stroke-linejoin="round"/>` : ''}${cur && cur.p ? `<polygon points="${pts(cur)}" fill="none" stroke="${o.curStroke || '#d0342c'}" stroke-width="5" stroke-linejoin="round"/>` : ''}</svg>`; };

  /* ---------------- browser: maschera da MediaPipe, caricamento del modello, editor delle linee */
  FC.maskFromImage = (src, w, h, thr) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data; let aSum = 0; for (let i = 3; i < d.length; i += 4 * 97) aSum += d[i]; const useA = aSum / Math.ceil(d.length / (4 * 97)) < 250; const m = new Uint8Array(w * h), t = (thr ?? 0.5) * 255;
    for (let i = 0, j = 0; j < m.length; i += 4, j++) m[j] = (useA ? d[i + 3] : d[i]) > t ? 1 : 0; return FC.biggest(m, w, h).m; };
  /* indirizzo del modello: una cartella ('vendor/mp-pose/') oppure { u: cartella, map: nomi rinominati } quando chi pubblica
     non serve i file binari con il loro nome (per esempio .data, .tflite e .binarypb pubblicati con un nome .wasm) */
  FC.RENAME = { 'pose_solution_packed_assets.data': 'pose_solution_packed_assets.data.wasm', 'pose_landmark_full.tflite': 'pose_landmark_full.tflite.wasm', 'pose_web.binarypb': 'pose_web.binarypb.wasm' };
  const loc = (b) => (f) => (typeof b === 'string' ? b : b.u) + ((b && b.map && b.map[f]) || f);
  let poseP = null;
  FC.loadPose = (base) => { if (poseP) return poseP; poseP = new Promise((res, rej) => { const mk = () => { try { const p = new root.Pose({ locateFile: loc(base) });
      p.setOptions({ modelComplexity: 1, smoothLandmarks: false, enableSegmentation: true, smoothSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }); res(p); } catch (e) { rej(e); } };
    if (root.Pose) return mk(); const s = document.createElement('script'); s.src = loc(base)('pose.js'); s.crossOrigin = 'anonymous'; s.onload = mk; s.onerror = () => rej(new Error('pose_load')); document.head.appendChild(s); });
    poseP.catch(() => { poseP = null; }); return poseP; };
  /* un'immagine (canvas) → { lm, m, w, h }; la maschera è alla risoluzione dell'immagine */
  let poseOk = false;
  FC.detect = async (base, cv) => { const p = await FC.loadPose(base); try { p.reset && p.reset(); } catch (e) { /* niente */ }
    let r; try { r = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), poseOk ? 30000 : 120000); p.onResults((x) => { clearTimeout(t); res(x); }); p.send({ image: cv }).catch((e) => { clearTimeout(t); rej(e); }); }); }
    catch (e) { if (!poseOk) poseP = null; throw e; }
    poseOk = true; if (!r || !r.segmentationMask) return null; const w = cv.width, h = cv.height; return { lm: r.poseLandmarks || null, m: FC.maskFromImage(r.segmentationMask, w, h), w, h }; };
  /* prova più indirizzi del modello (copia dello stesso sito, poi CDN) e usa il primo che risponde */
  let poseBase = null;
  FC.detectAny = async (bases, cv) => { let err = null; for (const b of poseBase ? [poseBase] : bases) { try { const d = await FC.detect(b, cv); poseBase = b; return d; } catch (e) { err = e; } } throw err || new Error('pose'); };
  /* foto (file o dataURL) → canvas ridotto a 1280 px sul lato lungo */
  FC.toCanvas = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const s = Math.min(1, 1280 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
      cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); res(cv); }; im.onerror = () => rej(new Error('img')); im.src = src; });
  /* editor: foto, contorno della maschera, cima e talloni (verde), vita (rossa), fianchi (blu); si trascinano le linee e i bordi */
  FC.editor = (host, o) => { const cv = document.createElement('canvas'); cv.className = 'fced'; host.innerHTML = ''; host.appendChild(cv);
    const E = { g: o.g, img: o.img, m: o.m, w: o.img.width, h: o.img.height, drag: null };
    const fit = () => { const W = Math.min(host.clientWidth || 320, o.max || 520); cv.width = W; cv.height = Math.round(W * E.h / E.w); E.s = W / E.w; };
    const draw = () => { const g = cv.getContext('2d'), s = E.s, G = E.g; g.clearRect(0, 0, cv.width, cv.height); g.globalAlpha = 0.75; g.drawImage(E.img, 0, 0, cv.width, cv.height); g.globalAlpha = 1;
      if (!G) return; const hl = (y, c) => { g.strokeStyle = c; g.setLineDash([6, 4]); g.lineWidth = 2; g.beginPath(); g.moveTo(0, y * s); g.lineTo(cv.width, y * s); g.stroke(); g.setLineDash([]); };
      hl(G.top, '#2f7d5b'); hl(G.bot, '#2f7d5b');
      for (const [k, c] of [['waist', '#d0342c'], ['hip', '#2f5fa8']]) { const l = G.lv[k]; if (!l) continue; g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.moveTo(l.x0 * s, l.y * s); g.lineTo(l.x1 * s, l.y * s); g.stroke();
        for (const x of [l.x0, l.x1]) { g.fillStyle = c; g.beginPath(); g.arc(x * s, l.y * s, 7, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
        g.fillStyle = c; g.fillRect((l.x0 + l.x1) / 2 * s - 6, l.y * s - 6, 12, 12); } };
    const hit = (px, py) => { const G = E.g, s = E.s, r = 16; if (!G) return null; for (const k of ['waist', 'hip']) { const l = G.lv[k]; if (!l) continue;
        if (Math.hypot(px - l.x0 * s, py - l.y * s) < r) return { k, p: 'x0' }; if (Math.hypot(px - l.x1 * s, py - l.y * s) < r) return { k, p: 'x1' };
        if (Math.abs(py - l.y * s) < r && px > Math.min(l.x0, l.x1) * s - r && px < Math.max(l.x0, l.x1) * s + r) return { k, p: 'y' }; }
      if (Math.abs(py - G.top * s) < r) return { k: 'top' }; if (Math.abs(py - G.bot * s) < r) return { k: 'bot' }; return null; };
    const pos = (e) => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * cv.width / b.width, (e.clientY - b.top) * cv.height / b.height]; };
    cv.addEventListener('pointerdown', (e) => { const [x, y] = pos(e); E.drag = hit(x, y); if (E.drag) { cv.setPointerCapture(e.pointerId); e.preventDefault(); } });
    cv.addEventListener('pointermove', (e) => { if (!E.drag) return; const [x, y] = pos(e), G = E.g, X = Math.round(x / E.s), Y = Math.max(0, Math.min(E.h - 1, Math.round(y / E.s))), d = E.drag;
      if (d.k === 'top') G.top = Math.min(Y, G.bot - 50); else if (d.k === 'bot') G.bot = Math.max(Y, G.top + 50);
      else { const l = G.lv[d.k]; if (d.p === 'y') { l.y = Y; const r = E.m ? FC.runAt(E.m, E.w, Y, (l.x0 + l.x1) / 2) : null; if (r && !l.man) { l.x0 = r.x0; l.x1 = r.x1; } } else { l[d.p] = Math.max(0, Math.min(E.w - 1, X)); l.man = true; } }
      draw(); o.onChange && o.onChange(G); e.preventDefault(); });
    const end = () => { if (E.drag) { E.drag = null; o.onChange && o.onChange(E.g, true); } }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.style.touchAction = 'none'; fit(); draw(); E.redraw = () => { fit(); draw(); }; return E; };
  /* modello manuale quando la sagoma non si trova: linee a metà, da trascinare */
  FC.manual = (w, h) => { const top = Math.round(h * 0.08), bot = Math.round(h * 0.92), H = bot - top, cx = Math.round(w / 2);
    return { top, bot, cx, lv: { waist: { y: Math.round(bot - 0.6 * H), x0: Math.round(cx - 0.09 * H), x1: Math.round(cx + 0.09 * H), man: true }, hip: { y: Math.round(bot - 0.5 * H), x0: Math.round(cx - 0.1 * H), x1: Math.round(cx + 0.1 * H), man: true } }, warn: ['manuale'], face: 1 }; };
  FC.WARN = { braccia: 'Le braccia sembrano attaccate ai fianchi: staccale un po\' nella foto di fronte.', vita: 'La vita trovata è troppo larga: controlla la linea rossa.', piedi: 'Tieni i piedi uniti: con le gambe aperte i fianchi si leggono male. Rifai la foto di fronte.', fianchi: 'La linea blu dei fianchi era sulle gambe: l\'ho riportata sul bacino, controllala.', manuale: 'Non ho trovato la sagoma: sposta tu le linee sui bordi del corpo.', minore: 'Sotto i 18 anni la percentuale di grasso non si calcola: le formule non sono validate.' };
  FC.TIPS = 'Vestiti aderenti, capelli raccolti, piedi uniti. Di fronte: braccia un po\' staccate dal corpo. Di profilo: braccia lungo il corpo, dentro la sagoma. Sfondo chiaro, telefono in verticale all\'altezza della pancia, a 2-3 metri, tutto il corpo nella foto.';

  if (typeof module === 'object' && module.exports) module.exports = FC; else root.FC = FC;
})(typeof window !== 'undefined' ? window : globalThis);
