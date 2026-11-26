/* Cattura del microfono a 16 kHz per il registratore delle visite (generico, nessun dato e nessuna rete).
   Gira nel thread audio del browser (AudioWorklet): se la pagina è occupata non perde pezzi di audio.
   Filtro anti-aliasing e ricampionamento a 16 kHz, passa-alto a 80 Hz; ogni 100 ms passa alla pagina 1600 campioni
   con livello (RMS) e picco. Il codice del filtro è lo stesso del motore audio della pagina (generato dalla stessa sorgente). */
'use strict';
/* Ricampionatore a 16 kHz: sinc finestrata (Kaiser, beta 8) a 64 fasi, taglio a 7,2 kHz, più passa-alto a 80 Hz.
   Nessuna allocazione nel giro dei campioni: si scrive l'ingresso con write() e si leggono le uscite con read(). */
function nlKaiser(x, beta) {
  const i0 = (v) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (v / (2 * k)) * (v / (2 * k)); s += t; if (t < 1e-12 * s) break; } return s; };
  return Math.abs(x) >= 1 ? 0 : i0(beta * Math.sqrt(1 - x * x)) / i0(beta);
}
class NlRs16 {
  constructor(inRate, outRate) {
    outRate = outRate || 16000; this.r = inRate / outRate;
    const fc = Math.min(0.45 * outRate, 0.45 * inRate) / inRate, W = Math.max(8, Math.ceil(16 * Math.max(1, this.r))), P = 64, L = 2 * W;
    this.W = W; this.P = P; this.L = L; this.T = new Float32Array((P + 1) * L);
    for (let p = 0; p <= P; p++) {
      const d = p / P; let s = 0;
      for (let j = 0; j < L; j++) { const x = (j - W + 1) - d, h = Math.abs(x) < 1e-9 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x), v = h * nlKaiser(x / W, 8); this.T[p * L + j] = v; s += v; }
      for (let j = 0; j < L; j++) this.T[p * L + j] /= s;
    }
    let c = 1; while (c < 4 * L + 16384) c <<= 1; this.ring = new Float32Array(c); this.m = c - 1;
    this.w = 0; this.t = W - 1; this.hx = 0; this.hy = 0; this.ha = 1 / (1 + 2 * Math.PI * 80 / outRate);
  }
  write(x) { const m = this.m, ring = this.ring; let w = this.w; for (let i = 0; i < x.length; i++) ring[(w + i) & m] = x[i]; this.w = w + x.length; }
  read(out, o) {
    const T = this.T, W = this.W, P = this.P, L = this.L, m = this.m, ring = this.ring;
    while (o < out.length) {
      const i0 = Math.floor(this.t); if (i0 + W >= this.w) break;
      const off = Math.round((this.t - i0) * P) * L, base = i0 - W + 1; let s = 0;
      for (let j = 0; j < L; j++) s += T[off + j] * ring[(base + j) & m];
      const y = this.ha * (this.hy + s - this.hx); this.hx = s; this.hy = y; out[o++] = y; this.t += this.r;
    }
    return o;
  }
}
class NlRec16 extends AudioWorkletProcessor {
  constructor() {
    super(); this.rs = new NlRs16(sampleRate); this.buf = new Float32Array(1600); this.k = 0; this.on = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; };
  }
  process(inputs) {
    if (!this.on) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      this.rs.write(ch);
      for (;;) {
        this.k = this.rs.read(this.buf, this.k); if (this.k < this.buf.length) break;
        let e = 0, p = 0; const b = this.buf;
        for (let i = 0; i < b.length; i++) { const v = b[i]; e += v * v; if (v > p) p = v; else if (-v > p) p = -v; }
        this.port.postMessage({ x: b, r: Math.sqrt(e / b.length), p }, [b.buffer]); this.buf = new Float32Array(1600); this.k = 0;
      }
    }
    return true;
  }
}
registerProcessor('nl-rec16', NlRec16);
