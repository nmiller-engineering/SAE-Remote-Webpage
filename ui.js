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

import { coalesce } from './device.js';
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

export class UI {
  constructor(dev, root) {
    this.dev = dev;
    this.root = root;
    this.tab = 'look';
    this.state = { effects: [], mod: null, groups: [], look: null, axis: 0 };
    this.poll = null;
  }

  async start() {
    const [effects, mod, info] = await Promise.all([
      this.dev.effects(), this.dev.modInfo(), this.dev.mapInfo(),
    ]);
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
        if (this.tab === 'sound') {
          const a = await this.dev.send('audio').catch(() => null);
          if (a?.audio) this.state.audio = a.audio;
        }
        this.renderHeader();
        if (this.tab === 'sound') this.renderBody();
      } catch { /* a dropped poll is not worth surfacing */ }
    }, 500);
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
      const clamped = d.scale < 0.995;
      right.textContent = clamped ? `limiter ${d.scale.toFixed(2)}`
                                  : `${d.est_ma} mA`;
      right.classList.toggle('warn', clamped);
    }
    this.header.appendChild(right);
  }

  renderBody() {
    if (!this.body) return;
    this.body.innerHTML = '';
    const fn = {
      look: () => this.renderLook(),
      pattern: () => this.renderPattern(),
      sound: () => this.renderSound(),
      setup: () => this.renderSetup(),
      console: () => this.renderConsole(),
    }[this.tab];
    fn?.call(this);
  }

  // Buttons from LOOKS, parameters from the device.
  renderLook() {
    const grid = el('div', 'grid3');
    for (const look of LOOKS) {
      const b = el('button',
                   this.state.look === look.key ? 'btn on' : 'btn', look.label);
      b.onclick = () => this.applyLook(look);
      grid.appendChild(b);
    }
    const offBtn = el('button', 'btn dim', 'off');
    offBtn.onclick = () => { this.state.look = null; this.dev.off(); this.renderBody(); };
    grid.appendChild(offBtn);
    this.body.appendChild(grid);

    const look = LOOKS.find((l) => l.key === this.state.look);
    if (!look?.fx) return;
    const fx = this.fxByName(look.fx);
    if (!fx) return;

    // Rainbow's direction: named buttons over a device-reported range.
    if (look.fx === 'rainbow') {
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
            this.dev.setParam(0, axisSpec.pid, a.value);
            this.renderBody();
          };
          row.appendChild(b);
        }
        this.body.appendChild(row);
      }
    }

    for (const p of fx.params) {
      if (p.key === 'axis') continue;
      this.body.appendChild(
        this.control(p, (v) => this.dev.setParam(0, p.pid, v)));
    }
  }

  renderPattern() {
    const mod = this.state.mod;
    if (!mod) return;

    // Segment row, from map info. Three fit a phone; the rest are real
    // groups and belong behind "more" rather than off the end of a row.
    this.body.appendChild(el('div', 'label', 'applies to'));
    const segs = ['all', ...this.state.groups];
    const shown = this.state.allSegs ? segs : segs.slice(0, 3);
    const segRow = el('div', 'grid3');
    for (const g of shown) {
      const b = el('button',
                   this.state.seg === g || (!this.state.seg && g === 'all')
                     ? 'btn sm on' : 'btn sm', g);
      b.onclick = () => {
        this.state.seg = g;
        this.dev.setModSel(g);
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
    for (const m of mod.available) {
      const b = el('button', m.id === mod.id ? 'btn on' : 'btn', m.name);
      b.onclick = async () => {
        await this.dev.setMod(m.id);
        this.state.mod = await this.dev.modInfo();
        this.renderBody();
      };
      grid.appendChild(b);
    }
    this.body.appendChild(grid);

    const speeds = el('div', 'grid3');
    for (const s of ['slow', 'fast', 's2l']) {
      const b = el('button', mod.speed === s ? 'btn sm on' : 'btn sm', s);
      b.onclick = async () => {
        await this.dev.setSpeed(s);
        this.state.mod = await this.dev.modInfo();
        this.renderBody();
      };
      speeds.appendChild(b);
    }
    this.body.appendChild(speeds);

    for (const p of mod.params ?? []) {
      this.body.appendChild(
        this.control(p, (v) => this.dev.setModParam(p.pid, v)));
    }
  }

  async renderSound() {
    const a = this.state.audio;
    const stats = el('div', 'stats');
    for (const [k, v] of [['tempo', a ? Math.round(a.bpm) : '—'],
                          ['conf', a ? a.conf.toFixed(2) : '—'],
                          ['beats', a ? a.beats : '—']]) {
      const c = el('div', 'stat');
      c.appendChild(el('div', 'k', k));
      c.appendChild(el('div', 'v', String(v)));
      stats.appendChild(c);
    }
    this.body.appendChild(stats);

    if (!this.state.s2lParams) {
      this.state.s2lParams = await this.dev.s2l().catch(() => []);
    }
    for (const p of this.state.s2lParams) {
      this.body.appendChild(this.control(p, (v) => this.dev.setS2l(p.key, v)));
    }

    const row = el('div', 'grid2');
    const def = el('button', 'btn sm', 'defaults');
    def.onclick = async () => {
      await this.dev.send('s2l defaults');
      this.state.s2lParams = await this.dev.s2l();
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
    const unlock = el('button', 'btn sm danger',
                      this.state.unlocked ? 'lock' : 'unlock');
    unlock.onclick = () => {
      this.state.unlocked = !this.state.unlocked
        && confirm('These set the current limit and the LED current model. '
                 + 'Wrong values can brown out or overdraw the object. '
                 + 'Unlock?');
      this.renderBody();
    };
    head.appendChild(unlock);
    this.body.appendChild(head);

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
    this.body.append(row, log);
  }

  // One control for every descriptor, on all four surfaces.
  control(p, apply, disabled = false) {
    const row = el('div', 'ctl');
    row.appendChild(el('label', '', p.key));

    if (isColour(p)) {
      const inp = el('input');
      inp.type = 'color';
      inp.value = '#' + Number(p.val ?? p.def).toString(16).padStart(6, '0');
      inp.disabled = disabled;
      const send = coalesce((v) => apply(v), 80);
      inp.oninput = () => send(parseInt(inp.value.slice(1), 16));
      row.appendChild(inp);
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
    for (const cmd of look.cmds(byName[look.fx], byName)) {
      await this.dev.send(cmd);
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
