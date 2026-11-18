/* ============================================================ APP DEI PAZIENTI · COMPOSIZIONE CORPOREA DALLE FOTO E ALIMENTAZIONE DAI TRACKER
   Richieste del Dottore (26/10/2026 e 18/11/2026). Compare solo se il Dottore la attiva per il paziente in NutriLab (pacchetto: hd.foto, hd.nut).
   - Con il metro: altezza e vita danno l'RFM (Woolcott e Bergman 2018, validata sulla DXA).
   - Dalla foto: due foto in piedi, di fronte e di profilo, con capelli raccolti, piedi uniti, braccia un po' staccate nella foto di fronte
     e lungo il corpo, dentro la sagoma, in quella di profilo. La sagoma si trova sul telefono con MediaPipe Pose (vendor/mp-pose,
     Google, Apache 2.0) e il nucleo comune fotocomp.js: linee di vita (ombelico) e fianchi (punto più largo) da controllare e trascinare,
     circonferenze come ellisse, corrette dalla taratura dello studio (hd.fcal: foto → metro, RFM → BIA) quando il Dottore la attiva.
   - Le foto non escono dal telefono e si cancellano dopo il calcolo. Resta solo il contorno della sagoma di profilo, sul telefono, per
     vedere le differenze tra una volta e l'altra: in grigio la precedente, linea rossa la nuova, insieme alle sagome delle visite in studio
     (hd.fsil). Al Dottore vanno solo vita e percentuale, se il paziente sceglie di inviarle. Sotto i 18 anni NutriLab manda l'età (hd.fage):
     RFM dai 15 anni, formula pediatrica tra 8 e 14, niente percentuale sotto gli 8, taratura sulla BIA solo per gli adulti.
     Nell'app non compaiono fonti né nomi di formule.
   - Alimentazione dai tracker: media giornaliera di energia, proteine, carboidrati, grassi, fibre e acqua letta dall'app che il paziente
     usa per registrare i pasti (anche tramite l'app Salute), insieme ai dati della settimana. */
'use strict';
const FB = { mode: 'metro', img: { f: null, s: null }, det: { f: null, s: null }, g: { f: null, s: null }, busy: { f: '', s: '' }, cam: null, res: null, err: '', msg: '', sending: false, h: '', sx: '', w: '', open: false, cmp: { a: '', b: '' }, kept: false, mem: [] };
const FB_MP = ['vendor/mp-pose/'];
const fbNum = (x) => FC.num(x);
const fbOn = () => !!(A.P?.hd?.foto) && typeof FC === 'object';
const nutOn = () => !!(A.P?.hd?.nut);
const fbAge = () => { const a = fbNum(A.P?.hd?.fage); return a != null && a >= 0 && a < 18 ? a : null; };
const fbCal = () => { const c = A.P?.hd?.fcal; return c && typeof c === 'object' ? c : null; };
const fbFd = (s) => { try { return new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return s; } };
const fbN = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('it-IT', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));
/* ---- sagome salvate sul telefono (solo il contorno, mai la foto) */
const fbKey = () => 'nlp_fsil_' + (SID() || 'x');
function fbLocal() { if (A.P?.demo) return FB.mem; try { const a = JSON.parse(LS.get(fbKey()) || '[]'); return Array.isArray(a) ? a.filter((e) => e && e.p && e.p.length >= 6) : []; } catch (e) { return []; } }
function fbLocalPut(L) { if (A.P?.demo) { FB.mem = L.slice(-12); return; } LS.set(fbKey(), JSON.stringify(L.slice(-12))); }
function fbAll() { const S0 = (A.P?.hd?.fsil || []).filter((e) => e && e.p && e.p.length >= 6).map((e, i) => ({ ...e, id: 's' + i + '_' + e.d, src: 'studio' }));
  return S0.concat(fbLocal().map((e) => ({ ...e, src: 'casa' }))).sort((a, b) => String(a.at || a.d).localeCompare(String(b.at || b.d))); }
/* ---- calcolo */
function fbCheck() { const hcm = fbNum(FB.h), sx = FB.sx; if (!hcm || hcm < 120 || hcm > 220) return 'Scrivi l\'altezza in centimetri.'; if (sx !== 'F' && sx !== 'M') return 'Scegli il sesso per il calcolo.'; return ''; }
function fbMetro() { FB.err = fbCheck(); FB.res = null; if (FB.err) return; const w = fbNum(FB.w); if (!w || w < 50 || w > 180) { FB.err = 'Scrivi la circonferenza della vita in centimetri (50-180).'; return; }
  const I = FC.indices({ h: fbNum(FB.h), sx: FB.sx, wst: w, age: fbAge(), cal: fbCal() && fbCal().bf ? { bf: fbCal().bf } : null });
  FB.res = { how: 'metro', w: Math.round(w * 10) / 10, bf: I.rfm ?? null, at: new Date().toISOString() }; }
function fbFoto() { FB.res = null; if (!FB.g.f || !FB.g.s) return; FB.err = fbCheck(); if (FB.err) return; const hcm = fbNum(FB.h), c = fbCal();
  const mf = FC.measure(FB.g.f, hcm), ms = FC.measure(FB.g.s, hcm), C = FC.circ(mf, ms, c ? { waist: c.waist, hip: c.hip } : null);
  if (!C || !C.ok) { FB.err = 'Le misure non tornano: controlla che le linee rossa e blu tocchino i bordi del corpo nelle due foto.'; return; }
  const I = FC.indices({ h: hcm, sx: FB.sx, wst: C.waist, hip: C.hip, age: fbAge(), cal: c && c.bf ? { bf: c.bf } : null });
  FB.res = { how: 'foto', w: C.waist, hp: C.hip, bf: I.rfm ?? null, cal: !!(c && (FC.calOk(c.waist) || FC.calOk(c.hip))), at: new Date().toISOString() }; }
/* foto (canvas) → sagoma sul telefono; se il modello non parte, linee a mano */
async function fbDetect(k, cv) { FB.img[k] = cv; FB.det[k] = null; FB.g[k] = null; FB.res = null; FB.err = ''; FB.msg = ''; FB.kept = false;
  FB.busy[k] = 'Cerco la sagoma… la prima volta scarica il modello (circa 12 MB): meglio con il Wi-Fi.'; render();
  let det = null; try { det = await FC.detectAny(FB_MP, cv); } catch (e) { console.warn('mediapipe', e); }
  if (FB.img[k] !== cv) return; /* foto cambiata nel frattempo */
  const g = det && det.m ? FC.propose(det.m, det.w, det.h, det.lm, k) : null; FB.det[k] = g ? det : null; FB.g[k] = g || FC.manual(cv.width, cv.height); FB.busy[k] = '';
  fbFoto(); render(); }
function fbForget() { FB.img = { f: null, s: null }; FB.det = { f: null, s: null }; FB.g = { f: null, s: null }; FB.busy = { f: '', s: '' }; }
/* salva il contorno del profilo e i numeri sul telefono, poi cancella le foto */
function fbKeep() { const r = FB.res; if (!r) return; let sil = null; try { const d = FB.det.s; if (d && d.m) sil = FC.silhouette(d.m, d.w, d.h, FB.g.s, d.lm); } catch (e) { console.warn('sagoma', e); }
  if (sil) { const L = fbLocal(), id = 'c' + Date.now().toString(36); L.push({ id, d: addDays(0), at: r.at, p: sil.p, w: r.w, hp: r.hp, bf: r.bf }); fbLocalPut(L); FB.cmp = { a: '', b: 'casa:' + id }; }
  FB.kept = true; fbForget(); FB.msg = sil ? 'Foto cancellate. Sul telefono resta solo il contorno del profilo, per il confronto.' : 'Foto cancellate. Il contorno del profilo non si è potuto salvare (sagoma non trovata).'; }
/* ---- scheda */
function fbShot(k, l) { const w = FB.g[k]?.warn || [];
  return `<div class="fbshot"><b>${l}</b>${FB.busy[k] ? `<p class="small muted">${esc(FB.busy[k])}</p>` : FB.img[k] ? `<div class="fbed" data-fbed="${k}"></div>${w.map((x) => `<div class="alert small">${esc(FC.WARN[x] || x)}</div>`).join('')}
    <p class="small muted">Verdi: cima della testa e talloni. Rossa: vita all'ombelico. Blu: fianchi nel punto più largo. Se serve, trascina le linee e i pallini sui bordi del corpo.</p>
    <div class="row"><button class="btn sm" data-fb="cam" data-k="${k}">Rifai la foto</button><label class="btn sm filebtn">Scegli un'altra<input type="file" accept="image/*" data-fbfile="${k}" hidden></label></div>`
    : `<div class="row"><button class="btn sm primary" data-fb="cam" data-k="${k}">Scatta la foto</button><label class="btn sm filebtn">Scegli una foto<input type="file" accept="image/*" data-fbfile="${k}" hidden></label></div>`}</div>`; }
function fbCmp() { const L = fbAll(); if (!L.length) return ''; const key = (e) => e.src + ':' + (e.src === 'casa' ? e.id : e.id);
  const b = L.find((e) => key(e) === FB.cmp.b) || L[L.length - 1], a = L.find((e) => key(e) === FB.cmp.a && key(e) !== key(b)) || L.slice().reverse().find((e) => key(e) !== key(b) && String(e.at || e.d) <= String(b.at || b.d)) || L.find((e) => key(e) !== key(b)) || null;
  const lab = (e) => `${fbFd(e.d)} · ${e.src === 'studio' ? 'in studio' : 'a casa'}`, opt = (sel, nm) => `<select data-fbcmp="${nm}" aria-label="${nm === 'a' ? 'Sagoma in grigio' : 'Sagoma con la linea rossa'}">${L.map((e) => `<option value="${esc(key(e))}"${key(e) === key(sel) ? ' selected' : ''}>${esc(lab(e))}</option>`).join('')}</select>`;
  const dv = (k, u, d) => (a && a[k] != null && b[k] != null ? `<li>${k === 'w' ? 'Vita' : k === 'hp' ? 'Fianchi' : 'Massa grassa'}: ${fbN(a[k], d)} → ${fbN(b[k], d)} ${u} (${b[k] - a[k] > 0 ? '+' : ''}${fbN(b[k] - a[k], d)})</li>` : '');
  const diffs = [dv('w', 'cm', 1), dv('hp', 'cm', 1), dv('bf', 'punti', 1)].join('');
  return `<div class="fbcmp"><b>Le tue sagome di profilo</b><div class="fbsvg">${FC.overlaySvg(a, b, { label: 'Confronto tra due sagome di profilo' })}</div>
    ${a ? `<p class="small">In grigio ${opt(a, 'a')}</p><p class="small">Linea rossa ${opt(b, 'b')}</p><p class="small muted">Dove la linea rossa sta dentro il grigio, il profilo si è ridotto; dove esce, è cresciuto. Le sagome sono messe alla stessa altezza.</p>${diffs ? `<ul class="small">${diffs}</ul>` : ''}`
      : `<p class="small muted">Sagoma del ${esc(lab(b))}: il confronto compare dalla seconda.</p>`}</div>`; }
function fbCard() { if (!fbOn()) return ''; const r = FB.res, age = fbAge(), sxRadio = (v, l) => `<label class="check" style="display:inline-flex;margin-right:14px"><input type="radio" name="fbsx" data-fbsx="${v}"${FB.sx === v ? ' checked' : ''}> ${l}</label>`;
  const anyImg = FB.img.f || FB.img.s;
  return `<details class="card fbcard"${FB.open ? ' open' : ''} data-fbdet><summary><b>Composizione corporea</b> <small class="muted">facoltativa</small></summary>
   <p class="small muted">Con altezza e vita si ottiene una stima della massa grassa; dalle foto anche i fianchi e la sagoma di profilo da confrontare nel tempo. È indicativa: non sostituisce le misure in studio.</p>
   <label class="hdf"><span>Altezza</span><span><input inputmode="decimal" data-fbh value="${esc(FB.h)}" placeholder="165"> <small>cm</small></span></label>
   <div style="margin:6px 0">${sxRadio('F', 'Donna')}${sxRadio('M', 'Uomo')}</div>
   <div class="seg" role="group" aria-label="Come misuri la vita"><button class="btn sm${FB.mode === 'metro' ? ' primary' : ''}" data-fb="mode" data-v="metro" aria-pressed="${FB.mode === 'metro'}">Con il metro</button><button class="btn sm${FB.mode === 'foto' ? ' primary' : ''}" data-fb="mode" data-v="foto" aria-pressed="${FB.mode === 'foto'}">Dalle foto</button></div>
   ${FB.mode === 'metro' ? `<p class="small muted">In piedi, a fine espirazione, metro orizzontale appena sopra le ossa del bacino (all'altezza dell'ombelico se non le senti).</p><label class="hdf"><span>Vita</span><span><input inputmode="decimal" data-fbw value="${esc(FB.w)}" placeholder="85"> <small>cm</small></span></label><div class="row"><button class="btn primary" data-fb="calc">Calcola</button></div>`
    : `<p class="small muted">${esc(FC.TIPS)} Le foto restano solo qui e si cancellano dopo il calcolo: sul telefono resta il contorno del profilo, senza volto.</p>${fbShot('f', 'Di fronte')}${fbShot('s', 'Di profilo')}`}
   ${age != null && age < 15 ? `<p class="small muted">${esc(FC.WARN[age < 8 ? 'minore' : 'ped'])}</p>` : ''}
   ${FB.err ? `<div class="alert" role="alert">${esc(FB.err)}</div>` : ''}
   ${r ? `<div class="fbres"><div><small>Vita ${r.how === 'foto' ? 'stimata' : 'misurata'}</small><b>${fbN(r.w, r.how === 'foto' ? 0 : 1)} cm</b></div>${r.hp != null ? `<div><small>Fianchi stimati</small><b>${fbN(r.hp)} cm</b></div>` : ''}${r.bf != null ? `<div><small>Massa grassa stimata</small><b>${fbN(r.bf, 1)}%</b></div>` : ''}</div>
     <p class="small muted">${r.how === 'foto' ? `Dalle foto l'errore può essere di qualche centimetro su vita e fianchi${r.cal ? ', già corretto con le misure dello studio' : ''}.` : 'La formula ha un margine di alcuni punti percentuali anche con la vita misurata bene.'} Il Dottore la confronterà con le misure dello studio.</p>
     <div class="row">${r.how === 'foto' && anyImg ? `<button class="btn primary" data-fb="keep">Salva il profilo e cancella le foto</button>` : ''}<button class="btn" data-fb="send"${FB.sending ? ' disabled' : ''}>${FB.sending ? 'Invio…' : 'Invia al Dottore'}</button></div>`
    : anyImg ? `<div class="row"><button class="btn sm" data-fb="clear">Cancella le foto</button></div>` : ''}
   ${FB.msg ? `<p class="small"><b>${esc(FB.msg)}</b></p>` : ''}
   ${fbCmp()}</details>`; }
/* ---- fotocamera con sagoma */
const FB_SIL = { f: '<svg viewBox="0 0 100 220" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="4 3" opacity=".9"><circle cx="50" cy="18" r="12"/><path d="M38 34h24l8 10 6 46-6 2-6-38v34l4 60-3 64H55l-5-58-5 58h-9l-3-64 4-60V54l-6 38-6-2 6-46z"/><line x1="10" y1="96" x2="90" y2="96" stroke-dasharray="2 4"/></g></svg>',
  s: '<svg viewBox="0 0 100 220" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="4 3" opacity=".9"><circle cx="50" cy="18" r="12"/><path d="M44 32h12l6 16 4 40-4 10 2 56-2 60h-10l-2-58-4-58-6-10 2-40z"/><line x1="10" y1="96" x2="90" y2="96" stroke-dasharray="2 4"/></g></svg>' };
async function fbCam(k) { FB.err = ''; let st = null;
  try { st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1920 } }, audio: false }); }
  catch (e) { FB.err = 'Fotocamera non disponibile: usa «Scegli una foto».'; return render(); }
  const ov = document.createElement('div'); ov.className = 'fbcam'; ov.innerHTML = `<video playsinline muted autoplay></video><div class="fbsil">${FB_SIL[k]}</div><p class="fbcamt">${k === 'f' ? 'Di fronte: piedi uniti, braccia un po\' staccate' : 'Di profilo: piedi uniti, braccia lungo il corpo'}. Capelli raccolti, testa e piedi dentro il riquadro.</p><div class="fbcamb"><button class="btn" data-fbc="x">Annulla</button><button class="btn primary" data-fbc="t">Scatta tra 5 secondi</button><button class="btn" data-fbc="n">Scatta ora</button></div>`;
  document.body.appendChild(ov); const v = ov.querySelector('video'); v.srcObject = st; FB.cam = { st, ov, k, v };
  try { await v.play(); } catch (e) { /* parte al tocco */ } }
function fbCamClose() { const c = FB.cam; if (!c) return; c.st.getTracks().forEach((t) => t.stop()); c.ov.remove(); FB.cam = null; }
async function fbShoot() { const c = FB.cam; if (!c) return; const v = c.v, k = c.k, cv = document.createElement('canvas'); cv.width = v.videoWidth || 720; cv.height = v.videoHeight || 1280; cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
  fbCamClose(); let x = cv; try { x = await FC.toCanvas(cv.toDataURL('image/jpeg', 0.9)); } catch (e) { /* tiene quella intera */ } fbDetect(k, x); }
/* editor delle linee dopo ogni render */
function fbMount() { document.querySelectorAll('[data-fbed]').forEach((host) => { const k = host.dataset.fbed, cv = FB.img[k], g = FB.g[k]; if (!cv || !g) return;
    FC.editor(host, { img: cv, g, m: FB.det[k]?.m, onChange: (_, end) => { if (end) { fbFoto(); render(); } } }); }); }
async function fbSend() { const r = FB.res; if (!r) return; if (A.P.demo) { FB.msg = 'Nell\'esempio i dati non partono.'; return render(); }
  FB.sending = true; FB.msg = ''; render(); const pl = { from: addDays(0), to: addDays(0), src: r.how === 'foto' ? 'foto' : 'metro', wst: Math.round(r.w) }; if (r.bf != null) pl.bfr = r.bf;
  try { await rpc('nl_app_data_add', { p_id: SID(), p_tok: A.P.tok, p_kind: 'salute', p_payload: pl }); FB.msg = 'Inviata al Dottore. Grazie!'; }
  catch (e) { FB.msg = /empty|invalid/.test(e.message) ? 'Il Dottore non ha ancora attivato la ricezione di questi dati: mostrala alla prossima visita.' : /too_many/.test(e.message) ? 'Hai già inviato molti dati oggi: riprova domani.' : 'Non riesco a collegarmi: riprova.'; }
  FB.sending = false; render(); }
/* ---- alimentazione dai tracker, dentro «La tua settimana» */
const NUT_F = [['kin', 'Energia assunta', 'kcal al giorno', '1800'], ['pro', 'Proteine', 'g al giorno', '80'], ['cho', 'Carboidrati', 'g al giorno', '200'], ['fat', 'Grassi', 'g al giorno', '60'], ['fib', 'Fibre', 'g al giorno', '25'], ['h2o', 'Acqua', 'litri al giorno', '1,5']];
function nutBlock() { const f = HD.f; return `<details class="nutblk"${NUT_F.some(([k]) => f[k]) ? ' open' : ''}><summary><b>Alimentazione registrata</b> <small class="muted">se usi un'app per i pasti (anche dall'app Salute)</small></summary><p class="small muted">Media al giorno della settimana, come la mostra la tua app. Lascia vuoto quello che non c'è.</p>
  ${NUT_F.map(([k, l, u, ph]) => `<label class="hdf"><span>${l}</span><span><input inputmode="decimal" data-hd="${k}" value="${esc(f[k] ?? '')}" placeholder="${ph}"> <small>${u}</small></span></label>`).join('')}</details>`; }
{ const _s = scrSalute; scrSalute = function () { let h = _s.apply(this, arguments);
    if (nutOn()) { const c = h.indexOf('<label class="check"><input type="checkbox" id="hdok">'), m = h.indexOf('<div class="row"><button class="btn primary" data-hdsend'), at = c >= 0 && (m < 0 || c < m) ? c : m; if (at >= 0) h = h.slice(0, at) + nutBlock() + h.slice(at); }
    try { if (!FB.h && A.P?.hd?.hcm) FB.h = String(A.P.hd.hcm); if (!FB.sx && /^[FM]$/.test(A.P?.hd?.sx || '')) FB.sx = A.P.hd.sx; } catch (e) { /* niente */ }
    return h + fbCard(); }; }
{ const _r = render; render = function () { const r = _r.apply(this, arguments); try { if (document.querySelector('[data-fbed]')) requestAnimationFrame(fbMount); } catch (e) { /* niente */ } return r; }; }
document.addEventListener('click', (e) => { const c = e.target.closest('[data-fbc]'); if (c) { e.preventDefault(); const k = c.dataset.fbc; if (k === 'x') return fbCamClose(); if (k === 'n') return fbShoot();
    if (k === 't') { let n = 5; c.disabled = true; const t = setInterval(() => { n--; c.textContent = n > 0 ? `Scatto tra ${n}…` : 'Scatto'; if (n <= 0) { clearInterval(t); fbShoot(); } }, 1000); } return; }
  const b = e.target.closest('[data-fb]'); if (!b) return; e.preventDefault(); const k = b.dataset.fb; FB.open = true;
  if (k === 'mode') { FB.mode = b.dataset.v; FB.err = ''; FB.res = null; FB.msg = ''; if (FB.mode === 'foto') fbFoto(); return render(); }
  if (k === 'cam') return fbCam(b.dataset.k);
  if (k === 'calc') { fbMetro(); return render(); }
  if (k === 'keep') { fbKeep(); return render(); }
  if (k === 'clear') { fbForget(); FB.res = null; FB.err = ''; FB.msg = 'Foto cancellate.'; return render(); }
  if (k === 'send') return fbSend(); }, true);
document.addEventListener('toggle', (e) => { if (e.target?.matches?.('[data-fbdet]')) FB.open = e.target.open; }, true);
document.addEventListener('input', (e) => { const t = e.target; if (t.hasAttribute?.('data-fbh')) FB.h = t.value; else if (t.hasAttribute?.('data-fbw')) FB.w = t.value; }, true);
document.addEventListener('change', (e) => { const t = e.target;
  if (t.dataset?.fbsx) { FB.sx = t.dataset.fbsx; if (FB.mode === 'foto' && FB.g.f && FB.g.s) { fbFoto(); render(); } return; }
  if (t.hasAttribute?.('data-fbh')) { FB.h = t.value; if (FB.mode === 'foto' && FB.g.f && FB.g.s) { fbFoto(); render(); } return; }
  if (t.dataset?.fbcmp) { FB.cmp[t.dataset.fbcmp] = t.value; return render(); }
  if (t.dataset?.fbfile) { const k = t.dataset.fbfile, f = t.files?.[0]; if (!f) return; FB.open = true; const rd = new FileReader();
    rd.onload = async () => { try { fbDetect(k, await FC.toCanvas(rd.result)); } catch (x) { FB.err = 'Non riesco a leggere la foto: provane un\'altra.'; render(); } }; rd.readAsDataURL(f); } }, true);
document.head.insertAdjacentHTML('beforeend', `<style>.fbcard summary{cursor:pointer}.fbshot{margin:10px 0;padding:10px;border-radius:12px;background:var(--surface-2,#f3eee6);display:flex;flex-direction:column;gap:8px}.fbshot b{display:block}
.fbed .fced{display:block;width:100%;max-width:520px;border-radius:10px;touch-action:none;cursor:grab}
.fbres{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}.fbres div{background:var(--surface-2,#f3eee6);border-radius:12px;padding:10px}.fbres small{display:block;color:var(--muted,#6b6b6b)}.fbres b{font:400 26px/1.1 Georgia,serif}
.fbcmp{margin-top:12px;display:flex;flex-direction:column;gap:6px}.fbsvg{max-width:260px}.fbsvg .fcsvg{display:block;width:100%;height:auto;max-height:420px;background:#fff;border-radius:12px;border:1px solid var(--line,#ddd)}.fbcmp select{max-width:100%;font-size:15px;padding:4px}
.fbcam{position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center}.fbcam video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.fbsil{position:absolute;inset:8% 18% 16%;display:flex;justify-content:center}.fbsil svg{height:100%;width:auto}.fbcamt{position:absolute;top:calc(env(safe-area-inset-top) + 12px);left:16px;right:16px;color:#fff;text-align:center;font-size:15px;text-shadow:0 1px 3px #000}
.fbcamb{position:absolute;bottom:calc(env(safe-area-inset-bottom) + 18px);left:12px;right:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap}.nutblk{margin:10px 0}.nutblk summary{cursor:pointer}</style>`);
