/*
 * LAZY DOOR FOR THE HOMEPAGE'S TWO DEMOS.
 *
 * `index.html` never loads `pokemon_data.json` (2.8 MB). This module fetches
 * the 90 KB `home_roster.json` once, and only when a demo is within 400 px of
 * the viewport. Both demos share that one promise; neither starts until the
 * reader has actually scrolled past the hero.
 *
 * The same observer pauses a demo when it leaves, and `visibilitychange` pauses
 * it when the tab is hidden. That is what keeps a looping showcase from being
 * a background renderer.
 */

import { spriteUrl } from './color-palette.js';
import { initSortShowcase, initMazeShowcase } from './home-showcase.js';
import { initMazeGame } from './home-maze-game.js';

const ROSTER_URL = 'assets/data/home_roster.json';
const PRELOAD_MARGIN = '400px 0px';

let rosterPromise = null;

function loadRoster() {
  if (!rosterPromise) {
    rosterPromise = fetch(ROSTER_URL).then((response) => {
      if (!response.ok) throw new Error(`home_roster.json: HTTP ${response.status}`);
      return response.json();
    });
  }
  return rosterPromise;
}

function imageUrl(p) {
  return spriteUrl(p.id);
}

function showLoadError(el) {
  if (el.id === 'showcase') {
    for (const id of ['showcase-sort-caption', 'showcase-maze-caption']) {
      const node = document.getElementById(id);
      if (node) node.textContent = '資料載入失敗，請使用本機伺服器開啟';
    }
    return;
  }
  const status = document.getElementById('game-status');
  if (status) status.textContent = '資料載入失敗，請使用本機伺服器開啟';
  const start = document.getElementById('game-start');
  if (start) start.disabled = true;
}

async function initOne(el) {
  try {
    const roster = await loadRoster();
    if (el.id === 'showcase') {
      const sort = initSortShowcase(
        document.getElementById('showcase-sort-stage'),
        roster,
        imageUrl,
        { label: document.getElementById('showcase-sort-caption') },
      );
      const maze = initMazeShowcase(
        document.getElementById('showcase-maze-stage'),
        roster,
        imageUrl,
        {
          setLabel(text) {
            const caption = document.getElementById('showcase-maze-caption');
            if (caption) caption.textContent = text;
          },
        },
      );
      return {
        pause() { sort?.pause(); maze?.pause(); },
        resume() { sort?.resume(); maze?.resume(); },
        destroy() { sort?.destroy(); maze?.destroy(); },
      };
    }
    if (el.id === 'game') {
      return initMazeGame(
        document.getElementById('game-stage'),
        roster,
        imageUrl,
        {
          status: document.getElementById('game-status'),
          subtitle: document.getElementById('game-subtitle'),
          score: document.getElementById('game-score'),
          scoreYou: document.getElementById('game-score-you'),
          scoreAi: document.getElementById('game-score-ai'),
          startBtn: document.getElementById('game-start'),
          againBtn: document.getElementById('game-again'),
          pad: document.getElementById('game-pad'),
        },
      );
    }
    return null;
  } catch (error) {
    console.error('[home] roster failed to load', error);
    showLoadError(el);
    return null;
  }
}

export function initHomeSections() {
  const showcase = document.getElementById('showcase');
  const game = document.getElementById('game');
  if (!showcase && !game) return;

  const handles = new Map();
  const onScreen = new Set();

  function ensure(el) {
    if (!handles.has(el)) handles.set(el, initOne(el));
    return handles.get(el);
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        onScreen.add(entry.target);
        ensure(entry.target).then((handle) => handle?.resume?.());
      } else {
        onScreen.delete(entry.target);
        handles.get(entry.target)?.then((handle) => handle?.pause?.());
      }
    }
  }, { rootMargin: PRELOAD_MARGIN });

  for (const el of [showcase, game]) if (el) observer.observe(el);

  document.addEventListener('visibilitychange', () => {
    for (const el of [showcase, game]) {
      if (!el || !handles.has(el)) continue;
      handles.get(el).then((handle) => {
        if (!handle) return;
        if (document.hidden) handle.pause?.();
        else if (onScreen.has(el)) handle.resume?.();
      });
    }
  });
}
