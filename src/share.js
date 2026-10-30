// Share a link: the phone's native share sheet when there is one, otherwise the clipboard,
// with spooky, over-the-top feedback either way.

const BURST = ['🦇', '🍬', '🦇', '🍭', '🦇', '🍫', '🎃', '🍬'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const COPIED = [
  ['Boo! Link copied 👻', 'Paste it to your fellow trick-or-treaters.'],
  ['Copied! Spread the fright 🦇', 'Your ghouls will thank you.'],
  ["It's in your clipboard… muahaha 🎃", 'Paste it anywhere. If you dare.'],
  ['Link conjured! 🧙', 'Send it to your coven.'],
  ['Copied from beyond the grave 💀', 'Share it before midnight.'],
];
const SHARED = [
  ['Sent into the night 🦇', 'May your route be full of full-size bars.'],
  ['Shared! Happy haunting 🎃', 'The ghouls are on their way.'],
];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// Native share sheets are great on phones; on desktop the OS dialog is more confusing than a copy.
const preferNative = () => matchMedia('(pointer: coarse)').matches;

export async function shareLink({ url, title, button }) {
  if (navigator.share && preferNative()) {
    try {
      await navigator.share({ title, text: 'Our trick-or-treat route 🎃', url });
      celebrate(button, 'Boo! Shared!', pick(SHARED));
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled'; // they closed the share sheet
      // any other failure: fall through to copying
    }
  }
  if (await copyText(url)) {
    celebrate(button, 'Boo! Link copied!', pick(COPIED));
    return 'copied';
  }
  showManual(url);
  return 'manual';
}

async function copyText(text) {
  try {
    if (navigator.clipboard && isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* permission denied: try the old way */ }
  // Plain-http pages have no clipboard API; a selected textarea + execCommand still works.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// Last resort: show the link, pre-selected, so a long-press / Ctrl+C does the job.
function showManual(url) {
  const t = toast(`<b>The clipboard is cursed 🕸️</b><span>Copy this link yourself:</span><input class="toast-link" readonly value="${url.replace(/"/g, '&quot;')}">`, 9000);
  const input = t.querySelector('input');
  input.focus();
  input.select();
}

function celebrate(button, label, [title, sub]) {
  if (button) {
    const old = button.dataset.label || button.textContent;
    button.dataset.label = old;
    button.classList.remove('sparkle');
    void button.offsetWidth; // restart the CSS animation
    button.classList.add('done', 'sparkle');
    button.textContent = `👻 ${label}`;
    clearTimeout(button._reset);
    button._reset = setTimeout(() => { button.classList.remove('done'); button.textContent = old; }, 2200);
    burst(button);
    riseGhost(button);
  }
  toast(`<div class="toast-ghost">👻</div><div><b>${title}</b><span>${sub}</span></div>`, 3000);
}

// A little ghost floats up out of the button, wobbling as it fades into the night.
function riseGhost(el) {
  if (reduced.matches) return;
  const r = el.getBoundingClientRect();
  const g = document.createElement('span');
  g.className = 'fx-ghost';
  g.textContent = '👻';
  document.body.append(g);
  const x = r.left + r.width / 2, y = r.top;
  g.animate([
    { transform: `translate(${x}px, ${y + 10}px) scale(.3)`, opacity: 0 },
    { transform: `translate(${x - 14}px, ${y - 30}px) scale(1.1) rotate(-12deg)`, opacity: 1, offset: 0.25 },
    { transform: `translate(${x + 14}px, ${y - 70}px) scale(1.2) rotate(10deg)`, opacity: 0.9, offset: 0.55 },
    { transform: `translate(${x - 8}px, ${y - 115}px) scale(1.3) rotate(-6deg)`, opacity: 0 },
  ], { duration: 1500, easing: 'ease-out' }).onfinish = () => g.remove();
}

function burst(el) {
  if (reduced.matches) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 18; i++) {
    const c = document.createElement('span');
    c.textContent = BURST[i % BURST.length];
    c.className = c.textContent === '🦇' ? 'fx-candy fx-bat' : 'fx-candy';
    document.body.append(c);
    const x = r.left + r.width * (0.2 + Math.random() * 0.6), y = r.top + r.height / 2;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, d = 60 + Math.random() * 90;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360);
    c.animate([
      { transform: `translate(${x}px, ${y}px) scale(.4)`, opacity: 1 },
      { transform: `translate(${x + Math.cos(a) * d}px, ${y + Math.sin(a) * d}px) scale(1.2) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${x + Math.cos(a) * d * 1.2}px, ${y + Math.sin(a) * d + 70}px) scale(.9) rotate(${spin}deg)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => c.remove();
  }
}

function toast(html, ms) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = html;
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 350); }, ms);
  return t;
}
