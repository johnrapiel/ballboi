// Coming soon easter egg: brush-painted tennis balls.
// Desktop: hover the pill and balls flood in from every edge and cluster at the pointer.
// Leave the pill and they burst, bounce twice on the floor and clear. 2s cooldown.
// Phones: plays once on load, 60 balls fall from the top and all disappear into the pill.
// Reduced motion: no balls.
(() => {
  const pill = document.getElementById('soon');
  const cv = document.getElementById('balls');
  if (!pill || !cv || !cv.getContext) return;
  const cx = cv.getContext('2d');

  const INK = '#0A2447', SUN = '#E9B949';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktop = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const COOLDOWN = 2000;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;

  function resize() {
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kick();
  }

  // ---- Brush-painted sprites (drawn once, reused) ----
  function rng(s) { return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
  function shade(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    const c = v => Math.min(255, Math.max(0, v + a));
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }
  function brushArc(c, R, x0, y0, r, a0, a1, w, alpha) {
    const steps = Math.max(12, Math.floor(Math.abs(a1 - a0) * r / 2));
    let px = null, py = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, a = a0 + (a1 - a0) * t;
      const rr = r + (R() - 0.5) * r * 0.04 + Math.sin(a * 5 + R()) * r * 0.015;
      const x = x0 + Math.cos(a) * rr, y = y0 + Math.sin(a) * rr;
      if (px !== null) {
        const taper = Math.sin(Math.PI * Math.min(1, t * 1.15));
        c.globalAlpha = alpha * (0.75 + R() * 0.25);
        c.lineWidth = w * (0.35 + 0.75 * taper) * (0.8 + R() * 0.4);
        c.beginPath(); c.moveTo(px, py); c.lineTo(x, y); c.stroke();
      }
      px = x; py = y;
    }
  }
  function sprite(r, seed) {
    const R = rng(seed), S = Math.ceil(r * 2.6);
    const s = document.createElement('canvas');
    s.width = S * dpr; s.height = S * dpr;
    const c = s.getContext('2d'); c.scale(dpr, dpr); c.lineCap = 'round';
    const m = S / 2;
    c.save(); c.beginPath(); c.arc(m, m, r * 0.97, 0, Math.PI * 2); c.clip();
    c.fillStyle = SUN; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 7; i++) {
      c.globalAlpha = 0.18 + R() * 0.18; c.fillStyle = shade(SUN, R() < 0.5 ? -28 : 24);
      c.beginPath();
      c.ellipse(m + (R() - 0.5) * r * 1.3, m + (R() - 0.5) * r * 1.3, r * (0.3 + R() * 0.5), r * (0.2 + R() * 0.4), R() * 3, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1; c.strokeStyle = INK;
    const sw = Math.max(1.2, r * 0.13), off = r * 0.95;
    brushArc(c, R, m - off, m, r * 0.72, -1.05, 1.05, sw, 0.95);
    brushArc(c, R, m + off, m, r * 0.72, Math.PI - 1.05, Math.PI + 1.05, sw, 0.95);
    c.restore();
    c.strokeStyle = INK;
    const ow = Math.max(1.4, r * 0.16), a0 = R() * Math.PI * 2;
    brushArc(c, R, m, m, r, a0, a0 + Math.PI * 2 * (0.88 + R() * 0.1), ow, 1);
    brushArc(c, R, m, m, r * 1.02, a0 + 2, a0 + 2 + Math.PI * 2 * (0.3 + R() * 0.3), ow * 0.45, 0.55);
    for (let i = 0; i < 3; i++) { const st = R() * Math.PI * 2; brushArc(c, R, m, m, r * (1.05 + R() * 0.06), st, st + 0.4 + R() * 0.6, ow * 0.25, 0.35); }
    c.globalAlpha = 1;
    return { cv: s, S };
  }
  const sprites = [];
  for (let v = 0; v < 10; v++) sprites.push(sprite([10, 12, 14][v % 3], 1000 + v * 97));

  // ---- State ----
  let balls = [], mode = 'idle', t0 = 0, releasedAt = -1e9, px = 0, py = 0, raf = 0;

  function pillCenter() { const r = pill.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }
  function fromEdge(i) {
    const t = Math.random();
    switch (i % 4) { case 0: return [t * W, -40]; case 1: return [W + 40, t * H]; case 2: return [t * W, H + 40]; default: return [-40, t * H]; }
  }
  function make(n, offsetFn, delayMax) {
    balls = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = fromEdge(i), [ox, oy] = offsetFn(i, n);
      balls.push({ x, y, vx: 0, vy: 0, ox, oy, sp: sprites[i % sprites.length], delay: Math.random() * delayMax, rot: Math.random() * 6.28, al: 1, b: 0 });
    }
  }

  // Desktop: cluster at the pointer (sunflower packing).
  function startCluster() {
    const now = performance.now();
    if (mode === 'cluster' || (balls.length && now - releasedAt < COOLDOWN)) return;
    mode = 'cluster'; t0 = now;
    make(60, i => { const a = i * 2.39996, d = Math.sqrt(i) * 12; return [Math.cos(a) * d, Math.sin(a) * d]; }, 350);
    kick();
  }
  function burst() {
    if (mode !== 'cluster') return;
    mode = 'fall'; releasedAt = performance.now();
    balls.forEach(b => {
      const dx = b.x - px, dy = b.y - py, m = Math.hypot(dx, dy) || 1, f = 5 + Math.random() * 6;
      b.vx = dx / m * f; b.vy = dy / m * f - 3;
    });
    kick();
  }
  // Phones, once on load: balls rain from the top, curve into the pill and dissolve.
  function startRain() {
    mode = 'rain'; balls = [];
    const p = pillCenter();
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * W, y = -20 - Math.random() * H * 0.6;
      balls.push({
        x, y, x0: x, y0: y, vx: 0, vy: 3 + Math.random() * 2,
        tx: p.x + (Math.random() - 0.5) * p.w * 0.7, sp: sprites[i % sprites.length],
        rot: Math.random() * 6.28, al: 1, s: 1, dis: false
      });
    }
    kick();
  }
  let lastPulse = 0;
  function pulse(now) {
    if (now - lastPulse < 90 || !pill.animate) return;
    lastPulse = now;
    pill.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
  }

  // ---- Loop ----
  function draw(b) {
    cx.save(); cx.globalAlpha = Math.max(0, b.al); cx.translate(b.x, b.y); cx.rotate(b.rot);
    if (b.s !== undefined) cx.scale(b.s, b.s);
    cx.drawImage(b.sp.cv, -b.sp.S / 2, -b.sp.S / 2, b.sp.S, b.sp.S); cx.restore();
  }
  function tick(now) {
    raf = 0;
    cx.clearRect(0, 0, W, H);
    const p = pillCenter();
    let moving = false;
    for (const b of balls) {
      if (mode === 'cluster') {
        if (now - t0 < b.delay) { moving = true; continue; }
        const tx = px + b.ox, ty = py + b.oy;
        if (reduce) { b.x = tx; b.y = ty; b.rot = 0; continue; }
        const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
        const k = 0.012 + Math.min(0.05, 60 / (d * d + 600));
        b.vx = (b.vx + dx * k) * 0.86; b.vy = (b.vy + dy * k) * 0.86;
        moving = true;
      } else if (mode === 'fall') {
        b.vy += 0.42; b.vx *= 0.995;
        const floor = H - b.sp.S / 2.6;
        if (b.y > floor && b.vy > 0 && b.b < 2) { b.y = floor; b.vy *= -0.45; b.vx *= 0.8; b.b++; }
        if (b.b >= 2) b.al -= 0.02;
        moving = true;
      } else if (mode === 'rain') {
        moving = true;
        if (b.dis) {
          b.s *= 0.8; b.al -= 0.15;
          b.x += (p.x - b.x) * 0.2; b.y += (p.y - b.y) * 0.2;
        } else {
          // Fall under gravity; x eases from the start point to a spot inside the pill,
          // so every ball lands in it.
          b.vy = Math.min(b.vy + 0.45, 16); b.y += b.vy;
          const t = Math.max(0, Math.min(1, (b.y - b.y0) / (p.y - b.y0)));
          b.x = b.x0 + (b.tx - b.x0) * t * t * (3 - 2 * t);
          b.rot += 0.1;
          if (b.y >= p.y - p.h / 2 + 4) { b.dis = true; pulse(now); }
        }
        continue;
      }
      b.x += b.vx; b.y += b.vy; b.rot += b.vx * 0.04;
    }
    if (mode === 'fall' || mode === 'rain') {
      balls = balls.filter(b => b.al > 0 && b.y < H + 80 && b.x > -80 && b.x < W + 80);
      if (!balls.length) mode = 'idle';
    }
    for (const b of balls) if (!((mode === 'cluster') && now - t0 < b.delay)) draw(b);
    if (moving) kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }

  // ---- Wiring ----
  addEventListener('resize', resize);
  resize();

  if (reduce) return;
  if (desktop) {
    addEventListener('pointermove', e => { px = e.clientX; py = e.clientY; if (mode === 'cluster') kick(); }, { passive: true });
    pill.addEventListener('pointerenter', e => { px = e.clientX; py = e.clientY; startCluster(); });
    pill.addEventListener('pointerleave', burst);
    document.addEventListener('visibilitychange', () => { if (document.hidden) burst(); });
  } else {
    setTimeout(startRain, 300);
  }
})();
