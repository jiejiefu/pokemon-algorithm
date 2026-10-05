/**
 * The autoplay switch, shared by the two cry pages.
 *
 * WHY IT IS ITS OWN FILE
 * ----------------------
 * cries-gen1.html synthesises and cries.html records, and each has its own player
 * and its own state. What they share is this: one preference, one default, and one
 * piece of markup. Written twice it would drift, and the drift would be invisible
 * until one page stopped remembering the reader's choice.
 *
 * WHY IT IS ON BY DEFAULT
 * ----------------------
 * Both pages exist to be skimmed — the point of either is hearing many cries in a
 * row, and on the Generation I page comparing two species means clicking a chip and
 * listening. Autoplay on is what makes that one click.
 *
 * It is also why the control states its own position before the reader touches
 * anything: a page that starts making noise the moment you click a card is startling
 * if you did not know it was going to, so the switch says 「點擊切換時自動播放」 in
 * its own label rather than leaving the reader to discover it.
 *
 * It NEVER plays on load. Both pages call their render path at boot, and only an
 * explicit click reaches `play()` — a page that cries out on open is not a feature.
 *
 * No DOM at import time, no fetch, and no audio: the switch hands the page a
 * boolean and the page keeps its own player. The only storage key it owns is its
 * own, and it is written in a try/catch because a private-mode localStorage throw
 * must not take either page down with it.
 */

const KEY = 'pokemon-algorithm:cry-autoplay';

/** The default, and the value a first-time visit gets. */
export const AUTOPLAY_DEFAULT = true;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'on' ? true : raw === 'off' ? false : AUTOPLAY_DEFAULT;
  } catch {
    return AUTOPLAY_DEFAULT;
  }
}

function write(on) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch { /* private mode: the preference simply does not survive the visit */ }
}

/**
 * Mount the switch into `host` and return a handle.
 *
 * @param {HTMLElement} host    the element the button is inserted into
 * @param {object}      opts
 * @param {string}      opts.label   the switch's own name
 * @param {string}      opts.hint    what it does, in one line
 * @param {Function}    opts.onChange called with the new state, never on mount
 * @returns {{el: HTMLElement, get on(): boolean, set(on: boolean, silent?: boolean): void}}
 */
export function mountAutoplay(host, { label, hint, onChange } = {}) {
  const state = { on: read() };

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'cy-autoplay';
  el.setAttribute('role', 'switch');
  el.setAttribute('aria-checked', String(state.on));
  el.innerHTML =
    '<span class="cy-autoplay-track" aria-hidden="true"></span>' +
    '<span class="cy-autoplay-text"><b></b><span></span></span>';
  el.querySelector('b').textContent = label ?? '自動播放';
  el.querySelector('.cy-autoplay-text span').textContent = hint ?? '點擊切換寶可夢時直接播放一次';

  const set = (on, silent = false) => {
    const next = Boolean(on);
    if (next === state.on && el.getAttribute('aria-checked') === String(next)) return;
    state.on = next;
    el.setAttribute('aria-checked', String(next));
    write(next);
    if (!silent) onChange?.(next);
  };

  el.addEventListener('click', () => set(!state.on));
  host.append(el);

  return {
    el,
    get on() { return state.on; },
    set,
  };
}