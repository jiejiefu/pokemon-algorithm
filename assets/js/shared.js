/**
 * Shared Utilities — Pokémon Algorithm Lab
 * Common functions for loading data, creating cards, etc.
 */

// Type EN → ZH mapping
export const TYPE_EN_ZH = {
  "Normal": "一般", "Fire": "火", "Water": "水", "Electric": "電",
  "Grass": "草", "Ice": "冰", "Fighting": "格鬥", "Poison": "毒",
  "Ground": "地面", "Flying": "飛行", "Psychic": "超能力", "Bug": "蟲",
  "Rock": "岩石", "Ghost": "幽靈", "Dragon": "龍", "Dark": "惡",
  "Steel": "鋼", "Fairy": "妖精"
};

// Type colors
export const TYPE_COLORS = {
  "Normal": "#A8A878", "Fire": "#F08030", "Water": "#6890F0", "Electric": "#F8D030",
  "Grass": "#78C850", "Ice": "#98D8D8", "Fighting": "#C03028", "Poison": "#A040A0",
  "Ground": "#E0C068", "Flying": "#A890F0", "Psychic": "#F85888", "Bug": "#A8B820",
  "Rock": "#B8A038", "Ghost": "#705898", "Dragon": "#7038F8", "Dark": "#705848",
  "Steel": "#B8B8D0", "Fairy": "#EE99AC"
};

// Color badge mapping (used by pokedex cards)
export const BADGE_COLORS = {
  "Red": "#d32f2f",
  "Blue": "#1976d2",
  "Green": "#388e3c",
  "Yellow": "#fbc02d",
  "Purple": "#7b1fa2",
  "Pink": "#c2185b",
  "Brown": "#795548",
  "Black": "#212121",
  "White/Gray": "#9e9e9e"
};

// Paths
export const ASSETS = {
  images: 'assets/images/pokemon/',
  data: 'assets/data/pokemon_data.json',
  sortingAlgos: 'assets/js/sorting-algorithms.js'
};

/**
 * Load Pokémon data from JSON
 * @returns {Promise<Array>} Array of 1025 Pokémon objects
 */
export async function loadPokemonData() {
  const response = await fetch(ASSETS.data);
  if (!response.ok) {
    throw new Error(`Failed to load data: ${response.status}`);
  }
  return await response.json();
}

/**
 * Format Pokémon ID as #0001
 * @param {number} id
 * @returns {string}
 */
export function formatPokemonId(id) {
  return String(id).padStart(4, '0');
}

export function pokemonSlug(pokemon) {
  const name = pokemon?.names?.en || pokemon?.name_en || String(pokemon?.id || '');
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function pokemonDetailPath(pokemon) {
  return `detail/${pokemonSlug(pokemon)}`;
}

export function pokemonDetailUrl(pokemon) {
  return `detail.html?slug=${encodeURIComponent(pokemonSlug(pokemon))}`;
}

export function getReadableTextColor(rgb) {
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111111' : '#ffffff';
}

/**
 * Create a Pokédex card DOM element
 * @param {Object} pokemon - Pokémon data object
 * @param {Object} options - { onClick, showTypes }
 * @returns {HTMLElement}
 */
export function createPokemonCard(pokemon, options = {}) {
  const formattedId = formatPokemonId(pokemon.id);
  const { onClick, showTypes = true } = options;

  const card = document.createElement('div');
  card.className = 'card';
  card.style.cursor = onClick ? 'pointer' : 'default';
  if (Array.isArray(pokemon.rgb) && pokemon.rgb.length === 3) {
    card.style.setProperty('--card-accent-rgb', pokemon.rgb.join(', '));
  }

  // Types HTML
  let typesHtml = '';
  if (showTypes && pokemon.types) {
    typesHtml = `<div class="card-types" style="display:flex;gap:4px;justify-content:center;margin-top:8px;flex-wrap:wrap;">${pokemon.types.map((t, i) => {
      const zh = pokemon.types_zh?.[i] || TYPE_EN_ZH[t] || t;
      const color = TYPE_COLORS[t] || '#777';
      return `<span class="type-badge" style="background:${color};font-size:10px;padding:2px 8px;border-radius:10px;">${zh}</span>`;
    }).join('')}</div>`;
  }

  if (onClick) {
    card.addEventListener('click', () => onClick(pokemon.id));
  }

  card.innerHTML = `
    <img src="${ASSETS.images}${pokemon.filename}" alt="Pokemon ${formattedId}" loading="lazy">
    <div class="card-id">#${formattedId}</div>
    <div class="card-title">${pokemon.names?.zh || `Pokemon ${pokemon.id}`}</div>
    ${typesHtml}
  `;
  return card;
}

/**
 * Render Pokémon cards into a grid container
 * @param {HTMLElement} gridEl - Container element
 * @param {Array} pokemonArray - Array of Pokémon data
 */
export function renderPokemonGrid(gridEl, pokemonArray) {
  gridEl.innerHTML = '';
  const fragment = document.createDocumentFragment();

  pokemonArray.forEach(pokemon => {
    fragment.appendChild(createPokemonCard(pokemon));
  });

  gridEl.appendChild(fragment);
}

/**
 * Create feature card for landing page
 * @param {Object} options - { href, icon, title, desc, className }
 * @returns {HTMLElement}
 */
export function createFeatureCard({ href, icon, title, desc, className }) {
  const card = document.createElement('a');
  card.href = href;
  card.className = `feature-card ${className}`;
  card.innerHTML = `
    <span class="feature-icon">${icon}</span>
    <div class="feature-title">${title}</div>
    <div class="feature-desc">${desc}</div>
  `;
  return card;
}

/**
 * Initialize common header navigation
 * @param {string} currentPage - 'index' | 'sorting' | 'maze' | 'pokedex'
 */
export function initHeaderNav(currentPage) {
  const navContainer = document.querySelector('.header-nav');
  if (!navContainer) return;

  const links = [
    { href: 'sorting.html', label: '🎯 排序演算法', class: 'sort-link', active: currentPage === 'sorting' },
    { href: 'maze.html', label: '🎮 像素迷宮', class: 'maze-link', active: currentPage === 'maze' },
    { href: 'pokedex.html', label: '📖 完整圖鑑', class: 'dex-link', active: currentPage === 'pokedex' }
  ];

  navContainer.innerHTML = links
    .filter(l => l.href !== currentPage + '.html' || currentPage === 'index')
    .map(l => `<a href="${l.href}" class="${l.class} ${l.active ? 'active' : ''}">${l.label}</a>`)
    .join('');
}

/**
 * PokemonNode class for Canvas rendering (used by sorting.html)
 */
export class PokemonNode {
  constructor(data, img, canvasWidth, canvasHeight) {
    this.data = data;
    this.img = img;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.x = canvasWidth / 2;
    this.y = canvasHeight / 2;
    this.targetX = this.x;
    this.targetY = this.y;
    this.size = 24;
  }

  update(speed = 0.15) {
    this.x += (this.targetX - this.x) * speed;
    this.y += (this.targetY - this.y) * speed;
  }

  draw(ctx) {
    if (this.img.complete && this.img.naturalWidth !== 0) {
      ctx.drawImage(this.img, this.x - this.size/2, this.y - this.size/2, this.size, this.size);
    }
  }
}

/**
 * Grid position calculator (40 cols × 26 rows)
 */
export const GRID_CONFIG = {
  COLS: 40,
  ROWS: 26,  // Math.ceil(1025 / 40)
  PADDING_X: 28,
  PADDING_Y: 28,
  CANVAS_WIDTH: 1200,
  CANVAS_HEIGHT: 800
};

export function getGridStartPositions(config = GRID_CONFIG) {
  const START_X = (config.CANVAS_WIDTH - (config.COLS * config.PADDING_X)) / 2 + 14;
  const START_Y = (config.CANVAS_HEIGHT - (config.ROWS * config.PADDING_Y)) / 2 + 14;
  return { START_X, START_Y };
}

export function updateGridPositions(pokemons, config = GRID_CONFIG) {
  const { START_X, START_Y } = getGridStartPositions(config);
  for (let i = 0; i < pokemons.length; i++) {
    const col = i % config.COLS;
    const row = Math.floor(i / config.COLS);
    pokemons[i].targetX = START_X + col * config.PADDING_X;
    pokemons[i].targetY = START_Y + row * config.PADDING_Y;
  }
}

/**
 * Load all 1025 Pokémon images and create PokemonNode instances
 * @param {Array} jsonData - Pokémon data from JSON
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @returns {Promise<Array<PokemonNode>>}
 */
export async function loadAllPokemonNodes(jsonData, canvasWidth, canvasHeight) {
  const imagesPath = ASSETS.images;
  const pokemons = [];
  let loadedCount = 0;

  for (let i = 0; i < jsonData.length; i++) {
    const data = jsonData[i];
    const img = new Image();
    img.src = `${imagesPath}${data.filename}`;

    const node = new PokemonNode(data, img, canvasWidth, canvasHeight);

    await new Promise(resolve => {
      img.onload = () => {
        loadedCount++;
        resolve();
      };
      img.onerror = () => {
        loadedCount++;
        console.warn(`Failed to load image: ${data.filename}`);
        resolve();
      };
    });

    pokemons.push(node);
  }

  return pokemons;
}

/**
 * Color grouping centers for visual clustering
 */
export const COLOR_CENTERS = {
  "Red": {x: 200, y: 220},
  "Orange": {x: 400, y: 220},
  "Yellow": {x: 600, y: 220},
  "Green": {x: 800, y: 220},
  "Blue": {x: 1000, y: 220},
  "Purple": {x: 300, y: 550},
  "Pink": {x: 500, y: 550},
  "Brown": {x: 700, y: 550},
  "Black": {x: 350, y: 700},
  "White/Gray": {x: 850, y: 700}
};

/**
 * Apply color grouping to Pokémon nodes
 * @param {Array<PokemonNode>} pokemons
 */
export function groupByColor(pokemons) {
  pokemons.forEach(p => {
    const group = p.data.color_group || "White/Gray";
    const center = COLOR_CENTERS[group];
    if (center) {
      p.targetX = center.x + (Math.random() - 0.5) * 160;
      p.targetY = center.y + (Math.random() - 0.5) * 160;
    }
  });
}

/**
 * Load evolution chain data
 * @param {number} chainId - Evolution chain ID
 * @returns {Promise<Object|null>} Evolution chain data
 */
export async function loadEvolutionChain(chainId) {
  if (!window._evolutionChains) {
    const response = await fetch('assets/data/evolution_chains.json');
    if (!response.ok) {
      throw new Error(`Failed to load evolution chains: ${response.status}`);
    }
    window._evolutionChains = await response.json();
  }
  return window._evolutionChains[String(chainId)] || null;
}

/**
 * Render evolution chain
 * @param {HTMLElement} container - Container element
 * @param {Object} chainData - Evolution chain data
 * @param {number} currentPokemonId - Current Pokémon ID
 */
export function renderEvolutionChain(container, chainData, currentPokemonId) {
  if (!chainData) {
    container.innerHTML = '<p class="detail-error">暫無進化鏈數據</p>';
    return;
  }

  let html = '<div class="evolution-chain">';

  // Main line
  chainData.main_line.forEach((pokemon, i) => {
    const isCurrent = pokemon.id === currentPokemonId;
    const formBadge = pokemon.form ? `<span class="evolution-form-badge">${pokemon.form.toUpperCase()}</span>` : '';
    const currentClass = isCurrent ? 'evolution-current' : '';

    html += `
      <div class="evolution-stage ${currentClass}">
        <a href="${pokemonDetailUrl(pokemon)}" class="evolution-link">
          <img class="evolution-sprite" src="${ASSETS.images}${pokemon.filename}" alt="${pokemon.name_zh}" loading="lazy">
          <span class="evolution-name">${pokemon.name_zh}</span>
          ${pokemon.form ? `<span class="evolution-form-badge">${pokemon.form.toUpperCase()}</span>` : ''}
        </a>
      </div>
    `;
  });

  // Variants
  if (chainData.variants) {
    Object.entries(chainData.variants).forEach(([region, pokemons]) => {
      if (!pokemons.length) return;
      html += `<div class="evolution-variant-group">
        <div class="evolution-variant-label">${region.toUpperCase()} 形態</div>
        <div class="evolution-chain">`;
      pokemons.forEach(p => {
        const isCurrent = p.id === currentPokemonId;
        html += `
          <div class="evolution-stage ${p.id === currentPokemonId ? 'evolution-current' : ''}">
            <a href="${pokemonDetailUrl(p)}" class="evolution-link">
              <img class="evolution-sprite" src="${ASSETS.images}${p.filename}" alt="${p.name_zh}" loading="lazy">
              <span class="evolution-name">${p.name_zh}</span>
            </a>
          </div>`;
      });
      html += '</div></div>';
    });

    // Special forms (mega, gmax, primal already in main_line)
    if (chainData.special_forms) {
      Object.entries(chainData.special_forms).forEach(([form, pokemons]) => {
        if (!pokemons.length) return;
        html += `<div class="evolution-variant-group">
          <div class="evolution-variant-label">${form.toUpperCase()} 形態</div>
          <div class="evolution-chain">`;
        pokemons.forEach(p => {
          const isCurrent = p.id === currentPokemonId;
          html += `
            <div class="evolution-stage ${p.id === currentPokemonId ? 'evolution-current' : ''}">
              <a href="${pokemonDetailUrl(p)}" class="evolution-link">
                <img class="evolution-sprite" src="${ASSETS.images}${p.filename}" alt="${p.name_zh}" loading="lazy">
                <span class="evolution-name">${p.name_zh}</span>
              </a>
            </div>`;
        });
        html += '</div></div>';
      });
    }

    container.innerHTML = html;
  }
}
