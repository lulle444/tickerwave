/* Live background: a dim chart grid with price lines that keep drawing themselves from the right, a row of
   candles along the bottom and a crosshair that follows the mouse. Colors come from brand.css.
   One still frame for reduced-motion users; pauses while the tab is hidden. */
(function(){
"use strict";
const c = document.getElementById("bg");
const ctx = c && c.getContext("2d");
if (!ctx) return;
const css = getComputedStyle(document.documentElement);
const rgb = (name, fb) => css.getPropertyValue(name).trim() || fb;
const ACC = rgb("--accent-rgb", "200,242,90"), ACC2 = rgb("--accent2-rgb", "91,124,255"),
      UP = rgb("--up-rgb", "61,220,151"), DOWN = rgb("--down-rgb", "255,107,87"), INK = rgb("--ink-rgb", "242,241,234");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const STEP = 6;                 // px between price points
const SPEED = 14;               // px per second the chart scrolls left
let w = 0, h = 0, raf = 0, last = 0, shift = 0, scroll = 0;
const ptr = {x: -1, y: -1, a: 0, on: 0};
let lines = [], candles = [];

// a price series that wanders but drifts back toward its middle
function walker(seed){
  let v = 0, m = 0;
  return () => { m = m * .92 + (Math.random() - .5) * seed; v += m; v *= .985; return v; };
}

function makeLines(){
  const n = Math.ceil(w / STEP) + 4;
  const spec = [
    {y: .30, amp: 90, col: ACC, a: .26, lw: 1.6},
    {y: .52, amp: 120, col: ACC2, a: .30, lw: 1.6},
    {y: .70, amp: 70, col: INK, a: .07, lw: 1.2},
    {y: .18, amp: 60, col: ACC2, a: .10, lw: 1.1},
  ];
  lines = spec.map(s => {
    const next = walker(s.amp / 22), pts = [];
    for (let i = 0; i < n; i++) pts.push(next());
    return {...s, next, pts};
  });
}

function candle(p){
  const o = p + (Math.random() - .5) * 8, cl = p + (Math.random() - .5) * 8;
  return {o, c: cl, hi: Math.max(o, cl) + Math.random() * 6, lo: Math.min(o, cl) - Math.random() * 6};
}
function makeCandles(){
  candles = [];
  let p = 20;
  for (let x = 0; x < w + 40; x += 14) candles.push(candle(p = Math.max(6, Math.min(50, p + (Math.random() - .5) * 10))));
}

function size(){
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  w = c.clientWidth; h = c.clientHeight;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  makeLines(); makeCandles();
}

function grid(){
  const g = 64, off = -(shift % g), vy = -(scroll * .15 % g);
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(${INK},.035)`;
  ctx.beginPath();
  for (let x = off; x < w; x += g){ ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, h); }
  for (let y = vy; y < h; y += g){ ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); }
  ctx.stroke();
}

function drawLines(){
  const frac = shift % STEP;
  for (const L of lines){
    const base = h * L.y - scroll * .08, Y = v => base + Math.max(-L.amp, Math.min(L.amp, v));
    ctx.beginPath();
    L.pts.forEach((v, i) => { const x = i * STEP - frac; i ? ctx.lineTo(x, Y(v)) : ctx.moveTo(x, Y(v)); });
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, `rgba(${L.col},0)`); g.addColorStop(.35, `rgba(${L.col},${L.a * .6})`); g.addColorStop(1, `rgba(${L.col},${L.a})`);
    ctx.strokeStyle = g; ctx.lineWidth = L.lw; ctx.stroke();
  }
}

function drawCandles(){
  const frac = (shift * .6) % 14, base = h - 40;
  for (let i = 0; i < candles.length; i++){
    const k = candles[i], x = i * 14 - frac, col = k.c >= k.o ? UP : DOWN;
    ctx.fillStyle = `rgba(${col},${.04 + .08 * Math.max(0, x / w)})`;
    ctx.fillRect(Math.round(x) + 3, base - k.hi, 1, k.hi - k.lo);
    ctx.fillRect(Math.round(x), base - Math.max(k.o, k.c), 7, Math.max(2, Math.abs(k.c - k.o)));
  }
}

function crosshair(){
  if (ptr.a < .02) return;
  ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(${ACC},${.2 * ptr.a})`;
  ctx.beginPath(); ctx.moveTo(ptr.x + .5, 0); ctx.lineTo(ptr.x + .5, h); ctx.moveTo(0, ptr.y + .5); ctx.lineTo(w, ptr.y + .5); ctx.stroke();
  ctx.setLineDash([]);
  const r = ctx.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, 220);
  r.addColorStop(0, `rgba(${ACC},${.06 * ptr.a})`); r.addColorStop(1, `rgba(${ACC},0)`);
  ctx.fillStyle = r; ctx.fillRect(ptr.x - 220, ptr.y - 220, 440, 440);
}

function glow(){
  const m = Math.max(w, h);
  const r = ctx.createRadialGradient(w * .85, -h * .1, 0, w * .85, -h * .1, m * .7);
  r.addColorStop(0, `rgba(${ACC2},.16)`); r.addColorStop(1, `rgba(${ACC2},0)`);
  ctx.fillStyle = r; ctx.fillRect(0, 0, w, h);
  const r2 = ctx.createRadialGradient(0, h, 0, 0, h, m * .6);
  r2.addColorStop(0, `rgba(${ACC},.06)`); r2.addColorStop(1, `rgba(${ACC},0)`);
  ctx.fillStyle = r2; ctx.fillRect(0, 0, w, h);
}

function draw(){
  ctx.clearRect(0, 0, w, h);
  glow(); grid(); drawCandles(); drawLines(); crosshair();
}

function advance(dt){
  const before = Math.floor(shift / STEP), beforeC = Math.floor(shift * .6 / 14);
  shift += SPEED * dt;
  for (let n = Math.floor(shift / STEP) - before; n > 0; n--) for (const L of lines){ L.pts.shift(); L.pts.push(L.next()); }
  for (let n = Math.floor(shift * .6 / 14) - beforeC; n > 0; n--){
    const p = candles[candles.length - 1].c;
    candles.shift(); candles.push(candle(Math.max(6, Math.min(50, p + (Math.random() - .5) * 10))));
  }
  ptr.a += (ptr.on - ptr.a) * Math.min(1, dt * 4);
}

function frame(now){
  raf = requestAnimationFrame(frame);
  const dt = last ? Math.min(now - last, 100) : 0;
  if (last && dt < 30) return;          // ~30 fps is smooth enough and light on batteries
  last = now;
  advance(dt / 1000); draw();
}
function start(){
  cancelAnimationFrame(raf); last = 0;
  if (reduce.matches || document.hidden) draw(); else raf = requestAnimationFrame(frame);
}

size(); scroll = window.scrollY; start();
window.addEventListener("resize", () => { size(); draw(); });
window.addEventListener("scroll", () => { scroll = window.scrollY; if (reduce.matches) draw(); }, {passive: true});
window.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse" || reduce.matches) return;
  ptr.x = e.clientX; ptr.y = e.clientY; ptr.on = 1;
}, {passive: true});
document.documentElement.addEventListener("pointerleave", () => { ptr.on = 0; });
document.addEventListener("visibilitychange", start);
reduce.addEventListener("change", start);
})();
