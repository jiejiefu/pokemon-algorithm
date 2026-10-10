/**
 * The collapsible header for graph.html (the 3D knowledge graph).
 *
 * It is a SEPARATE module rather than part of graph.js because it is page chrome,
 * not the 3D controller, and the two have unrelated failure modes: a bug here
 * costs a nav bar, a bug there costs the canvas. It is also the first thing on this
 * site that treats `.header` as a collapsible component, so the shape of it is the
 * thing worth keeping legible.
 *
 * THE STATE IS A CLASS, NOT A VARIABLE. CSS owns the appearance (`is-open` on the
 * header) and this module only flips it, which is the same relationship
 * `.graph-control-panel.is-collapsed` already has with `.graph-open-btn` in this
 * page's own stylesheet. Nothing here reads a width or a scroll position.
 *
 * THREE WAYS TO CLOSE, and the third one is the reason this module exists at all:
 *
 *   1. The toggle button, which is also the only way to OPEN.
 *   2. Escape, so the bar is not a keyboard trap.
 *   3. A click on the canvas — the "空白處" the reader asked for.
 *
 * (3) IS GUARDED BY A 6px MOVEMENT THRESHOLD, and without it the bar is unusable.
 * The WebGL stage fills the viewport, so "clicking outside the nav" IS clicking
 * the canvas — and a canvas drag (orbit the graph) ends with the pointer down and
 * up on the same element, which the DOM reports as a `click`. An unguarded document
 * listener therefore closes the nav every time the reader rotates the camera, which
 * reads as the nav being broken rather than as a nav. `pointerdown` records where
 * the press started and the click only counts if the pointer barely moved: a press
 * is a click, a drag is not.
 *
 * `iconSvg` is imported rather than a glyph written inline, for the reason
 * shared.js's ICON_PATHS comment states: one path, drawn in one place. Both
 * `menu` and `close` are already there, because `initMobileNav()` uses them.
 */
import { iconSvg } from './shared.js';

/** A press that travels further than this is a drag, and a drag is not a click. */
const CLICK_SLOP_PX = 6;

/**
 * Wire the collapsible header.
 *
 * No arguments and no return value: the module finds its own mount points from
 * `.graph-header` and `[data-graph-header-toggle]`, so graph.html's markup is the
 * only thing that has to agree with it. Both are optional in the sense that a page
 * without them is simply not this page — the function returns rather than throwing,
 * the same contract `initKnowledgeGraph()` has for a missing `#graph-container`.
 */
export function initGraphHeader() {
  const header = document.querySelector('.graph-header');
  const toggle = header?.querySelector('[data-graph-header-toggle]');
  if (!header || !toggle) return;

  /* The button's contents are set HERE rather than in the HTML, which is the rule
     initMobileNav() already follows for `.site-nav-toggle`: an icon-less button is
     a blank 40px box until the first click, and a hardcoded pair would be a second
     copy of a glyph shared.js already owns. */
  /* `null`, NOT `false`, and that is not a style choice. The collapsed state is the
     markup's default, so `setOpen(false)` at setup would compare `false === false`,
     early-return, and never draw the first glyph — leaving a blank 40px box on a
     page whose entire collapsed affordance IS that button. `null` is the one value
     that is not a state the header can be in, so the first call always runs and
     paints. This is the "an icon-less button is a blank box before the first click"
     rule initMobileNav() states, arrived at from the other direction. */
  let open = null;

  const setOpen = (next) => {
    if (next === open) return;
    open = next;
    header.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    // The accessible name moves with the state. It is a STABLE name plus
    // aria-expanded for the state, exactly as initThemeToggle() does it: a button
    // that announces "switch to dark theme" while also carrying aria-pressed makes
    // a screen reader read two contradictory things.
    toggle.setAttribute('aria-label', open ? '收合選單' : '開啟選單');
    toggle.setAttribute('title', open ? '收合選單' : '開啟選單');
    toggle.innerHTML = iconSvg(open ? 'close' : 'menu');
  };

  toggle.addEventListener('click', () => setOpen(!open));
  setOpen(false);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) setOpen(false);
  });

  /* Where the press STARTED, not where it ended. Only `pointerdown` on the document
     is recorded, so a pointer that went down inside the nav and up on the canvas
     still reads as an inside press — and the distance check then rejects the drag. */
  let downAt = null;
  document.addEventListener('pointerdown', e => {
    downAt = { x: e.clientX, y: e.clientY };
  }, { passive: true });

  document.addEventListener('click', e => {
    if (!open) return;
    if (header.contains(e.target)) return;
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > CLICK_SLOP_PX) return;
    setOpen(false);
  });

  /* A resize past the breakpoint hands the nav to the mobile drawer, which opens
     BELOW the header. Leaving the bar open across that change would show a drawer
     whose parent just changed shape, so the bar collapses and the drawer closes —
     the same guard initMobileNav() installs for the drawer on its own resize. */
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) {
      setOpen(false);
      document.querySelector('[data-nav-drawer]')?.setAttribute('hidden', '');
    }
  });
}