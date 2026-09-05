// Named looks: a label plus the commands that produce it.
//
// THIS FILE IS IN THE WRONG PLACE AND IS DELIBERATELY THE ONLY ONE.
//
// `solid`, `rainbow` and `liquid` are effects and come from the device via
// `fxlist`. `cal` and `legacy` are not effects — they are command sequences
// across several layers and groups, which is exactly what `preset` does in
// firmware/app/src/main.cpp. Putting them here does not fix that debt, it
// duplicates it: the object's looks now live in two places, neither of which
// is the object.
//
// They belong on the device, either compiled into the .lmap by mapc or held
// in flash behind `look list` / `look save`. Everything else in this app is
// generated from what the device reports; this is the one hardcoded table,
// kept in one file so moving it is a single deletion plus a `look list` call.
//
// Until then: edit here, and know that a second object gets the wrong looks.

export const LOOKS = [
  {
    key: 'solid',
    label: 'solid',
    // Effect-backed looks name their effect so the UI can show that
    // effect's real parameters underneath, straight from fxlist.
    fx: 'solid',
    cmds: (fxId) => [`fx 0 ${fxId}`, 'sel 0 all', 'blend 0 replace'],
  },
  {
    key: 'rainbow',
    label: 'rainbow',
    fx: 'rainbow',
    cmds: (fxId) => [`fx 0 ${fxId}`, 'sel 0 all', 'blend 0 replace'],
  },
  {
    key: 'liquid',
    label: 'liquid',
    fx: 'liquid',
    cmds: (fxId) => [
      `fx 0 ${fxId}`, 'sel 0 all', 'blend 0 replace',
      'set 0 10 195', 'set 0 11 14',
    ],
  },
  {
    key: 'legacy',
    label: 'legacy',
    // Two layers: the vessel warm, the ice cold, nothing animated. Replace
    // blend on the ice so the glass colour does not tint it.
    cmds: (_, fx) => [
      `fx 0 ${fx.solid}`, 'sel 0 group glas', 'blend 0 replace',
      'set 0 3 16763904',
      `fx 1 ${fx.solid}`, 'sel 1 group ice', 'blend 1 replace',
      'set 1 3 4620980',
    ],
  },
  {
    key: 'cal',
    label: 'cal',
    // Calibration: marble's cal mode paints the axes so the mount matrix can
    // be checked by eye. Full brightness would wash the axes out.
    cmds: (_, fx) => [
      `fx 0 ${fx.marble}`, 'sel 0 all', 'blend 0 replace', 'set 0 13 1',
      'fx 1 0', 'fx 2 0',
    ],
  },
];

// Rainbow's axis param has no natural slider — three named directions read
// better as buttons, and the device reports the range (0..2) so this is only
// the labels.
export const RAINBOW_AXES = [
  { value: 0, label: 'around' },
  { value: 1, label: 'top–bottom' },
  { value: 2, label: 'scatter' },
];
