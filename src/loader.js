// The spooky loader: a night scene over the map while we fetch data and solve.
// A ghost trick-or-treats across the hills, candy flies into a jack-o'-lantern bucket,
// and the counter climbs with the solver's real best-so-far haul.

const QUIPS = [
  'Knocking on doors at the speed of math…',
  'Ranking porches by full-size-bar potential…',
  "Teaching a ghost Tobler's hiking function…",
  'Skipping the house that hands out toothbrushes…',
  "Counting hills so tiny legs don't have to…",
  'Negotiating right of way with a black cat…',
  'Weighing Snickers per step…',
  'Consulting the Great Pumpkin…',
  'Avoiding the raisin house at all costs…',
  'Untangling cul-de-sacs…',
  'Calculating optimal pillowcase capacity…',
  'Bribing the HOA with candy corn…',
  'Checking which porch lights are on…',
  'Measuring every hill twice, walking it once…',
];
const CANDY = ['🍬', '🍭', '🍫', '🍬', '🍭', '🍫', '🍪', '🧁'];
const MIN_SHOW_MS = 1100;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

export function createLoader(root) {
  root.innerHTML = TEMPLATE;
  const $ = (sel) => root.querySelector(sel);
  const el = {
    count: $('.ld-count b'), bar: $('.ld-bar i'), stage: $('.ld-stage'), quip: $('.ld-quip'),
    bucket: $('.ld-bucket'), flyers: $('.ld-flyers'), card: $('.ld-card'), title: $('.ld-title'),
  };
  let shownAt = 0, target = 0, shownCount = 0, frac = 0, creepTo = 0;
  let raf = 0, quipTimer = 0, idleTimer = 0, quipIdx = Math.floor(Math.random() * QUIPS.length);
  let visible = false;

  const tick = () => {
    // Ease the counter toward the real haul, and creep the bar toward its current ceiling.
    shownCount += (target - shownCount) * 0.12;
    if (Math.abs(target - shownCount) < 0.5) shownCount = target;
    el.count.textContent = Math.round(shownCount);
    if (frac < creepTo) frac += (creepTo - frac) * 0.015;
    el.bar.style.transform = `scaleX(${Math.max(0.02, frac)})`;
    raf = requestAnimationFrame(tick);
  };

  const nextQuip = () => {
    el.quip.classList.remove('in');
    setTimeout(() => {
      quipIdx = (quipIdx + 1) % QUIPS.length;
      el.quip.textContent = QUIPS[quipIdx];
      el.quip.classList.add('in');
    }, 250);
  };

  // One candy arcs from off to one side into the bucket; the bucket wobbles when it lands.
  const fling = (fromBurst = false) => {
    if (reduced.matches || !visible) return;
    const c = document.createElement('span');
    c.className = 'ld-candy';
    c.textContent = CANDY[Math.floor(Math.random() * CANDY.length)];
    el.flyers.append(c);
    const fr = el.flyers.getBoundingClientRect(), br = el.bucket.getBoundingClientRect();
    const bx = br.left - fr.left + br.width / 2, by = br.top - fr.top + br.height * 0.28;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360);
    let frames;
    if (fromBurst) {
      const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 120;
      frames = [
        { transform: `translate(${bx}px, ${by}px) scale(.4) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${bx + Math.cos(a) * r}px, ${by + Math.sin(a) * r - 40}px) scale(1.3) rotate(${spin}deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${bx + Math.cos(a) * r * 1.2}px, ${by + Math.sin(a) * r + 60}px) scale(1) rotate(${spin * 1.4}deg)`, opacity: 0 },
      ];
    } else {
      const side = Math.random() < 0.5 ? -1 : 1;
      const sx = bx + side * (fr.width * (0.35 + Math.random() * 0.2)), sy = by + 40 + Math.random() * 80;
      const peak = Math.min(sy, by) - 70 - Math.random() * 60;
      frames = [
        { transform: `translate(${sx}px, ${sy}px) scale(.7) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${(sx + bx) / 2}px, ${peak}px) scale(1.15) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${bx}px, ${by}px) scale(.6) rotate(${spin}deg)`, opacity: 1, offset: 0.92 },
        { transform: `translate(${bx}px, ${by + 10}px) scale(.3) rotate(${spin}deg)`, opacity: 0 },
      ];
    }
    const anim = c.animate(frames, { duration: fromBurst ? 1100 : 900 + Math.random() * 300, easing: 'cubic-bezier(.3,.7,.4,1)' });
    anim.onfinish = () => {
      c.remove();
      if (!fromBurst) {
        el.bucket.classList.remove('wobble');
        void el.bucket.offsetWidth; // restart the CSS animation
        el.bucket.classList.add('wobble');
      }
    };
  };

  return {
    show() {
      if (visible) return;
      visible = true;
      shownAt = performance.now();
      target = 0; shownCount = 0; frac = 0; creepTo = 0.05;
      el.title.textContent = 'Plotting the sweetest route';
      el.card.classList.remove('done');
      el.quip.textContent = QUIPS[quipIdx];
      el.quip.classList.add('in');
      root.hidden = false;
      requestAnimationFrame(() => root.classList.add('on'));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
      quipTimer = setInterval(nextQuip, 2600);
      idleTimer = setInterval(() => fling(), 520);
    },
    stage(text, ceiling) {
      el.stage.textContent = text;
      if (ceiling !== undefined) creepTo = Math.max(creepTo, ceiling);
    },
    progress(f, candy) {
      frac = Math.max(frac, f);
      creepTo = Math.max(creepTo, f);
      if (candy > target) {
        for (let i = 0; i < Math.min(5, Math.ceil((candy - target) / 4)); i++) setTimeout(() => fling(), i * 90);
        target = candy;
      }
    },
    // Celebrate, then fade out. Resolves once the map is visible again.
    async finish(candy) {
      if (!visible) return;
      target = candy;
      frac = creepTo = 1;
      clearInterval(idleTimer);
      clearInterval(quipTimer);
      const wait = Math.max(0, MIN_SHOW_MS - (performance.now() - shownAt));
      await sleep(wait);
      el.title.textContent = `≈ ${Math.round(candy)} pieces!`;
      el.card.classList.add('done');
      for (let i = 0; i < 26; i++) fling(true);
      await sleep(reduced.matches ? 300 : 900);
      await this.hide();
    },
    async hide() {
      if (!visible) return;
      visible = false;
      clearInterval(idleTimer);
      clearInterval(quipTimer);
      root.classList.remove('on');
      await sleep(450);
      if (!visible) { root.hidden = true; cancelAnimationFrame(raf); el.flyers.replaceChildren(); }
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bat = (cls) => `
  <svg class="ld-bat ${cls}" viewBox="0 0 64 32" aria-hidden="true">
    <g class="wing l"><path d="M32 16 C24 4 12 4 2 10 C8 12 10 16 8 20 C14 16 20 18 22 22 C24 18 28 18 32 16Z"/></g>
    <g class="wing r"><path d="M32 16 C40 4 52 4 62 10 C56 12 54 16 56 20 C50 16 44 18 42 22 C40 18 36 18 32 16Z"/></g>
    <ellipse cx="32" cy="17" rx="4.5" ry="6"/><path d="M28.5 12 L29.5 7 L31 11 M35.5 12 L34.5 7 L33 11"/>
  </svg>`;

// Little houses along the front hill; windows light up in a wave as the ghost passes.
const HOUSES = [[40, 92], [96, 84], [150, 90], [214, 80], [270, 86], [332, 92], [372, 96]];
const house = ([x, y], i) => `
  <g transform="translate(${x} ${y})">
    <path d="M-11 0 V-12 L0 -21 L11 -12 V0 Z" fill="#0d0a14"/>
    <rect class="win" style="animation-delay:${(i * 0.85).toFixed(2)}s" x="-6" y="-11" width="5" height="5" rx="1"/>
    <rect class="win" style="animation-delay:${(i * 0.85 + 0.15).toFixed(2)}s" x="2" y="-11" width="5" height="5" rx="1"/>
  </g>`;

const TEMPLATE = `
  <div class="ld-sky"></div>
  <div class="ld-moon"></div>
  <div class="ld-stars"></div>
  <div class="ld-fog f1"></div><div class="ld-fog f2"></div>
  ${bat('b1')}${bat('b2')}${bat('b3')}
  <svg class="ld-scene" viewBox="0 0 400 140" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <path d="M0 96 C60 60 110 70 170 84 S280 50 330 70 S390 88 400 80 V140 H0Z" fill="#1a1426"/>
    <path id="ldHill" d="M-20 100 C30 84 70 80 110 88 S180 96 220 82 S300 80 340 94 S400 100 420 96" fill="none"/>
    <path d="M-20 100 C30 84 70 80 110 88 S180 96 220 82 S300 80 340 94 S400 100 420 96 V140 H-20Z" fill="#120e1c"/>
    ${HOUSES.map(house).join('')}
    <g class="ld-ghost">
      <g class="bob">
        <path d="M0 -26 C-9 -26 -12 -18 -12 -10 V2 L-8 -1 L-4 2 L0 -1 L4 2 L8 -1 L12 2 V-10 C12 -18 9 -26 0 -26Z" fill="#f4f0fa"/>
        <circle cx="-4" cy="-15" r="1.8" fill="#14111c"/><circle cx="4" cy="-15" r="1.8" fill="#14111c"/>
        <ellipse cx="0" cy="-9" rx="2" ry="2.6" fill="#14111c"/>
        <g transform="translate(13 -6)"><path d="M-4 0 H4 L3 6 H-3Z" fill="#de7218"/><path d="M-3.5 0 C-3.5 -4 3.5 -4 3.5 0" fill="none" stroke="#f4f0fa" stroke-width="1"/></g>
      </g>
      <animateMotion dur="9s" repeatCount="indefinite"><mpath href="#ldHill"/></animateMotion>
    </g>
  </svg>
  <div class="ld-card" role="status" aria-live="polite">
    <div class="ld-title">Plotting the sweetest route</div>
    <svg class="ld-bucket" viewBox="0 0 120 110" aria-hidden="true">
      <path class="handle" d="M22 40 C22 2 98 2 98 40" fill="none" stroke="#3a2f4d" stroke-width="5" stroke-linecap="round"/>
      <ellipse cx="60" cy="40" rx="40" ry="9" fill="#5a2a08"/>
      <path d="M20 40 C14 70 26 100 60 100 C94 100 106 70 100 40 C88 48 32 48 20 40Z" fill="#de7218"/>
      <path d="M38 46 C34 70 40 92 50 99 M82 46 C86 70 80 92 70 99" fill="none" stroke="#b85b10" stroke-width="2.5"/>
      <g class="face" fill="#ffd36b">
        <path d="M36 58 L46 52 L48 64Z"/><path d="M84 58 L74 52 L72 64Z"/>
        <path d="M36 74 C44 86 76 86 84 74 L76 76 L72 82 L66 77 L60 84 L54 77 L48 82 L44 76Z"/>
      </g>
    </svg>
    <div class="ld-count"><b>0</b> pieces so far</div>
    <div class="ld-bar"><i></i></div>
    <p class="ld-stage">Warming up the broomstick…</p>
    <p class="ld-quip"></p>
  </div>
  <div class="ld-flyers" aria-hidden="true"></div>`;
