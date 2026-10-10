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
  const highlightNodes = new Set();
  const highlightLinks = new Set();

  let activeGen = 'all';
  let activeRel = 'all';
  let activeType = 'all';
  let activeCat = 'all';

  // Link styling helper
  const linkColors = {
    evolution: '#10b981',
    mega: '#d946ef',
    gmax: '#ef4444',
    regional: '#f59e0b',
    pantheon: '#8b5cf6',
    starter_trio: '#38bdf8',
    pseudo_legendary: '#6366f1',
    form: '#06b6d4',
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
      hoveredNode = node || null;

      if (node) {
        showTooltip(node);
        if (!selectedNode) {
          updateHighlight(node);
        }
      } else {
        hideTooltip();
        if (!selectedNode) {
          clearHighlight();
        }
      }
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
  function updateHighlight(targetNode) {
    highlightNodes.clear();
    highlightLinks.clear();

    if (!targetNode) return;

    highlightNodes.add(targetNode);

    activeLinks.forEach(link => {
      const srcId = typeof link.source === 'object' ? link.source.id : link.source;
      const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
      if (srcId === targetNode.id || tgtId === targetNode.id) {
        highlightLinks.add(link);
        const neighbor = activeNodes.find(n => n.id === (srcId === targetNode.id ? tgtId : srcId));
        if (neighbor) highlightNodes.add(neighbor);
      }
    });

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
  document.querySelectorAll('[data-filter-gen]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-gen]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      activeGen = btn.dataset.filterGen;
      applyFilters();
    });
  });

  document.querySelectorAll('[data-filter-rel]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-rel]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      activeRel = btn.dataset.filterRel;
      applyFilters();
    });
  });

  document.querySelectorAll('[data-filter-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-cat]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      activeCat = btn.dataset.filterCat;
      applyFilters();
    });
  });

  document.querySelectorAll('[data-filter-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.filterType;
      if (activeType === type) {
        btn.classList.remove('is-active');
        activeType = 'all';
      } else {
        document.querySelectorAll('[data-filter-type]').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        activeType = type;
      }
      applyFilters();
    });
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
