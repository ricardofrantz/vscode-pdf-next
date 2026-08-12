/**
 * The page-mode wheel, and everything that follows from it.
 *
 * This file exists because the wheel kept regressing. The order lived in one
 * place, the labels in another, the page colours in a third, and "what does
 * Clear mean" in a fourth - so a change to one of them left the other three
 * disagreeing, and the tests only string-matched the source, which cannot tell
 * a working wheel from a broken one.
 *
 * The wheel is now this array. Order, labels, colours, aliases and position all
 * derive from it, and the tests call these functions instead of reading them.
 * To change the wheel, change PAGE_MODES; nothing else needs to know.
 */

/**
 * One turn of the wheel, in press order.
 *
 * `aliases` are settings values that mean the same mode: 'light' and 'dark'
 * both leave pages plain, so they sit where Clear sits, and 'sepia' is the
 * older name for 'reader'. `pageColors` is null when the mode does not repaint
 * the canvas - Clear leaves pages as authored, and Invert is a CSS filter over
 * the canvas rather than a different rendering.
 */
export const PAGE_MODES = Object.freeze([
  Object.freeze({
    value: 'auto',
    label: 'Clear',
    aliases: Object.freeze(['light', 'dark']),
    pageColors: null,
  }),
  Object.freeze({
    value: 'night',
    label: 'Night',
    aliases: Object.freeze(['dark-pages']),
    pageColors: Object.freeze({ background: '#1b1b1b', foreground: '#d6d1c4' }),
  }),
  Object.freeze({
    value: 'inverted',
    label: 'Invert',
    aliases: Object.freeze([]),
    pageColors: null,
  }),
  Object.freeze({
    value: 'reader',
    label: 'Sepia',
    // Warm e-reader sepia: color-preserving comfort mode, distinct from
    // Night's dark rendering.
    aliases: Object.freeze(['sepia']),
    pageColors: Object.freeze({ background: '#f4ecd8', foreground: '#5b4636' }),
  }),
]);

/** How many stops the wheel has, for "3 of 4" readouts. */
export const PAGE_MODE_COUNT = PAGE_MODES.length;

/** Plain pages: the first stop, and where clearing lands. */
export const CLEAR_PAGE_MODE = PAGE_MODES[0].value;

/** Every settings value the viewer accepts, canonical names and aliases. */
export const PAGE_MODE_VALUES = new Set(
  PAGE_MODES.flatMap((mode) => [mode.value, ...mode.aliases]),
);

function modeFor(theme) {
  return PAGE_MODES.find(
    (mode) => mode.value === theme || mode.aliases.includes(theme),
  );
}

/** The wheel stop a settings value belongs to; unknown values read as Clear. */
export function canonicalPageMode(theme) {
  return (modeFor(theme) ?? PAGE_MODES[0]).value;
}

/** Where a mode sits on the wheel, 0-based; unknown values read as Clear. */
export function pageModeIndex(theme) {
  const mode = modeFor(theme);
  return mode ? PAGE_MODES.indexOf(mode) : 0;
}

/** The next stop, wrapping past the last one back to Clear. */
export function nextPageMode(theme) {
  return PAGE_MODES[(pageModeIndex(theme) + 1) % PAGE_MODE_COUNT].value;
}

/** What the toolbar calls this mode. */
export function pageModeLabel(theme) {
  return (modeFor(theme) ?? PAGE_MODES[0]).label;
}

/** Canvas colours PDF.js should render with, or null to leave pages as authored. */
export function pageColorsForPageMode(theme) {
  return modeFor(theme)?.pageColors ?? null;
}

/**
 * Clearing keeps an explicit plain choice ('light'/'dark' stay themselves) and
 * drops any tinted mode back to plain pages.
 */
export function clearedPageMode(theme) {
  return canonicalPageMode(theme) === CLEAR_PAGE_MODE ? theme : CLEAR_PAGE_MODE;
}
