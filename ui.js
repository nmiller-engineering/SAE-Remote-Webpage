// The UI. Builds itself from what the device reports.
//
// The rule this file follows: no effect name, parameter name or range is
// written here. `fxlist`, `mod`, `s2l` and `cfg` all return the same
// descriptor shape — pid, key, min, max, def, val — so one renderer covers
// all four surfaces, and adding an effect to the firmware gives it controls
// with no change on this side.
//
// The two exceptions are marked where they occur: looks.js (see its header)
// and the rainbow axis labels.

import { coalesce, APP_VERSION, PROTO_MAJOR } from './device.js';
import { LOOKS, RAINBOW_AXES } from './looks.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

// A parameter whose range spans more than 16 bits is a packed RGB colour,
// not a magnitude. Same heuristic pyled.py uses; it lives in one place per
// codebase rather than being a flag on the descriptor.
const isColour = (p) => (p.max - p.min) > 0xffff;


// --- colour wheel ----------------------------------------------------------
//
// Hue around, saturation outward, value on a slider. Painted once per value
// step into an ImageData rather than composited from CSS gradients, because
// the conic-gradient approach cannot represent saturation falling off toward
// the centre and ends up lying about which colour you are picking.
function colorWheel(initial, apply, disabled) {
  const SIZE = 168;
  const wrap = el('div', 'wheel');
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d');

  let [h, sv, v] = rgbToHsv(initial);
  const send = coalesce((rgb) => apply(rgb), 80);

  function paint() {
    const img = ctx.createImageData(SIZE, SIZE);
    const r0 = SIZE / 2;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - r0, dy = y - r0;
        const d = Math.sqrt(dx * dx + dy * dy);
        const i = (y * SIZE + x) * 4;
        if (d > r0) { img.data[i + 3] = 0; continue; }
        const hh = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        const [r, g, b] = hsvToRgbParts(hh, Math.min(1, d / r0), v);
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
        // Feather the last pixel so the rim is not stair-stepped.
        img.data[i + 3] = d > r0 - 1 ? 255 * (r0 - d) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const a = h * Math.PI / 180;
    const rr = sv * r0;
    ctx.beginPath();
    ctx.arc(r0 + Math.cos(a) * rr, r0 + Math.sin(a) * rr, 7, 0, 6.284);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function pick(ev) {
    if (disabled) return;
    const b = cv.getBoundingClientRect();
    const t = ev.touches ? ev.touches[0] : ev;
    const scale = SIZE / b.width;
    const dx = (t.clientX - b.left) * scale - SIZE / 2;
    const dy = (t.clientY - b.top) * scale - SIZE / 2;
    const d = Math.sqrt(dx * dx + dy * dy);
    h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    sv = Math.min(1, d / (SIZE / 2));
    paint();
    send(hsvToRgb(h, sv, v));
  }

  cv.addEventListener('pointerdown', (e) => {
    if (disabled) return;
    cv.setPointerCapture(e.pointerId);
    pick(e);
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.buttons) pick(e);
  });
  // Without this the wheel scrolls the page instead of picking a colour.
  cv.style.touchAction = 'none';

  const val = el('input');
  val.type = 'range';
  val.min = 0; val.max = 100; val.value = Math.round(v * 100);
  val.disabled = disabled;
  val.oninput = () => {
    v = Number(val.value) / 100;
    paint();
    send(hsvToRgb(h, sv, v));
  };

  if (disabled) wrap.classList.add('locked');
  wrap.append(cv, val);
  paint();
  return wrap;
}

function hsvToRgbParts(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = t[Math.floor(h / 60) % 6];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map(Math.round);
}

function hsvToRgb(h, s, v) {
  const [r, g, b] = hsvToRgbParts(h, s, v);
  return (r << 16) | (g << 8) | b;
}

function rgbToHsv(packed) {
  const r = ((packed >> 16) & 255) / 255;
  const g = ((packed >> 8) & 255) / 255;
  const b = (packed & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}

export class UI {
  constructor(dev, root) {
    this.dev = dev;
    this.root = root;
    this.tab = 'look';
    this.state = { effects: [], mod: null, groups: [], look: null, axis: 0 };
    this.renderToken = 0;
    this.liveEls = null;
    this.poll = null;
  }

  async start() {
    const [effects, mod, info, ver] = await Promise.all([
      this.dev.effects(), this.dev.modInfo(), this.dev.mapInfo(),
      // Older firmware has no `ver`; absence is information, not an error.
      this.dev.version().catch(() => null),
    ]);
    this.state.ver = ver;
    this.state.effects = effects;
    this.state.mod = mod;
    this.state.groups = info?.groups ?? [];
    this.state.object = info?.object ?? '';
    this.state.leds = info?.leds ?? 0;
    this.render();
    this.startPolling();
  }

  fxId(name) {
    return this.state.effects.find((e) => e.name === name)?.id ?? 0;
  }

  fxByName(name) {
    return this.state.effects.find((e) => e.name === name) ?? null;
  }

  // diag is cheap and is the only way to see WHY the object looks dim. 2 Hz:
  // often enough to feel live, rare enough to leave the link free for the
  // commands a slider is generating.
  startPolling() {
    clearInterval(this.poll);
    this.poll = setInterval(async () => {
      if (!this.dev.connected) return;
      try {
        this.state.diag = await this.dev.diag();
        this.renderHeader();
        // Update the live numbers IN PLACE. Calling renderBody() here tore
        // the page down and rebuilt it twice a second — and because
        // renderSound() awaits `s2l`, the body sat empty for most of each
        // cycle. That is the flicker, and the reason nothing but the header
        // appeared to work.
        await this.refreshLive();
      } catch { /* a dropped poll is not worth surfacing */ }
    }, 500);
  }

  // Live values only, no DOM rebuild. Cheap enough at 2 Hz and leaves every
  // slider mid-drag alone, which a re-render would not.
  async refreshLive() {
    if (this.tab !== 'sound' || !this.liveEls) return;
    const r = await this.dev.send('s2l').catch(() => null);
    const a = r?.s2l?.live;
    if (!a) return;
    this.liveEls.bpm.textContent = a.conf > 0.2 ? Math.round(a.bpm) : '—';
    this.liveEls.conf.textContent = a.conf.toFixed(2);
    this.liveEls.beats.textContent = String(a.beats);
    if (this.liveEls.note) {
      // Frames arriving but no confident tempo is a different state from a
      // dead microphone, and only one of them is worth acting on.
      this.liveEls.note.textContent = a.beats === 0 && a.thresh === 0
        ? 'No audio yet — silent room, or the microphone is not delivering.'
        : '';
    }
  }

  // ---- rendering ---------------------------------------------------------

  render() {
    this.root.innerHTML = '';
    this.header = el('header');
    this.root.appendChild(this.header);

    const tabs = el('nav', 'tabs');
    for (const [key, label] of [['look', 'Look'], ['pattern', 'Pattern'],
                                ['sound', 'Sound'], ['setup', 'Setup'],
                                ['console', 'Console']]) {
      const b = el('button', this.tab === key ? 'tab on' : 'tab', label);
      b.onclick = () => { this.tab = key; this.render(); };
      tabs.appendChild(b);
    }
    this.root.appendChild(tabs);

    this.body = el('main');
    this.root.appendChild(this.body);
    this.renderHeader();
    this.renderBody();
  }

  renderHeader() {
    if (!this.header) return;
    const d = this.state.diag;
    this.header.innerHTML = '';
    this.header.appendChild(el('span', 'dot' + (this.dev.connected ? ' on' : '')));
    this.header.appendChild(el('span', 'name', this.dev.name));
    const right = el('span', 'meta');
    if (d) {
      // Always lead with the current draw. It used to read just
      // "limiter 0.57", which on the Sound page looks like something to do
      // with audio — it is the POWER limiter, and the same header shows on
      // every tab. Naming the unit removes the ambiguity.
      const clamped = d.scale < 0.995;
      right.textContent = clamped
        ? `${d.est_ma} mA · power-limited ${d.scale.toFixed(2)}×`
        : `${d.est_ma} mA`;
      right.classList.toggle('warn', clamped);
    }
    this.header.appendChild(right);
  }

  renderBody() {
    if (!this.body) return;
    // Renders are async (they read live values from the device). A slower
    // one that has been superseded must not append into the page the newer
    // one has already drawn.
    const token = ++this.renderToken;
    this.body.innerHTML = '';
    this.liveEls = null;
    // renderLook and the others are async (they read live values from the
    // device). Errors are caught here rather than becoming unhandled
    // rejections that leave a half-drawn page with nothing in the console.
    const fn = {
      look: () => this.renderLook(),
      pattern: () => this.renderPattern(),
      sound: () => this.renderSound(),
      setup: () => this.renderSetup(),
      console: () => this.renderConsole(),
    }[this.tab];
    Promise.resolve(fn?.call(this)).then(() => {
      if (token !== this.renderToken) return;
    }).catch((e) => {
      if (token !== this.renderToken) return;
      this.body.appendChild(el('div', 'label', String(e.message ?? e)));
    });
  }

  // Buttons from LOOKS, parameters from the device.
  async renderLook() {
    const grid = el('div', 'grid3');
    for (const look of LOOKS) {
      const b = el('button',
                   this.state.look === look.key ? 'btn on' : 'btn', look.label);
      b.onclick = () => { this.state.lookErr = null; this.applyLook(look); };
      grid.appendChild(b);
    }
    // `off` takes master brightness to zero and remembers the level; `on`
    // restores it. Effects keep running either way, so the object resumes in
    // the same phase. Two buttons rather than one toggle because the state
    // is on the device, and a toggle that disagrees with it is worse than
    // two buttons that always do what they say.
    const onBtn = el('button', 'btn', 'on');
    onBtn.onclick = async () => { await this.dev.send('on'); this.renderBody(); };
    const offBtn = el('button', 'btn dim', 'off');
    offBtn.onclick = async () => { await this.dev.off(); this.renderBody(); };
    grid.append(onBtn, offBtn);
    this.body.appendChild(grid);

    if (this.state.lookErr) {
      const e = el('div', 'label', this.state.lookErr);
      e.style.color = 'var(--danger)';
      this.body.appendChild(e);
    }

    const look = LOOKS.find((l) => l.key === this.state.look);
    if (!look?.zones?.length) return;

    // A look can drive several (effect, layer) pairs — `solid` paints the
    // vessel on layer 0 and the ice on layer 1 — so controls are rendered
    // per zone. Sending everything to one layer is what made liquid's level
    // and glass colour disappear before.
    for (const zone of look.zones) {
      const fx = this.fxByName(zone.fx);
      if (!fx) continue;

      // fxlist gives min/max/def but no live value; `settings` has the
      // values. Without this a slider opens at the default and the object
      // jumps to it the moment you touch it.
      const live = await this.dev.layerParams(zone.layer).catch(() => ({}));

      if (zone.label) this.body.appendChild(el('div', 'label', zone.label));

      if (zone.fx === 'rainbow') {
        const axisSpec = fx.params.find((p) => p.key === 'axis');
        if (axisSpec) {
          this.body.appendChild(el('div', 'label', 'direction'));
          const row = el('div', 'grid3');
          for (const a of RAINBOW_AXES) {
            if (a.value < axisSpec.min || a.value > axisSpec.max) continue;
            const b = el('button',
                         this.state.axis === a.value ? 'btn sm on' : 'btn sm',
                         a.label);
            b.onclick = () => {
              this.state.axis = a.value;
              this.dev.setParam(zone.layer, axisSpec.pid, a.value);
              this.renderBody();
            };
            row.appendChild(b);
          }
          this.body.appendChild(row);
        }
      }

      for (const p of fx.params) {
        if (p.key === 'axis') continue;
        const spec = { ...p, val: live[p.key] ?? p.def };
        this.body.appendChild(
          this.control(spec, (v) => this.dev.setParam(zone.layer, p.pid, v)));
      }
    }
  }

  async renderPattern() {
    // Two slots. Firmware composes both into one mask, each over its own
    // selection, so the natural UI is a slot picker plus the same controls
    // rather than two of everything.
    const slot = this.state.slot ?? 'a';
    const mod = await this.dev.modInfo(slot).catch(() => null);
    if (!mod) return;
    this.state.mod = mod;

    // Show what BOTH slots are running, so switching does not hide the fact
    // that the other one is on — the commonest confusion with two of
    // anything is forgetting the one you cannot see.
    const names = (id) =>
      id === 0 ? 'none'
               : (mod.available.find((m) => m.id === id)?.name ?? String(id));
    const tabs = el('div', 'grid2');
    for (const [key, idx] of [['a', 0], ['b', 1]]) {
      const running = names(mod.slots?.[idx] ?? 0);
      const b = el('button', slot === key ? 'btn sm on' : 'btn sm',
                   `${key.toUpperCase()} · ${running}`);
      b.onclick = () => {
        this.state.slot = key;
        this.state.segs = this.state.segsBySlot?.[key] ?? [];
        this.renderBody();
      };
      tabs.appendChild(b);
    }
    this.body.appendChild(tabs);

    this.body.appendChild(el('div', 'label', 'applies to'));
    const segs = ['all', ...this.state.groups];
    const shown = this.state.allSegs ? segs : segs.slice(0, 3);
    const sel = this.state.segs ?? [];
    const segRow = el('div', 'grid3');
    for (const g of shown) {
      const active = g === 'all' ? sel.length === 0 : sel.includes(g);
      const b = el('button', active ? 'btn sm on' : 'btn sm', g);
      b.onclick = () => {
        this.state.segs = g === 'all' ? []
          : (sel.includes(g) ? sel.filter((x) => x !== g) : [...sel, g]);
        this.state.segsBySlot = { ...(this.state.segsBySlot ?? {}),
                                  [slot]: this.state.segs };
        this.applyModSel();
        this.renderBody();
      };
      segRow.appendChild(b);
    }
    if (!this.state.allSegs && segs.length > 3) {
      const more = el('button', 'btn sm dim', `+${segs.length - 3}`);
      more.onclick = () => { this.state.allSegs = true; this.renderBody(); };
      segRow.appendChild(more);
    }
    this.body.appendChild(segRow);

    const grid = el('div', 'grid4');
    const pick = async (id) => {
      await this.dev.setMod(id, slot);
      this.renderBody();
    };
    const none = el('button', mod.id === 0 ? 'btn on' : 'btn dim', 'none');
    none.onclick = () => pick(0);
    grid.appendChild(none);
    for (const m of mod.available) {
      const b = el('button', m.id === mod.id ? 'btn on' : 'btn', m.name);
      b.onclick = () => pick(m.id);
      grid.appendChild(b);
    }
    this.body.appendChild(grid);

    if (mod.id === 0) return;

    // Speed is engine-wide, not per slot, so it is labelled as such rather
    // than sitting inside a slot's controls where it would look per-slot.
    this.body.appendChild(el('div', 'label', 'speed (both slots)'));
    const speeds = el('div', 'grid3');
    for (const sp of ['slow', 'fast', 's2l']) {
      const b = el('button', mod.speed === sp ? 'btn sm on' : 'btn sm', sp);
      b.onclick = async () => {
        await this.dev.setSpeed(sp);
        this.renderBody();
      };
      speeds.appendChild(b);
    }
    this.body.appendChild(speeds);

    for (const p of mod.params ?? []) {
      this.body.appendChild(
        this.control(p, (v) => this.dev.setModParam(p.pid, v, slot)));
    }
  }

  // Deselecting the last group falls back to `all` rather than selecting
  // nothing: a pattern applied to no LEDs is indistinguishable from a broken
  // pattern, and nobody taps a segment off in order to see nothing.
  applyModSel() {
    return this.dev.setModSel(this.state.segs ?? [], this.state.slot ?? 'a');
  }

  async renderSound() {
    // One `s2l` call carries both the tuning and the live values, so this
    // page works on the device. It used to read the simulator-only `audio`
    // command, which meant the stats were permanently em-dashes on hardware.
    const r = await this.dev.send('s2l').catch(() => null);
    const params = r?.s2l?.params ?? [];
    const a = r?.s2l?.live ?? null;
    this.state.s2lParams = params;
    const stats = el('div', 'stats');
    this.liveEls = {};
    for (const [k, key, v] of [
        ['tempo', 'bpm', a && a.conf > 0.2 ? Math.round(a.bpm) : '—'],
        ['conf', 'conf', a ? a.conf.toFixed(2) : '—'],
        ['beats', 'beats', a ? a.beats : '—']]) {
      const c = el('div', 'stat');
      c.appendChild(el('div', 'k', k));
      const val = el('div', 'v', String(v));
      this.liveEls[key] = val;
      c.appendChild(val);
      stats.appendChild(c);
    }
    this.body.appendChild(stats);
    this.liveEls.note = el('div', 'label', '');
    this.body.appendChild(this.liveEls.note);

    if (!params.length) {
      // `s2l` answers no_audio_service when no detector is attached. Say so
      // rather than rendering an empty page, which reads as a broken app.
      const n = el('div', 'label',
        'No beat detector on this build — the PDM microphone (M10) is not '
        + 'implemented yet, so there is nothing to tune.');
      this.body.appendChild(n);
      return;
    }
    for (const p of params) {
      this.body.appendChild(this.control(p, (v) => this.dev.setS2l(p.key, v)));
    }

    const row = el('div', 'grid2');
    const def = el('button', 'btn sm', 'defaults');
    def.onclick = async () => {
      await this.dev.send('s2l defaults');
      this.renderBody();
    };
    const save = el('button', 'btn sm', 'save');
    save.onclick = () => this.dev.save();
    row.append(def, save);
    this.body.appendChild(row);
  }

  async renderSetup() {
    if (!this.state.cfgParams) {
      this.state.cfgParams = await this.dev.cfg().catch(() => []);
    }
    for (const p of this.state.cfgParams.filter((x) => !x.adv)) {
      this.body.appendChild(this.control(p, (v) => this.dev.setCfg(p.key, v)));
    }

    const d = this.state.diag;
    if (d) {
      const box = el('div', 'meter');
      const budget = this.state.cfgParams.find((x) => x.key === 'budget_ma');
      const pct = budget ? Math.min(100, 100 * d.est_ma / budget.val) : 0;
      box.appendChild(el('div', 'k', 'draw now'));
      const bar = el('div', 'bar');
      const fill = el('div', 'fill');
      fill.style.width = `${pct}%`;
      if (d.scale < 0.995) fill.classList.add('warn');
      bar.appendChild(fill);
      box.appendChild(bar);
      box.appendChild(el('div', 'k',
        `${d.est_ma} mA of ${budget?.val ?? '?'}`));
      this.body.appendChild(box);
    }

    // Versions, last: wanted when something is wrong, in the way otherwise.
    const v = this.state.ver;
    const foot = el('div', 'label');
    foot.style.marginTop = '18px';
    foot.textContent = v
      ? `app ${APP_VERSION} · device ${v.build} · protocol ${v.proto}`
      : `app ${APP_VERSION} · device: no ver command (pre-1.3 firmware)`;
    this.body.appendChild(foot);

    if (v && parseInt(v.proto, 10) !== PROTO_MAJOR) {
      const w = el('div', 'label',
        `Protocol ${v.proto} vs app ${PROTO_MAJOR}.x — some controls may be `
        + 'missing or wrong.');
      w.style.color = 'var(--warn)';
      this.body.appendChild(w);
    }

    const acts = el('div', 'grid2');
    const save = el('button', 'btn sm', 'save to flash');
    save.onclick = () => this.dev.save();
    const load = el('button', 'btn sm dim', 'reload');
    load.onclick = async () => { await this.dev.load(); this.refreshAll(); };
    acts.append(save, load);
    this.body.appendChild(acts);

    // --- radio ------------------------------------------------------------
    // Deliberately above the power section: pairing is a thing you do at a
    // party, the current model is a thing you do once at a bench.
    const ble = await this.dev.send('ble').catch(() => null);
    if (ble?.ble) {
      const b = ble.ble;
      // `secure` says whether this BUILD can bond. Without it "0 paired"
      // reads as "nobody has paired yet" rather than "the link is open and
      // anyone in range can drive this", which is the opposite of reassuring.
      const who = b.secure ? `${b.bonds} paired` : 'OPEN — anyone in range';
      this.body.appendChild(el('div', 'label',
        b.pairing ? `pairing open — ${b.pair_left_s}s`
                  : `radio ${b.enabled ? (b.advertising ? 'discoverable'
                                                        : 'connected only')
                                       : 'off'} · ${who}`));
      const row = el('div', 'grid3');

      // A pairing button on a build with no SMP would open a window that
      // accepts nothing. Disabled rather than hidden, so the absence is
      // visible instead of just missing.
      const pair = el('button',
                      b.secure ? (b.pairing ? 'btn sm on' : 'btn sm')
                               : 'btn sm dim',
                      b.pairing ? 'stop' : 'pair');
      pair.disabled = !b.secure;
      pair.onclick = async () => {
        await this.dev.send(b.pairing ? 'ble nopair' : 'ble pair 60');
        this.renderBody();
      };

      const adv = el('button', 'btn sm', b.advertising ? 'hide' : 'show');
      adv.onclick = async () => {
        // Hiding only stops NEW connections; this one survives. Turning the
        // radio off does not, which is why they are different buttons with
        // different warnings rather than one toggle.
        await this.dev.send(`ble adv ${b.advertising ? 'off' : 'on'}`);
        this.renderBody();
      };

      const off = el('button', 'btn sm danger', 'radio off');
      off.onclick = async () => {
        if (!confirm('Turn the radio off? This disconnects you, and the only '
                   + 'ways back are the IR remote and the USB console.')) return;
        await this.dev.send('ble off').catch(() => null);
      };

      row.append(pair, adv, off);
      this.body.appendChild(row);
    }

    // The three that decide whether the object browns out. `adv` comes from
    // the device, so this gate cannot drift from what the firmware considers
    // dangerous.
    const adv = this.state.cfgParams.filter((x) => x.adv);
    if (!adv.length) return;
    const head = el('div', 'danger');
    head.appendChild(el('span', '', 'Power model'));
    // Two taps in the page, NOT confirm(). A native confirm() is suppressed
    // in some iOS web views, and when it is, it returns undefined and the
    // panel silently stays locked — which looks exactly like a dead button.
    const label = this.state.unlocked ? 'lock'
                : this.state.armed ? 'tap again' : 'unlock';
    const unlock = el('button', 'btn sm danger', label);
    unlock.onclick = () => {
      if (this.state.unlocked) { this.state.unlocked = false; this.state.armed = false; }
      else if (this.state.armed) { this.state.unlocked = true; this.state.armed = false; }
      else { this.state.armed = true; }
      this.renderBody();
    };
    head.appendChild(unlock);
    this.body.appendChild(head);

    if (this.state.armed) {
      const w = el('div', 'label',
        'These set the current limit and the LED current model. Wrong values '
        + 'can brown out or overdraw the object.');
      w.style.color = 'var(--warn)';
      this.body.appendChild(w);
    }

    const wrap = el('div', this.state.unlocked ? '' : 'locked');
    for (const p of adv) {
      wrap.appendChild(this.control(p, (v) => this.dev.setCfg(p.key, v),
                                    !this.state.unlocked));
    }
    this.body.appendChild(wrap);
  }

  renderConsole() {
    const log = el('pre', 'log', this.state.log ?? '');
    const row = el('div', 'row');
    const input = el('input');
    input.placeholder = 'any command…';
    const go = async () => {
      const cmd = input.value.trim();
      if (!cmd) return;
      input.value = '';
      let out;
      try {
        const r = await this.dev.send(cmd);
        out = typeof r === 'string' ? r : JSON.stringify(r, null, 1);
      } catch (e) { out = String(e.message ?? e); }
      this.state.log = `> ${cmd}\n${out}\n\n${this.state.log ?? ''}`;
      log.textContent = this.state.log;
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    const btn = el('button', 'btn sm', 'send');
    btn.onclick = go;
    row.append(input, btn);

    // The list comes from the DEVICE, not from a table in this app: a cheat
    // sheet kept here would drift from the grammar the moment a command was
    // added, and be wrong in the one situation it is consulted.
    const cheat = el('button', 'btn sm dim', 'commands');
    cheat.onclick = async () => {
      const r = await this.dev.send('help').catch(() => null);
      const lines = r?.help;
      this.state.log = lines
        ? lines.join('\n') + '\n\n' + (this.state.log ?? '')
        : 'no help command on this firmware\n\n' + (this.state.log ?? '');
      log.textContent = this.state.log;
    };
    this.body.append(row, cheat, log);
  }

  // One control for every descriptor, on all four surfaces.
  control(p, apply, disabled = false) {
    const row = el('div', 'ctl');
    row.appendChild(el('label', '', p.key));

    if (isColour(p)) {
      // A native <input type=color> opens a full-screen system sheet on iOS:
      // two taps to get there, the object hidden behind it, and no way to
      // see the change while dragging. An inline wheel is one gesture with
      // the glass in view, which is the whole point of a remote.
      row.appendChild(colorWheel(Number(p.val ?? p.def), apply, disabled));
      return row;
    }

    const inp = el('input');
    inp.type = 'range';
    inp.min = p.min;
    inp.max = p.max;
    inp.value = p.val ?? p.def;
    inp.disabled = disabled;
    const out = el('span', 'val', String(inp.value));
    // Coalesced: a drag emits a command per pixel and the link carries about
    // one packet per connection interval.
    const send = coalesce((v) => apply(v), 60);
    inp.oninput = () => { out.textContent = inp.value; send(Number(inp.value)); };
    row.append(inp, out);
    return row;
  }

  async applyLook(look) {
    this.state.look = look.key;
    const byName = Object.fromEntries(
      this.state.effects.map((e) => [e.name, e.id]));
    // Sequential and CHECKED. The queue serialises them anyway, but a
    // command that fails silently leaves the object half-changed and looks
    // like an unreliable radio rather than a rejected command.
    for (const cmd of look.cmds(byName)) {
      const r = await this.dev.send(cmd).catch((e) => ({ err: String(e) }));
      if (r && r.ok === false) {
        this.state.lookErr = `${cmd} -> ${r.err ?? 'failed'}`;
      }
    }
    this.renderBody();
  }

  async refreshAll() {
    this.state.s2lParams = null;
    this.state.cfgParams = null;
    this.state.mod = await this.dev.modInfo();
    this.renderBody();
  }
}
