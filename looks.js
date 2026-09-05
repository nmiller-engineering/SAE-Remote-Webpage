// Named looks: a label plus the commands that produce it.
//
// THIS FILE IS IN THE WRONG PLACE AND IS DELIBERATELY THE ONLY ONE.
//
// `solid`, `rainbow` and `liquid` name an effect; `legacy` and `cal` are
// command sequences across several layers and groups, which is exactly what
// `preset` does in firmware/app/src/main.cpp. Putting them here does not fix
// that debt, it duplicates it: the object's looks now live in two places,
// neither of which is the object. They belong on the device, either compiled
// into the .lmap by mapc or held in flash behind `look list` / `look save`.
//
// Kept in one file so retiring it is a single deletion plus a `look list`
// call. Until then: a second object gets the wrong looks.
//
// The liquid and cal sequences are copied from kChampagne[] and kCal[] in
// main.cpp and must stay in step with them. Every magic number below has a
// reason recorded there; the important ones are repeated in comments.

// EVERY look starts by clearing all three layers.
//
// Without this, switching looks leaves the previous one's layers running:
// `legacy` puts blue on the ice via layer 1, and switching to `solid` — which
// only touches layer 0 — leaves the ice blue while the rest turns. That is
// the "only part of the object changes" failure, and it is not a dropped
// command or a flaky link, it is the layers doing exactly what they were told
// and never being told otherwise.
const CLEAR = ['fx 0 0', 'fx 1 0', 'fx 2 0'];

export const LOOKS = [
  {
    key: 'solid',
    label: 'solid',
    // TWO ZONES. Layer 0 paints the whole vessel, layer 1 replaces the ice
    // on top, so each gets its own colour wheel. `zones` is what the Look
    // page renders controls from: one entry per (effect, layer) pair, which
    // is also why a look can no longer be described by a single `fx`.
    zones: [
      { label: 'glass', fx: 'solid', layer: 0 },
      { label: 'ice', fx: 'solid', layer: 1 },
    ],
    cmds: (fx) => [
      ...CLEAR,
      `fx 0 ${fx.solid}`, 'sel 0 all', 'blend 0 replace',
      'set 0 3 16763904',
      `fx 1 ${fx.solid}`, 'sel 1 group ice', 'blend 1 replace',
      'set 1 3 4620980',
    ],
  },
  {
    key: 'rainbow',
    label: 'rainbow',
    zones: [{ label: null, fx: 'rainbow', layer: 0 }],
    cmds: (fx) => [
      ...CLEAR,
      `fx 0 ${fx.rainbow}`, 'sel 0 all', 'blend 0 replace',
    ],
  },
  {
    key: 'liquid',
    label: 'liquid',
    // The wine on layer 1; the grey vessel on layer 0 has only a colour and
    // is not worth a control of its own here.
    zones: [{ label: null, fx: 'liquid', layer: 1 }],
    // kChampagne[] verbatim. The selections are the whole point: the liquid
    // is confined to `glas`, NOT the whole object. On `all` the level drives
    // the neck and base as well, so the waterline creeps up the stem and the
    // rim fills with wine — which is what "fill level steers the neck"
    // looked like.
    cmds: (fx) => [
      ...CLEAR,
      // Layer 1: the vessel itself, grey, everywhere.
      `fx 0 ${fx.solid}`, 'sel 0 all', 'blend 0 replace',
      'set 0 3 8421504',
      // Layer 2: the wine, in the bowl only.
      `fx 1 ${fx.liquid}`, 'sel 1 group glas', 'blend 1 replace',
      'set 1 10 195',
      // 14 mm, not 35. With a 10 mm row pitch this puts EXACTLY ONE LED in
      // the transition at any waterline: white, one fuzzy pixel, yellow.
      'set 1 11 14',
      'set 1 3 16763904', 'set 1 13 8421504',
      // Layer 3: ice, cold blue, replace so the wine does not tint it.
      `fx 2 ${fx.ice}`, 'sel 2 group ice', 'blend 2 replace',
    ],
  },
  {
    key: 'pacman',
    label: 'pacman',
    zones: [{ label: null, fx: 'pacman', layer: 0 }],
    cmds: (fx) => [
      ...CLEAR,
      `fx 0 ${fx.pacman}`, 'sel 0 all', 'blend 0 replace',
    ],
  },
  {
    key: 'legacy',
    label: 'legacy',
    // The whole vessel warm — rim, neck, bowl, base — with the ice cold on
    // top. Selection is `all` rather than `group glas`: the glass is the
    // object, not one section of it.
    cmds: (fx) => [
      ...CLEAR,
      `fx 0 ${fx.solid}`, 'sel 0 all', 'blend 0 replace',
      'set 0 3 16763904',                       // champagne yellow
      `fx 1 ${fx.solid}`, 'sel 1 group ice', 'blend 1 replace',
      'set 1 3 4620980',                        // cold blue
    ],
  },
  {
    key: 'cal',
    label: 'cal',
    // kCal[] verbatim: cal mode 2 over the whole object, one downhill column
    // lit across rings and vertical runs together. Single layer on purpose —
    // every channel must be judged against the same azimuth.
    cmds: (fx) => [
      ...CLEAR,
      `fx 0 ${fx.marble}`, 'sel 0 all', 'blend 0 replace',
      'set 0 14 2',
      'set 0 13 1052688',                       // dim ring 0x101010
      'set 0 3 4194303',                        // bright cyan marker
    ],
  },
];

// Rainbow's axis has no natural slider — three named directions read better
// as buttons. The device reports the range (0..2); these are only labels.
export const RAINBOW_AXES = [
  { value: 0, label: 'around' },
  { value: 1, label: 'top–bottom' },
  { value: 2, label: 'scatter' },
];
