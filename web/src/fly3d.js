// Низкополигональная муха: меш строится один раз, рисуется художественным алгоритмом
// (сортировка треугольников по глубине) с плоским затенением — вид NeuroMechFly / MuJoCo.
const GRAY = [172, 164, 150], BEIGE = [196, 184, 160], DARK = [92, 84, 72];
const LEG = [118, 108, 92], RED = [198, 54, 48], WING = [215, 228, 245];

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

function buildMesh() {
  const T = [];
  // Профиль [[x, радиус], ...] вращается вокруг оси x.
  function lathe(profile, seg, color, part, off = [0, 0, 0], ys = 1) {
    const rings = profile.map(([x, r]) => Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2;
      return [x + off[0], Math.cos(a) * r * ys + off[1], Math.sin(a) * r + off[2]];
    }));
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = rings[i][j], b = rings[i][(j + 1) % seg];
        const c = rings[i + 1][(j + 1) % seg], d = rings[i + 1][j];
        const col = typeof color === 'function' ? color(i) : color;
        T.push({ v: [a, b, c], c: col, part }); T.push({ v: [a, c, d], c: col, part });
      }
    }
  }
  function ellipsoid(cx, cy, cz, rx, rr, seg, color, part, ys = 1) {
    const p = [];
    for (let i = 0; i <= 6; i++) { const t = -Math.PI / 2 + (i / 6) * Math.PI; p.push([Math.sin(t) * rx, Math.cos(t) * rr]); }
    lathe(p, seg, color, part, [cx, cy, cz], ys);
  }
  function tube(p0, p1, r0, r1, seg, color, part) {
    const u = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
    const up = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const v = norm([u[1] * up[2] - u[2] * up[1], u[2] * up[0] - u[0] * up[2], u[0] * up[1] - u[1] * up[0]]);
    const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const ring = (p, r) => Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2, cs = Math.cos(a) * r, sn = Math.sin(a) * r;
      return [p[0] + v[0] * cs + w[0] * sn, p[1] + v[1] * cs + w[1] * sn, p[2] + v[2] * cs + w[2] * sn];
    });
    const A = ring(p0, r0), B = ring(p1, r1);
    for (let j = 0; j < seg; j++) {
      const a = A[j], b = A[(j + 1) % seg], c = B[(j + 1) % seg], d = B[j];
      T.push({ v: [a, b, c], c: color, part }); T.push({ v: [a, c, d], c: color, part });
    }
  }

  // Тело: x — вперёд, y — вверх, z — на зрителя.
  ellipsoid(1.08, 0, 0, 0.34, 0.32, 10, GRAY, 'head', 1.05);
  ellipsoid(1.14, 0.03, 0.28, 0.2, 0.2, 8, RED, 'eye');
  ellipsoid(1.14, 0.03, -0.28, 0.2, 0.2, 8, RED, 'eye');
  ellipsoid(0.36, 0.04, 0, 0.5, 0.44, 12, BEIGE, 'thorax', 0.9);
  lathe([[-1.42, 0], [-1.3, 0.12], [-1.1, 0.25], [-0.85, 0.36], [-0.6, 0.42], [-0.3, 0.42], [-0.05, 0.3]],
    12, (i) => (i % 2 ? DARK : BEIGE), 'abdomen');
  tube([1.16, -0.26, 0], [1.16, -0.46, 0], 0.07, 0.05, 5, GRAY, 'proboscis');
  for (const s of [1, -1]) {
    tube([1.34, 0.06, s * 0.08], [1.48, -0.06, s * 0.13], 0.035, 0.02, 4, DARK, 'antenna');
    tube([-0.1, -0.02, s * 0.42], [-0.26, 0.06, s * 0.62], 0.03, 0.03, 4, DARK, 'haltere');
    ellipsoid(-0.28, 0.07, s * 0.65, 0.07, 0.07, 5, DARK, 'haltere');
    const legs = [[0.7, 0.45, 0.8, 0.95], [0.35, 0.05, 0.15, 0.25], [0.0, -0.45, -0.85, -1.05]];
    for (const [bx, d1, d2, d3] of legs) {
      const p0 = [bx, -0.32, s * 0.22], p1 = [bx + (d1 - bx) * 0.6, -0.5, s * 0.7];
      const p2 = [bx + (d2 - bx) * 0.8, -0.9, s * 0.62], p3 = [d3, -1.05, s * 0.72];
      tube(p0, p1, 0.06, 0.05, 4, LEG, 'leg'); tube(p1, p2, 0.05, 0.035, 4, LEG, 'leg'); tube(p2, p3, 0.035, 0.02, 4, LEG, 'leg');
      ellipsoid(p1[0], p1[1], p1[2], 0.06, 0.06, 4, DARK, 'leg');
      ellipsoid(p2[0], p2[1], p2[2], 0.05, 0.05, 4, DARK, 'leg');
    }
  }
  return T;
}

const T = buildMesh();
const WSHAPE = [[0, 0], [-0.15, 0.45], [-0.6, 1.3], [-1.3, 1.85], [-1.9, 1.8], [-2.05, 1.35], [-1.65, 0.75], [-0.85, 0.28]];
const LIGHT = norm([-0.45, 0.85, 0.6]);
const YAW = -0.6, ROLL = 0.32, FOCAL = 7;
const CY = Math.cos(YAW), SY = Math.sin(YAW), CR = Math.cos(ROLL), SR = Math.sin(ROLL);

export const triangleCount = T.length + 14;

export function renderFly(ctx, X, Y, pitch, flap, phase, S) {
  const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
  const view = (p) => {
    const x = p[0], y = p[1] * CR - p[2] * SR, z = p[1] * SR + p[2] * CR;
    const x2 = x * CY + z * SY, z2 = -x * SY + z * CY;
    return [x2 * cp - y * sp, x2 * sp + y * cp, z2];
  };
  const phi = 0.4 + Math.sin(phase) * (0.25 + flap * 0.75);
  const wingT = [];
  for (const s of [1, -1]) {
    const R = [0.3, 0.34, s * 0.17];
    const P = WSHAPE.map(([cx, sn]) => [R[0] + cx, R[1] + sn * Math.sin(phi), R[2] + s * sn * Math.cos(phi)]);
    for (let i = 0; i < P.length - 1; i++) wingT.push({ v: [R, P[i], P[i + 1]], c: WING, part: 'wing' });
  }
  const list = [];
  const push = (t) => {
    const a = view(t.v[0]), b = view(t.v[1]), c = view(t.v[2]);
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const wing = t.part === 'wing';
    if (!wing && nz < 0) return;                       // отсечение обратных граней
    const nl = Math.hypot(nx, ny, nz) || 1;
    let d = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl;
    if (wing) d = Math.abs(d);
    const sh = 0.32 + 0.68 * Math.max(0, d);
    list.push({ a, b, c, z: (a[2] + b[2] + c[2]) / 3, wing, col: t.c.map((v) => Math.min(255, v * sh) | 0) });
  };
  for (const t of T) push(t);
  for (const t of wingT) push(t);
  list.sort((p, q) => p.z - q.z);

  const scr = (v) => { const f = FOCAL / (FOCAL - v[2]); return [X + v[0] * S * f, Y - v[1] * S * f]; };
  ctx.lineWidth = 0.5; ctx.lineJoin = 'round';
  for (const t of list) {
    const [ax, ay] = scr(t.a), [bx, by] = scr(t.b), [cx, cy] = scr(t.c);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath();
    const [r, g, b] = t.col;
    if (t.wing) {
      ctx.fillStyle = `rgba(${r},${g},${b},.42)`; ctx.fill();
      ctx.strokeStyle = 'rgba(200,215,235,.45)'; ctx.stroke();
    } else {
      ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fill();
      ctx.strokeStyle = 'rgba(22,20,28,.3)'; ctx.stroke();
    }
  }
}
