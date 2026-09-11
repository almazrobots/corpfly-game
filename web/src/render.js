import { W, H, FLOOR, PICKUPS, BLOCKER_POINTS, COIN_POINTS } from './engine.js';
import { renderFly } from './fly3d.js';

// Цвета бонусов. Монета — латунь, усилители — три разных сигнальных оттенка,
// чтобы различались боковым зрением, а не по подписи.
const PICKUP_SKIN = {
  coin:   { face: '#e8c56a', edge: '#a9862f', glow: 'rgba(232,197,106,' },
  shield: { face: '#8ee6f2', edge: '#2f7d8a', glow: 'rgba(142,230,242,' },
  slow:   { face: '#b48cff', edge: '#5b3fa0', glow: 'rgba(180,140,255,' },
  mult:   { face: '#ff7a59', edge: '#a33a22', glow: 'rgba(255,122,89,' },
};

/**
 * Вращающийся объём на плоском холсте: ширина эллипса идёт по |cos|, а у самого
 * ребра дорисовывается торец. Глаз читает это как объёмный предмет, и стоит оно
 * дешевле настоящего меша — а мешей на экране может быть много.
 */
function drawSpinner(ctx, p, now) {
  const skin = PICKUP_SKIN[p.kind] ?? PICKUP_SKIN.coin;
  const r = p.r;
  const c = Math.cos(p.spin);
  const wide = Math.abs(c);
  const bob = Math.sin(now / 340 + p.x * 0.01) * 3;
  const y = p.y + bob;

  // Свечение — подсказка «сюда стоит лететь».
  const halo = ctx.createRadialGradient(p.x, y, r * 0.3, p.x, y, r * 2.1);
  halo.addColorStop(0, `${skin.glow}.30)`);
  halo.addColorStop(1, `${skin.glow}0)`);
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(p.x, y, r * 2.1, 0, Math.PI * 2); ctx.fill();

  // Торец: виден тем сильнее, чем ближе предмет к ребру.
  const edgeW = Math.max(1.5, r * 0.22 * (1 - wide));
  if (edgeW > 1.6) {
    ctx.fillStyle = skin.edge;
    ctx.beginPath();
    ctx.ellipse(p.x, y, Math.max(edgeW, r * wide), r, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Лицевая сторона.
  const faceW = Math.max(1, r * wide);
  const g = ctx.createLinearGradient(p.x - faceW, y - r, p.x + faceW, y + r);
  g.addColorStop(0, skin.edge);
  g.addColorStop(0.45, skin.face);
  g.addColorStop(1, skin.edge);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(p.x, y, faceW, r, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = skin.edge; ctx.lineWidth = 1.2; ctx.stroke();

  // Знак на лицевой стороне проявляется, только когда предмет развёрнут к игроку.
  if (wide > 0.45) {
    ctx.save();
    ctx.globalAlpha = (wide - 0.45) / 0.55;
    ctx.translate(p.x, y);
    ctx.scale(wide, 1);
    ctx.strokeStyle = '#1a1206';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (p.kind === 'coin') {
      // Простая шестерня: круг и четыре зубца — знак «бюджет выделен».
      ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        ctx.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
        ctx.lineTo(Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.68);
      }
    } else if (p.kind === 'shield') {
      ctx.moveTo(0, -r * 0.6);
      ctx.lineTo(r * 0.48, -r * 0.28);
      ctx.lineTo(r * 0.36, r * 0.34);
      ctx.lineTo(0, r * 0.62);
      ctx.lineTo(-r * 0.36, r * 0.34);
      ctx.lineTo(-r * 0.48, -r * 0.28);
      ctx.closePath();
    } else if (p.kind === 'slow') {
      // Песочные часы — «срок сдвинули».
      ctx.moveTo(-r * 0.4, -r * 0.55); ctx.lineTo(r * 0.4, -r * 0.55);
      ctx.lineTo(-r * 0.4, r * 0.55); ctx.lineTo(r * 0.4, r * 0.55);
      ctx.closePath();
    } else {
      ctx.moveTo(-r * 0.42, -r * 0.4); ctx.lineTo(r * 0.42, r * 0.4);
      ctx.moveTo(r * 0.42, -r * 0.4); ctx.lineTo(-r * 0.42, r * 0.4);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export function drawBlock(ctx, o) {
  const y = o.side === 'ping' ? o.yy : o.y;
  if (o.side === 'ping') {
    ctx.fillStyle = '#4a154b'; ctx.fillRect(o.x, y, o.w, o.h);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('@here', o.x + o.w / 2, y + o.h / 2);
    return;
  }
  const g = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
  g.addColorStop(0, '#1c2540'); g.addColorStop(0.5, '#2c3859'); g.addColorStop(1, '#1c2540');
  ctx.fillStyle = g; ctx.fillRect(o.x, y, o.w, o.h);
  ctx.strokeStyle = '#4d5f8a'; ctx.lineWidth = 1; ctx.strokeRect(o.x + 0.5, y + 0.5, o.w - 1, o.h - 1);
  // Опасная кромка помечена штриховкой — читается даже боковым зрением.
  const ey = o.side === 'top' ? y + o.h - 8 : y;
  ctx.fillStyle = '#ff7a59'; ctx.fillRect(o.x, ey, o.w, 8);
  ctx.fillStyle = '#0e1424';
  for (let i = 0; i < o.w; i += 12) ctx.fillRect(o.x + i, ey, 6, 8);

  ctx.save();
  ctx.translate(o.x + o.w / 2, y + o.h / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#dfe7f5'; ctx.font = 'bold 13px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const maxLen = o.h - 30;
  let label = o.label;
  while (ctx.measureText(label).width > maxLen && label.length > 3) label = `${label.slice(0, -2)}…`;
  if (o.h > 44) ctx.fillText(label, 0, 0);
  ctx.restore();
}

export function draw(ctx, eng, now = 0) {
  ctx.clearRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(142,230,242,.06)'; ctx.lineWidth = 1;
  const off = (eng.dist * 0.3) % 40;
  for (let x = -off; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, FLOOR); ctx.stroke(); }
  for (let y = 0; y < FLOOR; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  ctx.fillStyle = 'rgba(125,138,165,.5)'; ctx.font = '10px "Courier New", monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('C-LEVEL  ·  glass ceiling', 12, 6);

  for (const o of eng.obs) drawBlock(ctx, o);

  ctx.strokeStyle = 'rgba(142,230,242,.5)';
  for (const s of eng.spikes) {
    ctx.globalAlpha = 1 - s.r / 40;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const p of eng.pickups) drawSpinner(ctx, p, now);

  // Всплывающие начисления: видно, откуда взялись очки и сколько именно.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const q of eng.pops) {
    ctx.globalAlpha = Math.min(1, q.life * 1.4);
    ctx.fillStyle = q.kind === 'coin' ? PICKUP_SKIN.coin.face : '#8ee6f2';
    ctx.font = `bold ${q.kind === 'coin' ? 15 : 17}px "Courier New", monospace`;
    ctx.fillText(q.text, q.x, q.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  if (eng.state !== 'dead') {
    // Щит виден как кольцо вокруг мухи и мигает в последнюю секунду — чтобы
    // окончание защиты не стало неожиданностью.
    if (eng.fx.shield > 0) {
      const blink = eng.fx.shield < 1 ? 0.35 + 0.45 * Math.abs(Math.sin(now / 90)) : 0.8;
      ctx.strokeStyle = `rgba(142,230,242,${blink})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(eng.fly.x, eng.fly.y, 26 + Math.sin(now / 200) * 2, 0, Math.PI * 2); ctx.stroke();
    }
    renderFly(ctx, eng.fly.x, eng.fly.y, eng.fly.a, eng.fly.wing, (now / 1000) * 38, 15);
  } else {
    ctx.fillStyle = '#b4aa96';
    for (const p of eng.particles) { ctx.globalAlpha = p.life; ctx.fillRect(p.x, p.y, 4, 4); }
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = '#141c30'; ctx.fillRect(0, FLOOR, W, H - FLOOR);
  ctx.fillStyle = '#ff7a59'; ctx.fillRect(0, FLOOR, W, 2);
  ctx.fillStyle = 'rgba(14,20,36,.85)'; ctx.fillRect(0, FLOOR + 2, W, H - FLOOR - 2);

  ctx.fillStyle = '#8ee6f2'; ctx.font = 'bold 11px "Courier New", monospace';
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillText('NEURAL REPLAY', 12, FLOOR + 10);
  ctx.fillStyle = '#7d8aa5'; ctx.font = '10px "Courier New", monospace';
  ctx.fillText('166700 NEURONS   96-CELL SPIKE RASTER   floor = burnout', 12, FLOOR + 26);

  const sp = (eng.state === 'play' ? 400 + Math.abs(eng.fly.vy) * 0.6 : 0) | 0;
  ctx.textAlign = 'right'; ctx.fillStyle = '#8ee6f2'; ctx.font = 'bold 14px "Courier New", monospace';
  ctx.fillText(`${(sp / 1000).toFixed(1)}K spikes/s`, W - 12, FLOOR + 8);
  ctx.textAlign = 'left';

  const rx = 12, rw = W - 24, ry = FLOOR + 42, rh = 14;
  for (let i = 0; i < eng.raster.length; i++) {
    const v = eng.raster[i];
    ctx.fillStyle = `rgba(142,230,242,${0.15 + v * 0.85})`;
    ctx.fillRect(rx + i * (rw / 96), ry + rh - v * rh, rw / 96 - 1, v * rh + 1);
  }

  // Активные эффекты: полоска остатка и подпись. Стоят слева сверху, чтобы не
  // спорить со счётом по центру.
  const active = ['shield', 'slow', 'mult'].filter((k) => eng.fx[k] > 0);
  active.forEach((k, i) => {
    const def = PICKUPS[k];
    const skin = PICKUP_SKIN[k];
    const left = eng.fx[k] / (def.ms / 1000);
    const y = 24 + i * 22;
    ctx.fillStyle = 'rgba(14,20,36,.72)';
    ctx.fillRect(10, y, 132, 18);
    ctx.fillStyle = `${skin.glow}.22)`;
    ctx.fillRect(10, y, 132 * Math.min(1, left), 18);
    ctx.strokeStyle = skin.edge; ctx.lineWidth = 1; ctx.strokeRect(10.5, y + 0.5, 131, 17);
    ctx.fillStyle = skin.face;
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(def.label, 16, y + 9);
    ctx.textAlign = 'right';
    ctx.fillText(`${eng.fx[k].toFixed(1)}s`, 136, y + 9);
  });
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';

  if (eng.state !== 'idle') {
    // Счёт и ИЗ ЧЕГО он собран. Раньше тут стояло одно число с подписью
    // «blockers passed», и вклад монет был не виден вовсе — выглядело так,
    // будто их ловят просто так.
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(14,20,36,.72)'; ctx.fillRect(W / 2 - 74, 20, 148, 62);
    ctx.strokeStyle = 'rgba(77,95,138,.55)'; ctx.lineWidth = 1;
    ctx.strokeRect(W / 2 - 73.5, 20.5, 147, 61);

    ctx.fillStyle = '#8ee6f2'; ctx.font = 'bold 34px "Courier New", monospace';
    ctx.fillText(String(eng.score), W / 2, 23);

    // Разбор: слева блокеры цветом HUD, справа бюджет цветом монеты.
    ctx.font = 'bold 11px "Courier New", monospace';
    const bl = `${eng.blockers}x${BLOCKER_POINTS}`;
    const bu = `${eng.coins}x${COIN_POINTS}`;
    const wBl = ctx.measureText(bl).width;
    const wBu = ctx.measureText(bu).width;
    const gap = 12;
    const startX = W / 2 - (wBl + gap + wBu) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8ee6f2';
    ctx.fillText(bl, startX, 62);
    ctx.fillStyle = '#7d8aa5';
    ctx.fillText('+', startX + wBl + 3, 62);
    ctx.fillStyle = PICKUP_SKIN.coin.face;
    ctx.fillText(bu, startX + wBl + gap, 62);
    ctx.textAlign = 'left';
  }
}
