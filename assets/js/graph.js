/**
 * 3D Force-Directed Knowledge Graph Controller (graph.html)
 * Built with Three.js and 3d-force-graph.
 */

import { TYPE_COLORS, TYPE_EN_ZH, formatPokemonId, pokemonDetailUrl } from './shared.js';
import { cryUrl, hasCry } from './cry-index.js';

// Cache for generated node canvas textures
const textureCache = new Map();
const imageCache = new Map();

// Audio context for cry playback
let audioContext = null;
let currentAudioSource = null;

function playCry(id, baseId) {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    if (currentAudioSource) {
      try { currentAudioSource.stop(); } catch (e) {}
    }

    const targetId = hasCry(id) ? id : (baseId && hasCry(baseId) ? baseId : null);
    if (!targetId) return;
    const targetUrl = cryUrl(targetId);

    fetch(targetUrl)
      .then(res => res.arrayBuffer())
      .then(buf => audioContext.decodeAudioData(buf))
      .then(decoded => {
        const source = audioContext.createBufferSource();
        source.buffer = decoded;
        const gain = audioContext.createGain();
        gain.gain.value = 0.6;
        source.connect(gain);
        gain.connect(audioContext.destination);
        source.start(0);
        currentAudioSource = source;
      })
      .catch(err => {
        console.warn('Cry play error:', err);
      });
  } catch (err) {
    console.warn('Audio play failed:', err);
  }
}

/**
 * Creates a circular glowing billboard sprite texture for a Pokémon node.
 */
function createNodeTexture(node, isHighlighted = false, isHovered = false) {
  const cacheKey = `${node.id}_${isHighlighted ? 1 : 0}_${isHovered ? 1 : 0}`;
  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey);
  }

  const canvas = document.createElement('canvas');
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const center = size / 2;
  const radius = size * 0.42;

  // Background glow
  const grad = ctx.createRadialGradient(center, center, radius * 0.6, center, center, radius * 1.15);
  const color = node.color || '#38bdf8';
  grad.addColorStop(0, color);
  grad.addColorStop(0.7, color);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(center, center, radius * 1.15, 0, Math.PI * 2);
  ctx.fill();

  // Dark background disc
  ctx.fillStyle = isHighlighted || isHovered ? '#0f172a' : '#020617';
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();

  // Outer border ring
  ctx.strokeStyle = isHighlighted || isHovered ? '#ffffff' : color;
  ctx.lineWidth = isHighlighted || isHovered ? 4 : 2.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = isHighlighted || isHovered ? 14 : 6;
  ctx.stroke();
  ctx.restore();

  // Special outer ring for Legendary / Mythical / Ultra Beast / Mega / Gmax
  if (node.is_legendary || node.is_mythical || node.category === 'mega' || node.category === 'gmax') {
    ctx.save();
    ctx.strokeStyle = node.is_legendary ? '#fbbf24' : (node.is_mythical ? '#f43f5e' : '#a855f7');
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(center, center, radius * 1.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Draw Artwork Image if loaded
  const imgUrl = node.artwork;
  if (!imageCache.has(imgUrl)) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imgUrl;
    img.onload = () => {
      imageCache.set(imgUrl, img);
      textureCache.delete(cacheKey);
      // Re-trigger update
      if (node.__threeObj && node.__threeObj.material) {
        node.__threeObj.material.map = createNodeTexture(node, isHighlighted, isHovered);
        node.__threeObj.material.needsUpdate = true;
      }
    };
    img.onerror = () => {
      // Fallback to sprite
      if (node.sprite && node.sprite !== imgUrl) {
        img.src = node.sprite;
      }
    };
  } else {
    const img = imageCache.get(imgUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, radius * 0.9, 0, Math.PI * 2);
    ctx.clip();
    const pad = size * 0.14;
    ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  textureCache.set(cacheKey, texture);
  return texture;
}

export function initKnowledgeGraph() {
  const container = document.getElementById('graph-container');
  if (!container) return;

  const loadingEl = document.getElementById('graph-loading');
  const countBadge = document.getElementById('graph-count-badge');
  const dossierPanel = document.getElementById('graph-dossier');
  const searchInput = document.getElementById('hud-search');
  const searchResults = document.getElementById('hud-search-results');
  const tooltipEl = document.getElementById('graph-tooltip');

  let rawData = null;
  let activeNodes = [];
  let activeLinks = [];
  let selectedNode = null;
  let hoveredNode = null;
  /* How long the pointer must REST on a node before it highlights. Long enough that a
     sweep across a cluster cancels itself, short enough that a deliberate hover still
     feels like a hover. 120 ms is close to the 150 ms search debounce on this same page
     for the same reason — both exist so that passing over something is not the same as
     choosing it. */
  const HOVER_DEBOUNCE_MS = 120;
  let hoverTimer = 0;
  const highlightNodes = new Set();
  const highlightLinks = new Set();
  /* nodeId -> { nodes: Set of NEIGHBOUR NODE OBJECTS, links: Set of link objects }.
     INVARIANT: rebuilt by applyFilters() in the same breath as every assignment to
     activeNodes/activeLinks. Measured cost of that rebuild: 0.5 ms median, 1.6 ms max,
     against a filter change that already re-renders 1,346 nodes. Anyone adding a new
     place that reassigns activeNodes MUST rebuild this in the same statement — a stale
     map does not throw, it highlights only the hovered node and neighbours, which looks
     exactly like a node with no links. */
  const adjacency = new Map();
  /* id -> node object. Built by applyFilters() in the same pass as `adjacency`, and only
     used to resolve link endpoints into the objects that adjacency stores. */
  const nodeById = new Map();

  let activeGen = 'all';
  let activeRel = 'all';
  let activeType = 'all';
  let activeCat = 'all';

  /* Link styling helper.
   *
   * This map used to carry EIGHT keys for a graph_data.json with TEN link types, and
   * the two it was missing -- type_resonance (1,025) and dual_type (520) -- both fell
   * through to the `|| '#38bdf8'` below, which is `starter_trio`'s colour. So 1,545 of
   * 2,523 links, 61% of everything drawn, was indistinguishable from the starter trio
   * edge it was painted the same as. The fallback is what made it invisible: it is a
   * valid colour, so nothing failed and nothing logged.
   *
   * Every type in the data now has its own entry. check_graph_chip_network.mjs asserts
   * the map covers the data exactly (no missing key, no orphan key), because a map that
   * is a strict subset of the data is a state that looks finished. */
  const linkColors = {
    evolution: '#10b981',
    mega: '#d946ef',
    gmax: '#ef4444',
    regional: '#f59e0b',
    pantheon: '#8b5cf6',
    starter_trio: '#38bdf8',
    pseudo_legendary: '#6366f1',
    form: '#06b6d4',
    paradox_pair: '#e879f9',
    paradox_clade: '#a78bfa',
    mega_type: '#c084fc',
    regional_clade: '#fbbf24',
    // Deliberately dim. These two are the background weave -- 1,545 of the links --
    // and painting them at the strength of the 136 pantheon edges would bury the
    // edges that mean something. They are structure, not content.
    type_resonance: '#1e3a5f',
    dual_type: '#16404d',
  };

  const linkColorFn = (link) => {
    if (highlightLinks.size > 0) {
      return highlightLinks.has(link)
        ? (linkColors[link.type] || '#38bdf8')
        : 'rgba(255, 255, 255, 0.04)';
    }
    const c = linkColors[link.type] || '#38bdf8';
    return c;
  };

  const linkWidthFn = (link) => {
    if (highlightLinks.size > 0) {
      return highlightLinks.has(link) ? 2.5 : 0.5;
    }
    return 1.2;
  };

  // Initialize ForceGraph3D
  const Graph = ForceGraph3D()(container)
    .backgroundColor('#030712')
    .showNavInfo(false)
    .nodeId('id')
    .nodeLabel(node => '') // Custom tooltip handled via hover
    .nodeThreeObject(node => {
      const isHigh = highlightNodes.has(node);
      const isHov = hoveredNode === node || selectedNode === node;
      const texture = createNodeTexture(node, isHigh, isHov);
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      const baseScale = node.is_legendary || node.is_mythical ? 28 : (node.category === 'mega' || node.category === 'gmax' ? 25 : 22);
      const scale = isHov ? baseScale * 1.5 : (isHigh ? baseScale * 1.25 : baseScale);
      sprite.scale.set(scale, scale, 1);
      node.__threeObj = sprite;
      return sprite;
    })
    .linkSource('source')
    .linkTarget('target')
    .linkColor(linkColorFn)
    .linkWidth(linkWidthFn)
    .linkOpacity(0.4)
    .linkDirectionalParticles(link => (highlightLinks.size > 0 && !highlightLinks.has(link) ? 0 : 2))
    .linkDirectionalParticleWidth(1.8)
    .linkDirectionalParticleSpeed(0.005)
    .linkDirectionalParticleColor(link => linkColors[link.type] || '#38bdf8')
    .onNodeClick(node => {
      selectNode(node);
    })
    .onNodeHover((node, prevNode) => {
      container.style.cursor = node ? 'pointer' : 'grab';

      /* HOVER IS DEBOUNCED, AND THE ASYMMETRY IS THE POINT.
       *
       * `onNodeHover` fires on EVERY node-boundary crossing, so sweeping the pointer
       * across a dense cluster fires it dozens of times a second. Each of those did an
       * O(links x nodes) rescan, a full 1,346-node material write and a re-evaluation of
       * all 2,523 links — so the visual result was not one fast animation but dozens of
       * INSTANT snaps stacking on top of each other. That is what reads as harsh; there
       * was no transition to slow down, because `updateNodeScales()` writes scale and
       * opacity directly with nothing in between.
       *
       * The cursor is deliberately left OUTSIDE the debounce: it is feedback about where
       * the pointer is, and 120 ms of lag on a cursor is a 120 ms lag on the pointer.
       * Leaving a node is immediate too, for the same reason in reverse — the highlight
       * should not outlive the thing the pointer left. Only ARRIVING is deferred, which
       * is exactly the case a sweep gets wrong: A -> B -> C inside 120 ms schedules,
       * cancels, schedules, and nothing is ever highlighted.
       */
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = 0; }

      if (!node) {
        hoveredNode = null;
        hideTooltip();
        if (!selectedNode) {
          clearHighlight();
        }
        return;
      }

      hoverTimer = setTimeout(() => {
        hoverTimer = 0;
        hoveredNode = node;
        showTooltip(node);
        if (!selectedNode) {
          updateHighlight(node);
        }
      }, HOVER_DEBOUNCE_MS);
    })
    .onBackgroundClick(() => {
      deselectNode();
    });

  // Adjust physics forces for expansive cosmic structure
  Graph.d3Force('charge').strength(-140);
  Graph.d3Force('link').distance(link => {
    if (link.type === 'evolution') return 45;
    if (link.type === 'mega' || link.type === 'gmax') return 35;
    if (link.type === 'regional') return 40;
    if (link.type === 'starter_trio') return 55;
    if (link.type === 'pantheon') return 70;
    /* The three intra-category families exist to give a category filter something
     * to draw, so their distance is chosen for what the reader sees when a chip is
     * pressed and NOTHING ELSE is on screen -- not for how the links look against
     * the full 1,346-node graph.
     *
     * 30 for mega_type is shorter than evolution's 45 on purpose: when 超級進化 is
     * the only filter active, those 136 edges ARE the layout, and at 45 the 93
     * sprites spread into overlapping clumps that read as one dark mass instead of
     * 18 attribute constellations. A shorter link also outranks the -140 charge,
     * which is what a 93-component pile needs. */
    if (link.type === 'mega_type') return 30;
    if (link.type === 'paradox_pair') return 38;
    if (link.type === 'paradox_clade') return 30;
    if (link.type === 'regional_clade') return 32;
    return 60;
  });

  // Cosmic Background Starfield
  const scene = Graph.scene();
  const starsGeometry = new THREE.BufferGeometry();
  const starCount = 2000;
  const starCoords = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount * 3; i += 3) {
    starCoords[i] = (Math.random() - 0.5) * 2800;
    starCoords[i + 1] = (Math.random() - 0.5) * 2800;
    starCoords[i + 2] = (Math.random() - 0.5) * 2800;

    // Subtle blue, violet, and gold stars
    const r = 0.5 + Math.random() * 0.5;
    const g = 0.6 + Math.random() * 0.4;
    const b = 0.8 + Math.random() * 0.2;
    starColors[i] = r;
    starColors[i + 1] = g;
    starColors[i + 2] = b;
  }

  starsGeometry.setAttribute('position', new THREE.BufferAttribute(starCoords, 3));
  starsGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

  const starsMaterial = new THREE.PointsMaterial({
    size: 2.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  const starField = new THREE.Points(starsGeometry, starsMaterial);
  scene.add(starField);

  // Auto-rotation (Cosmic Orbit)
  let isOrbiting = true;
  let angle = 0;
  const orbitDistance = 450;

  function orbitLoop() {
    if (isOrbiting && !selectedNode) {
      angle += 0.0012;
      const x = orbitDistance * Math.sin(angle);
      const z = orbitDistance * Math.cos(angle);
      Graph.cameraPosition({ x, y: 120, z }, { x: 0, y: 0, z: 0 });
    }
    requestAnimationFrame(orbitLoop);
  }
  requestAnimationFrame(orbitLoop);

  // Fetch Graph Data
  fetch('assets/data/graph_data.json')
    .then(res => res.json())
    .then(data => {
      rawData = data;
      applyFilters();
      if (loadingEl) loadingEl.classList.add('is-hidden');
    })
    .catch(err => {
      console.error('Failed to load graph data:', err);
      if (loadingEl) {
        loadingEl.innerHTML = `<p style="color:#ef4444;font-weight:700;">載入知識圖譜失敗: ${err.message}</p>`;
      }
    });

  // Filter Pipeline
  function applyFilters() {
    if (!rawData) return;

    let filteredNodes = rawData.nodes;

    // Filter by Generation
    if (activeGen !== 'all') {
      const genNum = parseInt(activeGen, 10);
      filteredNodes = filteredNodes.filter(n => n.generation === genNum);
    }

    // Filter by Type
    if (activeType !== 'all') {
      filteredNodes = filteredNodes.filter(n => n.types && n.types.includes(activeType));
    }

    // Filter by Category
    if (activeCat !== 'all') {
      filteredNodes = filteredNodes.filter(n => n.category === activeCat);
    }

    const nodeIds = new Set(filteredNodes.map(n => n.id));

    // Filter Links
    let filteredLinks = rawData.links.filter(l => {
      const srcId = typeof l.source === 'object' ? l.source.id : l.source;
      const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
      return nodeIds.has(srcId) && nodeIds.has(tgtId);
    });

    // Filter by Relationship Type
    if (activeRel !== 'all') {
      filteredLinks = filteredLinks.filter(l => l.type === activeRel);
    }

    activeNodes = filteredNodes;
    activeLinks = filteredLinks;

    /* NEIGHBOUR LOOKUP IS A MAP, BUILT ONCE PER FILTER CHANGE — and it is NOT a
     * performance fix on this dataset, which is worth saying plainly because the shape of
     * the data makes the obvious reading wrong.
     *
     * The old `updateHighlight()` iterated every link and ran `activeNodes.find(...)`
     * for the ones that touched the hovered node. The `find` is INSIDE that `if`, so it
     * runs degree() times, not links() times — the "2,523 x 1,346 per hover" reading of
     * it is wrong. Measured over graph_data.json: degree is **median 4, p90 6, max 32**
     * (藍鴉 #822), so the worst case was ~45,595 cheap comparisons, and `selectNode()`
     * measured **1.2 ms before and 1.2 ms after** this change.
     *
     * So why do it? The `find`'s guard could not fail — the filter above keeps only links
     * whose BOTH endpoints are in `nodeIds`, so every endpoint is in `activeNodes` — and
     * a guard that cannot fail is a cost with no behaviour attached to it. What is left
     * is O(degree) instead of O(links + degree x nodes), which is the shape to have
     * before a dataset arrives with hubs in the thousands rather than the dozens this
     * one has. **Anyone reading this expecting a faster page is reading the wrong note.**
     *
     * Built here rather than lazily because this is the ONE place activeNodes and
     * activeLinks are assigned, and it runs once per filter change instead of once per
     * hover. Before `Graph.graphData()` is called, so `link.source` is still a raw id
     * and no `typeof === 'object'` unwrapping is needed here.
     *
     * `nodes` holds NODE OBJECTS, not ids, so `updateHighlight()` does no lookup at all
     * and cannot half-fail on a missing entry. */
    adjacency.clear();
    nodeById.clear();

    /* A hover scheduled against the PREVIOUS graph is about to describe a node that is
       no longer on screen. Cancelling it here is 3 lines and the alternative is a tooltip
       for a species the reader can no longer see, with nothing in the console. */
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = 0; }

    for (const n of activeNodes) nodeById.set(n.id, n);
    for (const link of activeLinks) {
      const srcId = typeof link.source === 'object' ? link.source.id : link.source;
      const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
      const src = nodeById.get(srcId);
      const tgt = nodeById.get(tgtId);
      /* Both endpoints resolve, always, for the reason in the note above. The guard is
         still written because a Set of `undefined` would be a silent wrong picture, and
         that failure has no console output. */
      if (!src || !tgt) continue;
      let e = adjacency.get(srcId);
      if (!e) adjacency.set(srcId, e = { nodes: new Set(), links: new Set() });
      e.links.add(link);
      e.nodes.add(tgt);
      e = adjacency.get(tgtId);
      if (!e) adjacency.set(tgtId, e = { nodes: new Set(), links: new Set() });
      e.links.add(link);
      e.nodes.add(src);
    }

    Graph.graphData({
      nodes: activeNodes,
      links: activeLinks,
    });

    if (countBadge) {
      countBadge.textContent = `${activeNodes.length} 實體 · ${activeLinks.length} 關係`;
    }

    refreshSearchIndex();
  }

  // Update Highlighted Subnetwork
  /* O(degree) instead of O(links + degree x nodes). The difference is 1.2 ms against
     1.2 ms on this dataset — see the note in applyFilters() for why the number is small
     and what the change is actually for. What matters here is that the neighbours added
     are the SAME OBJECTS the old `activeNodes.find(...)` returned, because `adjacency`
     is built from `nodeById`, which is built from `activeNodes`. A Set of clones would
     highlight nothing and look like a dead feature.

     A node with no entry in `adjacency` is one with no links in the current filter: it
     highlights itself and nothing else, which is correct rather than a failure. */
  function updateHighlight(targetNode) {
    highlightNodes.clear();
    highlightLinks.clear();

    if (!targetNode) return;

    highlightNodes.add(targetNode);

    const entry = adjacency.get(targetNode.id);
    if (entry) {
      for (const neighbor of entry.nodes) highlightNodes.add(neighbor);
      for (const link of entry.links) highlightLinks.add(link);
    }

    updateNodeScales();
    Graph.linkColor(linkColorFn).linkWidth(linkWidthFn);
  }

  function clearHighlight() {
    highlightNodes.clear();
    highlightLinks.clear();
    updateNodeScales();
    Graph.linkColor(linkColorFn).linkWidth(linkWidthFn);
  }

  function updateNodeScales() {
    activeNodes.forEach(node => {
      if (node.__threeObj) {
        const isHigh = highlightNodes.has(node);
        const isHov = hoveredNode === node || selectedNode === node;
        const base = node.is_legendary || node.is_mythical ? 28 : (node.category === 'mega' || node.category === 'gmax' ? 25 : 22);
        const scale = isHov ? base * 1.5 : (isHigh ? base * 1.25 : (highlightNodes.size > 0 ? base * 0.7 : base));
        node.__threeObj.scale.set(scale, scale, 1);
        node.__threeObj.material.opacity = highlightNodes.size > 0 && !isHigh ? 0.25 : 1.0;
      }
    });
  }

  // Focus and Select a Node
  function selectNode(node) {
    selectedNode = node;
    isOrbiting = false;
    updateHighlight(node);

    // Camera fly-to
    const distance = 95;
    const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
    Graph.cameraPosition(
      { x: node.x * distRatio, y: node.y * distRatio + 15, z: node.z * distRatio },
      node,
      1400
    );

    renderDossier(node);
    playCry(node.id, node.base_id);
  }

  function deselectNode() {
    selectedNode = null;
    clearHighlight();
    if (dossierPanel) dossierPanel.classList.remove('is-active');
  }

  // Dossier Card Rendering
  function renderDossier(node) {
    if (!dossierPanel) return;

    dossierPanel.classList.add('is-active');

    const artworkEl = document.getElementById('dossier-artwork');
    const idEl = document.getElementById('dossier-id');
    const genEl = document.getElementById('dossier-gen');
    const nameZhEl = document.getElementById('dossier-name-zh');
    const nameEnJaEl = document.getElementById('dossier-name-en-ja');
    const typesEl = document.getElementById('dossier-types');
    const statsEl = document.getElementById('dossier-stats');
    const neighborsEl = document.getElementById('dossier-neighbors-list');
    const cryBtn = document.getElementById('dossier-cry-btn');
    const linkDetail = document.getElementById('dossier-link-detail');
    const linkColor = document.getElementById('dossier-link-color');

    if (artworkEl) {
      artworkEl.src = node.artwork;
      artworkEl.alt = node.name;
    }
    if (idEl) idEl.textContent = formatPokemonId(node.id > 1025 ? node.base_id : node.id);
    if (genEl) genEl.textContent = `第 ${node.generation} 世代`;
    if (nameZhEl) nameZhEl.textContent = node.name;
    if (nameEnJaEl) nameEnJaEl.textContent = `${node.name_en} · ${node.name_ja}`;

    // Types
    if (typesEl) {
      typesEl.innerHTML = (node.types || []).map((t, idx) => {
        const zh = node.types_zh ? node.types_zh[idx] : TYPE_EN_ZH[t] || t;
        const color = TYPE_COLORS[t] || '#777';
        return `<span class="dossier-type-badge" style="background:${color}">${zh}</span>`;
      }).join('');
    }

    // Stats Bars
    if (statsEl) {
      const stats = node.stats || {};
      const statMap = [
        { key: 'hp', label: 'HP', val: stats.hp || 0, max: 255, col: '#ef4444' },
        { key: 'attack', label: '物攻', val: stats.attack || 0, max: 190, col: '#f97316' },
        { key: 'defense', label: '物防', val: stats.defense || 0, max: 230, col: '#eab308' },
        { key: 'sp_attack', label: '特攻', val: stats.sp_attack || 0, max: 194, col: '#3b82f6' },
        { key: 'sp_defense', label: '特防', val: stats.sp_defense || 0, max: 230, col: '#10b981' },
        { key: 'speed', label: '速度', val: stats.speed || 0, max: 200, col: '#ec4899' },
      ];

      statsEl.innerHTML = statMap.map(s => `
        <div class="stat-row">
          <span class="stat-label">${s.label}</span>
          <div class="stat-bar-track">
            <div class="stat-bar-fill" style="width:${Math.min(100, (s.val / s.max) * 100)}%; background:${s.col}"></div>
          </div>
          <span class="stat-val">${s.val}</span>
        </div>
      `).join('') + `
        <div class="stat-row" style="margin-top:4px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.08);">
          <span class="stat-label" style="font-weight:700; color:#fff;">總和</span>
          <div style="flex:1;"></div>
          <span class="stat-val" style="color:var(--graph-accent); font-weight:800; font-size:13px;">${stats.total || 0}</span>
        </div>
      `;
    }

    // Connected Neighbors
    if (neighborsEl) {
      const neighborLinks = [];
      activeLinks.forEach(link => {
        const srcId = typeof link.source === 'object' ? link.source.id : link.source;
        const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
        if (srcId === node.id || tgtId === node.id) {
          const otherId = srcId === node.id ? tgtId : srcId;
          const otherNode = activeNodes.find(n => n.id === otherId);
          if (otherNode) {
            neighborLinks.push({ node: otherNode, link });
          }
        }
      });

      if (neighborLinks.length === 0) {
        neighborsEl.innerHTML = `<span style="font-size:11px; color:var(--graph-text-muted);">無鄰近直接關係</span>`;
      } else {
        neighborsEl.innerHTML = neighborLinks.slice(0, 8).map(nl => `
          <div class="neighbor-card" data-nid="${nl.node.id}">
            <img src="${nl.node.artwork}" alt="${nl.node.name}">
            <div class="neighbor-card-info">
              <span class="neighbor-card-name">${nl.node.name}</span>
              <span class="neighbor-card-rel">${nl.link.label || '關聯'}</span>
            </div>
          </div>
        `).join('');

        // Wire click handlers for neighbor cards
        neighborsEl.querySelectorAll('.neighbor-card').forEach(card => {
          card.addEventListener('click', () => {
            const nid = parseInt(card.dataset.nid, 10);
            const target = activeNodes.find(n => n.id === nid);
            if (target) selectNode(target);
          });
        });
      }
    }

    // Cry button
    if (cryBtn) {
      cryBtn.onclick = () => playCry(node.id, node.base_id);
    }

    // Links to detail and color pages
    if (linkDetail) {
      linkDetail.href = `detail.html?slug=${node.slug}`;
    }
    if (linkColor) {
      linkColor.href = `color.html?slug=${node.slug}`;
    }
  }

  // Tooltip
  function showTooltip(node) {
    if (!tooltipEl) return;
    tooltipEl.innerHTML = `
      <img src="${node.artwork}" style="width:24px;height:24px;object-fit:contain;">
      <span><strong>#${formatPokemonId(node.id > 1025 ? node.base_id : node.id)}</strong> ${node.name}</span>
    `;
    tooltipEl.classList.add('is-visible');
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.remove('is-visible');
  }

  window.addEventListener('mousemove', e => {
    if (tooltipEl && tooltipEl.classList.contains('is-visible')) {
      tooltipEl.style.left = `${e.clientX}px`;
      tooltipEl.style.top = `${e.clientY}px`;
    }
  });

  // Search autocomplete
  let searchTimeout = null;
  function refreshSearchIndex() {
    if (!searchInput) return;
    searchInput.oninput = () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = searchInput.value.trim().toLowerCase();
        if (!query) {
          if (searchResults) searchResults.classList.remove('is-open');
          return;
        }

        const hits = activeNodes.filter(n =>
          n.name.toLowerCase().includes(query) ||
          n.name_en.toLowerCase().includes(query) ||
          String(n.id).includes(query) ||
          formatPokemonId(n.id).includes(query)
        ).slice(0, 10);

        if (searchResults) {
          if (hits.length === 0) {
            searchResults.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--graph-text-muted);text-align:center;">查無相關寶可夢</div>`;
          } else {
            searchResults.innerHTML = hits.map(h => `
              <div class="search-item" data-id="${h.id}">
                <img src="${h.artwork}" alt="${h.name}">
                <div class="search-item-info">
                  <span class="search-item-name">${h.name}</span>
                  <span class="search-item-meta">#${formatPokemonId(h.id)} · ${h.name_en}</span>
                </div>
              </div>
            `).join('');

            searchResults.querySelectorAll('.search-item').forEach(el => {
              el.addEventListener('click', () => {
                const id = parseInt(el.dataset.id, 10);
                const target = activeNodes.find(n => n.id === id);
                if (target) {
                  selectNode(target);
                  searchResults.classList.remove('is-open');
                  searchInput.value = target.name;
                }
              });
            });
          }
          searchResults.classList.add('is-open');
        }
      }, 150);
    };
  }

  // Filter Buttons Binding
  //
  // EVERY ROW TOGGLES: pressing the row's active chip again returns it to its
  // "all" value, which is what a reader expects from a control that looks
  // pressed. 屬性共振 had this from the start and the other three did not, so the
  // same idea was in the file four times in two shapes until now.
  //
  // THE THREE NEW ONES SHARE ONE HELPER, and the shared shape is the point rather
  // than tidiness: they differ only in the ATTRIBUTE and the "no filter" VALUE
  // (`data-filter-gen` / 'all', `data-filter-rel` / 'all', `data-filter-cat` /
  // 'all'), and a fourth copy is a fourth place for the toggle to be missing. The
  // GENERATION row is the one that shows why it matters -- its "no filter" value is
  // 'all' like the others, but the row it resets is the generation, not the
  // relation, and a copy-paste that forgot which `active*` it was writing would
  // leave a chip lit that no longer drives anything.
  //
  // Clicking the row's own "all" chip is NOT a toggle back to itself: it sets the
  // same value, the chip is re-marked active, and nothing appears to happen --
  // which is correct, and the reason it is worth saying rather than leaving to be
  // discovered.
  const bindFilterRow = (attr, noFilter, get, set) => {
    const buttons = [...document.querySelectorAll(`[${attr}]`)];
    const allChip = buttons.find((b) => b.getAttribute(attr) === noFilter);

    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        const value = btn.getAttribute(attr);
        const isSameActive = get() === value;

        for (const b of buttons) b.classList.remove('is-active');

        if (isSameActive && value !== noFilter) {
          set(noFilter);
          if (allChip) allChip.classList.add('is-active');
        } else {
          btn.classList.add('is-active');
          set(value);
        }
        applyFilters();
      });
    }
  };

bindFilterRow('data-filter-gen', 'all', () => activeGen, (v) => { activeGen = v; });
  bindFilterRow('data-filter-rel', 'all', () => activeRel, (v) => { activeRel = v; });
  bindFilterRow('data-filter-cat', 'all', () => activeCat, (v) => { activeCat = v; });

  /* 屬性共振 now goes through the same helper. It was the ONE row that already
   * toggled -- pressing 火 twice cleared it -- so converting it loses nothing, and
   * what it gains is that the toggle is now in one place instead of two. A row
   * with its own copy of the guard is a row whose guard can be forgotten when the
   * next row is added. */
  bindFilterRow('data-filter-type', 'all', () => activeType, (v) => { activeType = v; });

  /* The button colour comes from shared.js's TYPE_COLORS rather than from an
   * inline style in graph.html. Those 18 hex values were the THIRD copy of that
   * table (build_graph_data.py has its own `type_colors` for the node colours), and
   * a copy that goes stale tints a button the wrong colour with nothing reporting
   * it -- the nodes it filters would still be drawn in the right one, so the two
   * would simply disagree with no error anywhere. */
  document.querySelectorAll('[data-filter-type]').forEach(btn => {
    const colour = TYPE_COLORS[btn.dataset.filterType];
    if (colour) btn.style.color = colour;
  });

  // Sliders Binding
  const chargeSlider = document.getElementById('slider-charge');
  const chargeVal = document.getElementById('val-charge');
  if (chargeSlider) {
    chargeSlider.oninput = () => {
      const val = parseInt(chargeSlider.value, 10);
      if (chargeVal) chargeVal.textContent = val;
      Graph.d3Force('charge').strength(-val);
      Graph.numDimensions(3); // re-heat
    };
  }

  const distSlider = document.getElementById('slider-dist');
  const distVal = document.getElementById('val-dist');
  if (distSlider) {
    distSlider.oninput = () => {
      const val = parseInt(distSlider.value, 10);
      if (distVal) distVal.textContent = val;
      Graph.d3Force('link').distance(val);
      Graph.numDimensions(3); // re-heat
    };
  }

  const speedSlider = document.getElementById('slider-speed');
  const speedVal = document.getElementById('val-speed');
  if (speedSlider) {
    speedSlider.oninput = () => {
      const val = parseFloat(speedSlider.value);
      if (speedVal) speedVal.textContent = `${val}x`;
      Graph.linkDirectionalParticleSpeed(0.005 * val);
    };
  }

  // Camera Dock Controls
  const btnReset = document.getElementById('btn-cam-reset');
  if (btnReset) {
    btnReset.onclick = () => {
      deselectNode();
      Graph.cameraPosition({ x: 0, y: 0, z: 450 }, { x: 0, y: 0, z: 0 }, 1200);
    };
  }

  const btnTop = document.getElementById('btn-cam-top');
  if (btnTop) {
    btnTop.onclick = () => {
      Graph.cameraPosition({ x: 0, y: 550, z: 1 }, { x: 0, y: 0, z: 0 }, 1200);
    };
  }

  const btnOrbit = document.getElementById('btn-auto-orbit');
  if (btnOrbit) {
    btnOrbit.onclick = () => {
      isOrbiting = !isOrbiting;
      btnOrbit.classList.toggle('is-active', isOrbiting);
    };
  }

  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (btnFullscreen) {
    btnFullscreen.onclick = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    };
  }

  // Zoom In / Out via ＋ / − buttons
  function zoomCamera(factor) {
    const pos = Graph.camera().position;
    Graph.cameraPosition(
      { x: pos.x * factor, y: pos.y * factor, z: pos.z * factor },
      { x: 0, y: 0, z: 0 },
      400
    );
  }

  const btnZoomIn = document.getElementById('btn-zoom-in');
  if (btnZoomIn) {
    btnZoomIn.onclick = () => zoomCamera(0.75); // move 25% closer
  }
  const btnZoomOut = document.getElementById('btn-zoom-out');
  if (btnZoomOut) {
    btnZoomOut.onclick = () => zoomCamera(1.35); // move 35% farther
  }

  // UI Panels toggling
  const ctrlPanel = document.getElementById('graph-ctrl-panel');
  const btnCloseCtrl = document.getElementById('btn-close-ctrl');
  const btnOpenCtrl = document.getElementById('btn-open-ctrl');
  if (btnCloseCtrl && ctrlPanel) {
    btnCloseCtrl.onclick = () => ctrlPanel.classList.add('is-collapsed');
  }
  if (btnOpenCtrl && ctrlPanel) {
    btnOpenCtrl.onclick = () => ctrlPanel.classList.remove('is-collapsed');
  }

  const btnCloseDossier = document.getElementById('btn-close-dossier');
  if (btnCloseDossier) {
    btnCloseDossier.onclick = () => deselectNode();
  }

  // Window resize handler
  window.addEventListener('resize', () => {
    Graph.width(window.innerWidth).height(window.innerHeight);
  });
}
