/**
 * home-hero.js — the scroll-scrubbed hero clip on index.html
 * ============================================================
 * The hero is a tall scroll track whose sticky layer holds a muted <video>, and
 * how far the reader is through the track is written straight into
 * `video.currentTime`.  The clip is never `play()`-ed.
 *
 * WHY SCRUB AND NOT AUTOPLAY
 * --------------------------
 * Autoplay gives the reader a loop they did not ask for and cannot stop; scrub
 * gives them a clip whose position is a function of where they are.  It also
 * means scrolling UP plays the clip backwards, which falls out of the mechanism
 * rather than being a feature: `currentTime` is a seek, and a seek to a smaller
 * number goes to a smaller number.  A play/pause transport cannot do that
 * without a second implementation of time.
 *
 * THE PROGRESS ARITHMETIC IS AN IDENTITY, NOT A TUNABLE
 * ---------------------------------------------------
 * The track is `TRACK_VH` viewports tall and the sticky layer is one viewport,
 * so the reader scrolls `TRACK_VH - 1` viewports of distance while the layer
 * stays pinned.  Progress is therefore `-rect.top / (rect.height - innerHeight)`
 * and it is clamped at both ends, because the layer releases when the track's
 * own bottom reaches the viewport bottom and a reader mid-drag can briefly
 * report a rect outside that range.  The `-innerHeight` term is the one piece
 * that is easy to drop and impossible to see: without it the denominator is the
 * whole track, progress tops out at about 0.42, and the last three seconds of
 * the clip are unreachable while everything still looks correct.
 *
 * REDUCED MOTION
 * --------------
 * `prefers-reduced-motion: reduce` stops the scrub rather than slowing it, for
 * the reason `PokemonNode.update()` snaps instead of easing: a scroll-coupled
 * video is motion at any speed.  The clip is seeked once to POSTER_TIME and left
 * there — the same frame the poster image shows, so "the still" and "the frozen
 * clip" are the same picture and a reader who toggles the setting mid-scroll
 * does not watch the hero jump.  The track itself collapses to one viewport in
 * CSS, because two viewports of scroll with nothing moving in them is a dead
 * zone rather than a shorter hero.
 *
 * Read once at init AND on the media query's own `change` event, matching
 * `initThemeToggle()`'s OS-listener pattern in shared.js — a reader who turns
 * the OS setting off mid-visit should not have to reload for it to take hold.
 *
 * THE POSTER IS NOT A PRE-PLAY FLASH
 * ----------------------------------
 * Because this module never calls `play()`, the `poster` attribute is not
 * transient: until the first seek, the poster IS what is on screen.  That is
 * three states for one file — the ~200ms before metadata, a reduced-motion
 * reader, and a load that never arrives — and it is why no second fallback
 * asset exists.  A `<video>` whose src is set but whose metadata never lands
 * shows its poster forever, which is the desired outcome, not a silent failure.
 *
 * WHY THERE IS NO TIMEOUT ON THE METADATA WAIT
 * --------------------------------------------
 * Nothing here needs one.  A clip that never loads leaves the poster showing and
 * costs the reader a still image; guessing at a deadline would mean discarding a
 * clip that is 90% downloaded, which is strictly worse than waiting for it.
 *
 * PURE OF THE DATA LAYER, MOSTLY
 * ------------------------------
 * Takes its one input — the generation number — as an argument, so the date
 * arithmetic lives in hero-gen.js and this file never reads a clock.  It is
 * otherwise DOM-only: no fetch, no storage, no import.
 */

/** Height of `.home-hero` as a CSS vh value — the sticky layer inside it is one
 *  viewport, so the scrub range is this minus one.  2.4 viewports rather than
 *  2 because much shorter and the clip is over before a reader has registered
 *  that it moves at all; much longer and the hero becomes the thing a reader
 *  scrolls PAST instead of through. */
const TRACK_VH = 240;

/** A seek smaller than this is a no-op to the decoder, so writing it only wakes
 *  a throttled background tab's video pipeline for a frame it is already
 *  showing.  One frame at 30fps. */
const MIN_SEEK_DELTA = 1 / 30;

const REDUCE_MOTION_MQ = '(prefers-reduced-motion: reduce)';

/** Where the frozen clip sits, in seconds.  It is `build_end` in
 *  make_hero_video.py's timeline — the frame the roster is complete and the
 *  wave has not reached — which is the frame the poster was cut from, so the
 *  reduced-motion hero and the pre-metadata hero are the same picture.  Written
 *  as a fraction of a 10s clip so the two stay in step when the clip's length
 *  changes. */
const POSTER_FRACTION = 0.65;

const reducedMotion = () => window.matchMedia(REDUCE_MOTION_MQ);

/**
 * @param {object} o
 * @param {HTMLElement} o.track    `.home-hero` — the tall scroll track
 * @param {HTMLVideoElement} o.video
 * @param {number} o.durationSeconds expected clip length, for the frozen seek
 */
export function initHomeHero({ track, video, durationSeconds = 10 }) {
  if (!track || !video) return;

  let duration = 0;      // 0 until loadedmetadata; a seek against it is a no-op
  let hasMetadata = false;
  let frozen = null;     // a seek to perform once metadata arrives

  /** Whether a `currentTime` write can land.  Two separate facts, deliberately
   *  not one flag: a clip CAN have loaded and still have no usable duration
   *  (some live or broken encodes report Infinity), and a reader who starts
   *  scrolling before metadata lands is the common case rather than the
   *  exceptional one. */
  const scrubbable = () => hasMetadata && Number.isFinite(duration) && duration > 0;

  // `muted` and `playsInline` are set as PROPERTIES, not attributes, because
  // both are read as live state by the autoplay policy; an attribute set in
  // markup can lose to a previous session's state in some engines, and a
  // rejected play() here would leave the poster up for a reason no reader
  // could act on.
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  // preload="metadata" and not "auto": the scrub needs currentTime, which
  // needs the header, which is all metadata carries.  `auto` would pull 1.2MB
  // of clip for the frames a reader may never scroll to.
  video.preload = 'metadata';

  /**
   * 0 at the top of the track, 1 as the sticky layer is about to release.
   * Reads the rect rather than accumulating scroll deltas: a reader who
   * reloads mid-track, or lands on the page with a restored scroll position,
   * is correct on the first frame instead of scrubbing from zero.
   */
  function progress() {
    const rect = track.getBoundingClientRect();
    const range = rect.height - window.innerHeight;
    if (range <= 0) return 0;
    return Math.min(1, Math.max(0, -rect.top / range));
  }

  function seek(t) {
    if (!scrubbable()) {
      // Park the intent rather than dropping it.  This runs on every scroll
      // tick, and a reader who starts scrolling before metadata lands is the
      // normal case; discarding would freeze them on the poster until the next
      // pixel of scroll.
      frozen = t;
      return;
    }
    frozen = null;
    if (Math.abs(video.currentTime - t) > MIN_SEEK_DELTA) video.currentTime = t;
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  }

  function apply() {
    ticking = false;
    if (reducedMotion().matches) return; // see freeze()
    seek(progress() * duration);
  }

  function settle() {
    hasMetadata = true;
    duration = video.duration;
    if (!scrubbable()) return;  // left showing its poster; see the docblock
    if (frozen !== null) {
      const t = frozen;
      frozen = null;
      video.currentTime = t;
    } else if (reducedMotion().matches) {
      freeze();
    } else {
      onScroll();
    }
  }

  function freeze() {
    const t = POSTER_FRACTION * durationSeconds;
    if (scrubbable()) video.currentTime = t;
    else frozen = t;
  }

  video.addEventListener('loadedmetadata', settle, { once: true });
  video.addEventListener('error', () => {
    // Nothing to recover from and nothing to report: no src is removed and no
    // error text is written, because the poster is still showing and is a
    // finished picture.  A reader who was told 「影片載入失敗」 over a perfectly
    // good still image has been told something untrue.
    hasMetadata = false;
  }, { once: true });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  // Registered with the feature detection initThemeToggle uses, so an engine
  // that only has the deprecated MediaQueryList.addListener still hears it.
  const mq = reducedMotion();
  const onMotionChange = () => {
    if (mq.matches) freeze();
    else onScroll();
  };
  if (mq.addEventListener) mq.addEventListener('change', onMotionChange);
  else if (mq.addListener) mq.addListener(onMotionChange);

  if (mq.matches) freeze();
  else onScroll();
}

/** The height the CSS gives `.home-hero`, as a number the module can assert its
 *  own progress() against.  Exported for check_home_hero.mjs, which compares it
 *  against the rule read out of index.html rather than restating it. */
export const HOME_HERO_TRACK_VH = TRACK_VH;