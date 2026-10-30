// Direction chevrons along a route, evenly spaced on screen and nudged to the right of travel,
// so an out-and-back street shows "down this side, back that side". Re-laid out on zoom.

const SPACING_PX = 70;
const OFFSET_PX = 11;

export function arrowLayer(map, latlngs, color, { pop = false } = {}) {
  const group = L.layerGroup();
  let n = 0;
  const icon = (deg) => L.divIcon({
    className: 'route-arrow',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<span class="${pop ? 'pop' : ''}" style="animation-delay:${Math.min(n++ * 30, 900)}ms"><svg viewBox="0 0 20 20" style="transform:rotate(${deg}deg)"><path d="M4 3 L17 10 L4 17 L7.5 10 Z" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></span>`,
  });

  const layout = () => {
    group.clearLayers();
    n = 0;
    const pts = latlngs.map((ll) => map.latLngToLayerPoint(ll));
    let until = SPACING_PX / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (!len) continue;
      const ux = dx / len, uy = dy / len;
      while (until <= len) {
        // screen y points down, so (-uy, ux) is the right-hand side of travel
        const p = L.point(a.x + ux * until - uy * OFFSET_PX, a.y + uy * until + ux * OFFSET_PX);
        L.marker(map.layerPointToLatLng(p), { icon: icon((Math.atan2(uy, ux) * 180) / Math.PI), interactive: false, keyboard: false })
          .addTo(group);
        until += SPACING_PX;
      }
      until -= len;
    }
  };

  group.on('add', () => { map.on('zoomend', layout); layout(); pop = false; /* only pop in the first time */ });
  group.on('remove', () => map.off('zoomend', layout));
  return group;
}
