# SAE-Remote

Phone remote for the MiniSAE champagne-glass LED object. One page, no build
step, no framework, no dependencies.

**https://nmiller-engineering.github.io/SAE-Remote/**

Open that in **Bluefy** on iPhone — Safari, Chrome and Edge on iOS all use
WebKit and none of them expose Web Bluetooth. On Android or desktop, Chrome
and Edge work directly. Add to Home Screen for an icon.

The page is loaded over the internet **once**. Controlling the object after
that is pure Bluetooth: no WiFi, no laptop, no network. The object cannot
serve this page itself — the nRF52840 has no IP stack, and BLE carries GATT
characteristics rather than HTTP.

## What it does

Generates its own controls from the device. `fxlist`, `mod`, `s2l` and `cfg`
all return the same descriptor shape — `pid`, `key`, `min`, `max`, `def`,
`val` — so one renderer covers every page, and adding an effect to the
firmware gives it sliders here with no change on this side.

| page | |
|---|---|
| Look | named looks, per-effect parameters, colour pickers |
| Pattern | blink patterns, which segment they apply to, speed mode |
| Sound | live tempo and confidence, plus the onset-detector tuning |
| Setup | brightness, live current draw, radio control, power model (locked) |
| Console | any command, for everything without a control |

## Files

`index.html` shell and styles · `ble.js` transport (Nordic UART, notification
reassembly) · `device.js` command grammar and request queue · `ui.js` control
rendering · `looks.js` the one hardcoded table.

## Known iOS quirk

Bluefy's `requestDevice` filter matching is unreliable
([web-bluetooth#624](https://github.com/WebBluetoothCG/web-bluetooth/issues/624)):
a filter that works on Chrome finds nothing there, and the symptom is an empty
picker while a laptop scan shows the object at full signal. The app therefore
uses `acceptAllDevices` on iOS — the picker lists everything in range and you
pick `MiniSAE` by name.

Source of record: the `ledplat` repo, `tools/webble/`.
