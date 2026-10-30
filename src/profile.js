// Elevation profile for one or two routes on a shared axis (elevation vs. distance walked),
// with a crosshair tooltip that also drives cursors on the map.

const FT_PER_M = 3.28084, M_PER_MI = 1609.344;
const W = 320, H = 116, PAD = { l: 44, r: 8, t: 10, b: 18 };
const INK_3 = '#7d7491', GRID = '#2e2840';

// series: [{ label, color, focused, pts: [{ d, z, lat, lon }] }]
export function renderProfile(el, series, { onHover } = {}) {
  series = series.filter((s) => s.pts.length > 1);
  if (!series.length) { el.innerHTML = ''; return; }
  const maxD = Math.max(...series.map((s) => s.pts.at(-1).d)) || 1;
  const all = series.flatMap((s) => s.pts.map((p) => p.z * FT_PER_M));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
  const sx = (d) => PAD.l + (d / maxD) * (W - PAD.l - PAD.r);
  const sy = (ft) => PAD.t + (1 - (ft - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const base = sy(lo);
  const path = (s) => s.pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.d).toFixed(1)},${sy(p.z * FT_PER_M).toFixed(1)}`).join('');
  // unfocused first, so the focused route draws on top
  const order = [...series].sort((a, b) => a.focused - b.focused);

  el.innerHTML = `
    ${series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>` : ''}
    <div class="plot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
           aria-label="Elevation from ${Math.round(lo)} to ${Math.round(hi)} feet over ${(maxD / M_PER_MI).toFixed(1)} miles">
        <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(hi)}" y2="${sy(hi)}" stroke="${GRID}" />
        <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${base}" y2="${base}" stroke="${GRID}" />
        ${series.length === 1 ? `<path d="${path(series[0])}L${sx(series[0].pts.at(-1).d)},${base}L${sx(0)},${base}Z" fill="${series[0].color}" fill-opacity="0.16" />` : ''}
        ${order.map((s) => `<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="${s.focused ? 2 : 1.5}"
            stroke-opacity="${s.focused || series.length === 1 ? 1 : 0.55}" vector-effect="non-scaling-stroke" stroke-linejoin="round" />`).join('')}
        <line class="xh" y1="${PAD.t}" y2="${base}" stroke="#f1ecf8" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden" />
        <rect x="${PAD.l}" y="0" width="${W - PAD.l - PAD.r}" height="${H}" fill="transparent" />
      </svg>
      <span class="ylab" style="top:${(sy(hi) / H) * 100}%">${Math.round(hi)} ft</span>
      <span class="ylab" style="top:${(base / H) * 100}%">${Math.round(lo)} ft</span>
      <span class="xlab" style="left:${(PAD.l / W) * 100}%">0</span>
      <span class="xlab end">${(maxD / M_PER_MI).toFixed(1)} mi</span>
      <div class="tip" hidden></div>
    </div>`;

  const svg = el.querySelector('svg'), xh = el.querySelector('.xh'), tip = el.querySelector('.tip');
  const hide = () => { xh.setAttribute('visibility', 'hidden'); tip.hidden = true; onHover?.([]); };
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const d = Math.min(maxD, Math.max(0, ((vx - PAD.l) / (W - PAD.l - PAD.r)) * maxD));
    const hits = series.map((s) => {
      if (d > s.pts.at(-1).d) return null;
      let i = 0;
      while (i < s.pts.length - 1 && s.pts[i + 1].d < d) i++;
      return { s, p: s.pts[i] };
    }).filter(Boolean);
    xh.setAttribute('x1', sx(d)); xh.setAttribute('x2', sx(d)); xh.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.style.left = `${Math.min(85, Math.max(15, (sx(d) / W) * 100))}%`;
    tip.innerHTML = `<b>${(d / M_PER_MI).toFixed(2)} mi</b>` + hits.map(({ s, p }) =>
      `<div><i style="background:${s.color}"></i>${series.length > 1 ? `${s.label} ` : ''}${Math.round(p.z * FT_PER_M)} ft</div>`).join('');
    onHover?.(hits.map(({ s, p }) => ({ ...p, color: s.color })));
  });
}
