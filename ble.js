// Transport. Knows about GATT and newlines; knows nothing about commands.
//
// Two implementations behind one interface: BleTransport talks to the real
// object over Nordic UART, WsTransport talks to tools/webble/bridge.py and a
// local ledsim. The layer above cannot tell them apart, which is what lets
// the whole remote be developed on a laptop.

const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // phone -> device
const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // device -> phone

export class BleTransport {
  constructor() {
    this.device = null;
    this.rx = null;
    this.onLine = () => {};
    this.onDisconnect = () => {};
    this._buf = '';
    this._dec = new TextDecoder();
  }

  get name() { return this.device?.name ?? 'unknown'; }
  get connected() { return this.device?.gatt?.connected === true; }

  static get available() {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  // Bluefy and WebBLE are the only iOS browsers with a Bluetooth stack, and
  // both have the filter bug above. Detected so the first tap works rather
  // than the second.
  static get needsShowAll() {
    if (typeof navigator === 'undefined') return false;
    return /Bluefy|WebBLE/i.test(navigator.userAgent) ||
           /iPhone|iPad|iPod/.test(navigator.userAgent);
  }

  // Bluefy's filter matching is unreliable: the same requestDevice filter
  // that finds a device on Chrome and Android finds nothing there
  // (WebBluetoothCG/web-bluetooth#624). Symptom is an empty picker while a
  // laptop scan shows the device at full signal, which reads as a broken
  // peripheral and sends you off debugging advertising data.
  //
  // So `showAll` skips filters entirely: acceptAllDevices lists every
  // peripheral in range and the user picks by name. optionalServices is then
  // MANDATORY -- without it the connect succeeds and getPrimaryService throws
  // a SecurityError, which looks like a broken device rather than a
  // permissions problem.
  //
  // Must be called from a user gesture; the browser rejects the picker
  // otherwise, and on iOS the failure is quiet enough to look like a bug in
  // the app.
  async connect({ showAll = false } = {}) {
    const opts = showAll
      ? { acceptAllDevices: true, optionalServices: [NUS_SERVICE] }
      : {
          filters: [
            { services: [NUS_SERVICE] },
            { namePrefix: 'MiniSAE' },
          ],
          optionalServices: [NUS_SERVICE],
        };

    this.device = await navigator.bluetooth.requestDevice(opts);
    this.device.addEventListener('gattserverdisconnected', () => {
      this.onDisconnect();
    });
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(NUS_SERVICE);
    this.rx = await svc.getCharacteristic(NUS_RX);
    const tx = await svc.getCharacteristic(NUS_TX);

    tx.addEventListener('characteristicvaluechanged', (e) => {
      this._feed(e.target.value);
    });
    await tx.startNotifications();
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }

  // Replies arrive as a stream of notifications with NO relationship to
  // reply boundaries — a single reply can span forty of them. The device
  // terminates each reply with '\n' (both transports do; see the framing
  // note in firmware/app/src/platform/ble_nus.cpp) and that is the only
  // thing that makes reassembly possible. Do not try to detect the end by
  // parsing JSON: `settings dump` is not JSON, and a reply that overflowed
  // the device's buffer is not balanced.
  _feed(dataView) {
    this._buf += this._dec.decode(dataView, { stream: true });
    let nl;
    while ((nl = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, nl).replace(/\r$/, '');
      this._buf = this._buf.slice(nl + 1);
      if (line.length) this.onLine(line);
    }
  }

  async send(text) {
    if (!this.rx) throw new Error('not connected');
    const bytes = new TextEncoder().encode(text + '\n');
    // Writes are capped by the ATT MTU too. 20 is the safe floor; the device
    // reassembles by newline exactly as we do, so splitting is harmless.
    for (let i = 0; i < bytes.length; i += 20) {
      await this.rx.writeValueWithoutResponse(bytes.slice(i, i + 20));
    }
  }
}

// Same interface, backed by bridge.py. The bridge answers one message per
// message, so framing is trivial here — the newline discipline lives on the
// BLE side where it is actually needed.
export class WsTransport {
  constructor(url) {
    // Scheme must FOLLOW the page. A ws:// socket opened from an https://
    // page is mixed content and browsers block it outright — which matters
    // as soon as the page is served over TLS for a phone, since Web
    // Bluetooth requires a secure context and a LAN IP over plain http is
    // not one.
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = url ?? `${scheme}://${location.hostname}:8081`;
    this.ws = null;
    this.onLine = () => {};
    this.onDisconnect = () => {};
  }

  get name() { return 'ledsim'; }
  get connected() { return this.ws?.readyState === WebSocket.OPEN; }

  connect(_opts) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error(`no bridge at ${this.url}`));
      this.ws.onclose = () => this.onDisconnect();
      this.ws.onmessage = (e) => {
        for (const line of String(e.data).split('\n')) {
          if (line.length) this.onLine(line.replace(/\r$/, ''));
        }
      };
    });
  }

  disconnect() { this.ws?.close(); }

  async send(text) {
    if (!this.connected) throw new Error('not connected');
    this.ws.send(text);
  }
}
