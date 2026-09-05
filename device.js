// The command grammar, and the queue that makes it usable over a radio.
//
// One command in flight at a time. This is not caution, it is forced: replies
// carry no correlation id, so with two outstanding commands there is no way
// to know which reply belongs to which. If the device ever grows a sequence
// tag this can become a proper multiplexer; until then, a queue.

const TIMEOUT_MS = 2500;

// Bumped when this app changes. Shown in Setup so a bug report names a
// version, and so "did my upload go live" has an answer that is not
// "clear your cache and squint".
export const APP_VERSION = '1.3.0';

// The device reports a protocol version covering the command grammar and the
// descriptor shapes. Same major means this app can talk to it; a different
// one means controls may be missing or wrong, which is worth saying plainly
// rather than letting it present as a broken page.
export const PROTO_MAJOR = 1;

export class Device {
  constructor(transport) {
    this.t = transport;
    this.queue = [];
    this.inflight = null;
    this.dumpLines = null;   // accumulator for `settings dump`
    this.onEvent = () => {};

    this.t.onLine = (line) => this._line(line);
  }

  get name() { return this.t.name; }
  get connected() { return this.t.connected; }

  async connect(opts) { await this.t.connect(opts); }
  disconnect() { this.t.disconnect(); }

  // Returns parsed JSON, or the raw text when the reply is not JSON
  // (`settings dump` and the `# ...` error forms).
  send(cmd) {
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, resolve, reject });
      this._pump();
    });
  }

  // Fire-and-forget for things dragged continuously. See coalesce() below.
  sendNow(cmd) { return this.send(cmd).catch(() => null); }

  _pump() {
    if (this.inflight || !this.queue.length) return;
    const job = this.queue.shift();
    this.inflight = job;

    // `settings dump` is the one multi-line reply. It has no terminator of
    // its own; it always ends with the literal line `save`, so that is what
    // we wait for. Everything else is one line.
    this.dumpLines = job.cmd.trim().startsWith('settings dump') ? [] : null;

    job.timer = setTimeout(() => {
      if (this.inflight === job) {
        this.inflight = null;
        job.reject(new Error(`timeout: ${job.cmd}`));
        this._pump();
      }
    }, TIMEOUT_MS);

    this.t.send(job.cmd).catch((e) => {
      clearTimeout(job.timer);
      this.inflight = null;
      job.reject(e);
      this._pump();
    });
  }

  _line(line) {
    const job = this.inflight;
    if (!job) { this.onEvent(line); return; }

    if (this.dumpLines) {
      this.dumpLines.push(line);
      if (line !== 'save' && !line.startsWith('# reply_too_long')) return;
      line = this.dumpLines.join('\n');
    }

    clearTimeout(job.timer);
    this.inflight = null;
    let value = line;
    if (line.startsWith('{')) {
      try { value = JSON.parse(line); } catch { /* keep the raw text */ }
    }
    job.resolve(value);
    this._pump();
  }

  // ---- grammar -----------------------------------------------------------

  effects()   { return this.send('fxlist').then((r) => r.effects ?? []); }
  modInfo()   { return this.send('mod').then((r) => r.mod ?? null); }
  mapInfo()   { return this.send('map info').then((r) => r.info ?? null); }
  s2l()       { return this.send('s2l').then((r) => r.s2l?.params ?? []); }
  cfg()       { return this.send('cfg').then((r) => r.cfg?.params ?? []); }
  diag()      { return this.send('diag').then((r) => r.diag ?? null); }
  version()   { return this.send('ver').then((r) => r.ver ?? null); }

  // Current per-layer parameter VALUES. fxlist describes the effects and
  // gives min/max/def but no live value, so sliders built from it alone open
  // at the default and jump the moment you touch them — on a look that sets
  // level to 195, the slider shows the default until you drag it and the
  // liquid then snaps. `settings` is the only command that reports what each
  // layer is actually set to.
  async layerParams(layer) {
    const r = await this.send('settings').catch(() => null);
    return r?.settings?.layers?.[layer]?.params ?? {};
  }

  setFx(layer, id)        { return this.send(`fx ${layer} ${id}`); }
  setParam(layer, pid, v) { return this.send(`set ${layer} ${pid} ${v}`); }
  setSel(layer, group)    {
    return this.send(group === 'all' ? `sel ${layer} all`
                                     : `sel ${layer} group ${group}`);
  }
  setBlend(layer, mode)   { return this.send(`blend ${layer} ${mode}`); }
  setMod(id)              { return this.send(`mod ${id}`); }
  setModParam(pid, v)     { return this.send(`mod set ${pid} ${v}`); }
  setModSel(group)        {
    return this.send(group === 'all' ? 'mod sel all'
                                     : `mod sel group ${group}`);
  }
  setSpeed(mode)          { return this.send(`mod speed ${mode}`); }
  setS2l(key, v)          { return this.send(`s2l ${key} ${v}`); }
  setCfg(key, v)          { return this.send(`cfg ${key} ${v}`); }
  save()                  { return this.send('save'); }
  load()                  { return this.send('load'); }
  off()                   { return this.send('off'); }
}

// Slider drags produce a command per pixel, and the link delivers roughly one
// packet per connection interval. Without this the queue grows faster than it
// drains and the UI lags seconds behind the thumb.
//
// Trailing edge always fires: the value the user let go on is the one that
// must reach the device, which a plain throttle would drop.
export function coalesce(fn, ms = 60) {
  let timer = null;
  let pending = null;
  return (...args) => {
    pending = args;
    if (timer) return;
    fn(...pending);
    pending = null;
    timer = setTimeout(() => {
      timer = null;
      if (pending) {
        const p = pending;
        pending = null;
        fn(...p);
      }
    }, ms);
  };
}
