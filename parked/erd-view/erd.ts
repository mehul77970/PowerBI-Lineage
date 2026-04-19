// ─── ERD tab ──────────────────────────────────────────────────────────────
// Interactive SVG entity-relationship diagram. Force-directed layout,
// pan/zoom on the background, drag-to-reposition nodes, click-to-open
// a table's card on the Tables tab. Role-coloured nodes reuse the same
// --clr-* tokens every other tab uses so the visual language is shared.
//
// Why force-directed rather than a grid / tiered layout:
//   - PBI schemas are typically star-shaped around one or more fact
//     tables; a spring-and-repulsion simulation naturally produces
//     star clusters without any domain-specific layout code.
//   - Works on snowflakes / bridges / disconnected tables without
//     special cases — the physics figures it out.
//   - O(n²) is fine up to ~100 tables; larger models should filter
//     down (the controls bar exposes toggles for the noisy kinds).
//
// Node positions persist across re-renders via `erdNodePositions` so
// toggling a filter doesn't re-scramble the tables the user already
// dragged into place. "Reset layout" forgets positions and re-runs.

// Saved per-node positions (populated after each layout run).
var erdNodePositions: Record<string, {x:number,y:number}> = {};
// Node sizes (width/height) keyed by node id — needed so the drag
// handler can recompute edge-border anchors without having to re-
// measure. Populated by each renderErd() pass.
var erdNodeSizes: Record<string, {w:number,h:number}> = {};
// Viewport transform (pan + zoom), persists across re-renders.
var erdView = { tx: 0, ty: 0, scale: 1 };
// Filter toggles — "noisy" kinds default off so the first view stays readable.
var erdFilters = { proxies: false, fieldParams: false, calcGroups: true, autoDate: false };

function erdRoleOf(t: any): string {
  if (t.origin === 'auto-date') return 'auto-date';
  if (t.isCalcGroup) return 'calc-group';
  if (t.parameterKind === 'compositeModelProxy') return 'proxy';
  if (t.parameterKind === 'field') return 'parameter';
  const out = (t.relationships || []).filter((r: any) => r.direction === 'outgoing').length;
  const inc = (t.relationships || []).filter((r: any) => r.direction === 'incoming').length;
  if (out > 0 && inc === 0) return 'fact';
  if (out === 0 && inc > 0) return 'dimension';
  if (out > 0 && inc > 0) return 'bridge';
  return 'disconnected';
}

// Per-node width is driven by the label length; keeping w/h on each
// node lets the edge-anchor math (below) clip lines to the rectangle
// border instead of running through the node's body.
const ERD_NODE_H = 40;
function erdNodeWidth(name: string): number {
  return Math.max(110, Math.min(220, (name.length * 7.2) + 24));
}

function erdBuildGraph() {
  const tables = (DATA.tables || []).filter((t: any) => {
    if (t.origin === 'auto-date') return erdFilters.autoDate;
    if (t.isCalcGroup) return erdFilters.calcGroups;
    if (t.parameterKind === 'compositeModelProxy') return erdFilters.proxies;
    if (t.parameterKind === 'field') return erdFilters.fieldParams;
    return true;
  });
  const nodes = tables.map((t: any) => ({
    id: t.name, name: t.name, role: erdRoleOf(t),
    columnCount: t.columnCount || 0,
    measureCount: t.measureCount || 0,
    w: erdNodeWidth(t.name), h: ERD_NODE_H,
    x: 0, y: 0, vx: 0, vy: 0, _fx: 0, _fy: 0,
  }));
  const visible = new Set(nodes.map((n: any) => n.id));
  const edges = (DATA.relationships || [])
    .filter((r: any) => visible.has(r.fromTable) && visible.has(r.toTable))
    .map((r: any) => ({ from: r.fromTable, to: r.toTable, active: r.isActive }));
  return { nodes, edges };
}

/**
 * Ray-rectangle intersection — returns the point where the ray from
 * (cx, cy) toward (tx, ty) exits the axis-aligned rectangle of size
 * (w, h) centred at (cx, cy). Used so relationship lines end at the
 * node's border instead of at its centre (which hides the arrowhead
 * inside the box and makes the diagram look crowded).
 */
function erdEdgeAnchor(cx: number, cy: number, w: number, h: number, tx: number, ty: number): {x:number,y:number} {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = w / 2, hh = h / 2;
  // Scale the ray so it hits the nearest border. abs-ratio picks the
  // side (top/bottom vs left/right); the smaller scale wins because
  // that's the first border the ray crosses.
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

// Force-directed layout — pure JS, no deps. Deterministic given a
// seeded RNG (we use Math.random, so layouts differ between runs when
// nodes lack saved positions — that's intentional; the first render
// arranges itself, then positions stick).
function erdLayout(nodes: any[], edges: any[], width: number, height: number) {
  // Columnar layout — deterministic, predictable, readable. For a
  // typical PBI semantic model this gives facts | bridges | dims as
  // vertical lanes with relationship lines flowing rightward. Much
  // cleaner than a force-directed result on star schemas.
  //
  // Column placement (left → right):
  //   Facts         — the business processes
  //   Bridges       — many-to-many junctions (if any)
  //   Dimensions    — descriptive attributes
  //   Islands       — calc groups / proxies / field params /
  //                    disconnected / auto-date  (anything without
  //                    active relationships in the main graph)
  //
  // Within each column nodes stack vertically. Dimensions get sorted
  // by the mean Y of their connected facts so relationship lines
  // stay approximately horizontal and don't cross.
  //
  // Saved positions take precedence — a user who drags a node to
  // refine their layout doesn't get overruled on the next re-render.
  // "Reset layout" clears saved positions and falls back to this
  // algorithmic placement.

  const facts = nodes.filter(n => n.role === 'fact');
  const bridges = nodes.filter(n => n.role === 'bridge');
  const dims = nodes.filter(n => n.role === 'dimension');
  const islands = nodes.filter(n =>
    n.role === 'disconnected' || n.role === 'calc-group' ||
    n.role === 'parameter'    || n.role === 'proxy' ||
    n.role === 'auto-date');

  // Column x-coordinates — roughly evenly spaced. We anchor at x=0
  // regardless of `width` so the viewBox math downstream handles a
  // model wider than the viewport gracefully (it expands the bbox).
  const COL_FACTS    = 0;
  const COL_BRIDGES  = 420;
  const COL_DIMS     = 840;
  const COL_ISLANDS  = 1260;

  // Vertical rhythm — row spacing tight enough to keep things compact
  // but loose enough that labels breathe. Node height is 40; 70 gives
  // ~30px gap between rows.
  const ROW_H = 70;

  // Alphabetical order within facts + bridges + islands. Dimensions
  // get re-sorted below once we know the fact y-coords.
  facts.sort((a, b) => a.name.localeCompare(b.name));
  bridges.sort((a, b) => a.name.localeCompare(b.name));
  islands.sort((a, b) => a.name.localeCompare(b.name));

  // Place a column with even vertical spacing centred on y=0.
  // Returns the final y-position each node landed at.
  const placeColumn = (group: any[], colX: number) => {
    const totalH = group.length * ROW_H;
    const startY = -totalH / 2 + ROW_H / 2;
    group.forEach((n, i) => {
      const saved = erdNodePositions[n.id];
      if (saved) { n.x = saved.x; n.y = saved.y; return; }
      n.x = colX;
      n.y = startY + i * ROW_H;
    });
  };

  placeColumn(facts, COL_FACTS);
  placeColumn(bridges, COL_BRIDGES);

  // Dims — sort by mean Y of connected facts so lines stay tidy.
  // A dim with no fact edges falls through to alphabetical tail.
  const factY = new Map<string, number>(facts.map(f => [f.id, f.y]));
  const meanFactY = (dim: any): number => {
    let sum = 0, count = 0;
    for (const e of edges) {
      if (e.from === dim.id && factY.has(e.to))   { sum += factY.get(e.to)!;   count++; }
      if (e.to   === dim.id && factY.has(e.from)) { sum += factY.get(e.from)!; count++; }
    }
    return count > 0 ? sum / count : Number.POSITIVE_INFINITY;
  };
  dims.sort((a, b) => {
    const ya = meanFactY(a), yb = meanFactY(b);
    if (ya !== yb) return ya - yb;
    return a.name.localeCompare(b.name);
  });
  placeColumn(dims, COL_DIMS);

  // Islands — off to the far right, no sorting concern.
  placeColumn(islands, COL_ISLANDS);

  // Overlap resolution (applies only to user-dragged nodes that
  // might collide on re-render, since column placement itself
  // spaces by ROW_H which exceeds node height).
  const OVERLAP_PAD = 12;
  for (let sweep = 0; sweep < 4; sweep++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const minDx = (a.w + b.w) / 2 + OVERLAP_PAD;
        const minDy = (a.h + b.h) / 2 + OVERLAP_PAD;
        const overlapX = minDx - Math.abs(dx);
        const overlapY = minDy - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          if (overlapX < overlapY) {
            const shift = (overlapX / 2) * (dx >= 0 ? 1 : -1);
            a.x += shift; b.x -= shift;
          } else {
            const shift = (overlapY / 2) * (dy >= 0 ? 1 : -1);
            a.y += shift; b.y -= shift;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  // Keep the `width`/`height` params around for any future layout
  // variants that want to scale relative to canvas size.
  void width; void height;
}

function erdControls(nodes: any[], edges: any[]): string {
  const on = (k: string) => (erdFilters as any)[k] ? ' active' : '';
  return `<div class="erd-controls">
    <div class="erd-toggles">
      <button class="filter-btn${on('calcGroups')}" data-action="erd-toggle" data-filter="calcGroups" title="Show calc group tables">Calc groups</button>
      <button class="filter-btn${on('fieldParams')}" data-action="erd-toggle" data-filter="fieldParams" title="Show field-parameter tables">Field params</button>
      <button class="filter-btn${on('proxies')}" data-action="erd-toggle" data-filter="proxies" title="Show composite-model proxy tables">Proxies</button>
      <button class="filter-btn${on('autoDate')}" data-action="erd-toggle" data-filter="autoDate" title="Show LocalDateTable_* / DateTableTemplate_* infrastructure">Auto-date</button>
    </div>
    <div class="erd-actions">
      <button class="filter-btn" data-action="erd-reset" title="Reset layout + viewport">Reset layout</button>
      <button class="filter-btn" data-action="erd-fit" title="Fit diagram to screen">Fit</button>
    </div>
  </div>`;
}

function erdLegend(): string {
  const roles: [string, string][] = [
    ['fact', 'Fact'], ['dimension', 'Dimension'], ['bridge', 'Bridge'],
    ['disconnected', 'Disconnected'], ['calc-group', 'Calc group'],
    ['parameter', 'Field parameter'], ['proxy', 'Composite proxy'],
    ['auto-date', 'Auto-date'],
  ];
  const chips = roles.map(([r, label]) =>
    `<span class="erd-legend-chip erd-role-${r}"><span class="erd-legend-swatch"></span>${label}</span>`
  ).join('');
  return `<div class="erd-legend">${chips}
    <span class="erd-legend-sep">|</span>
    <span class="erd-legend-chip"><span class="erd-legend-line"></span>Active</span>
    <span class="erd-legend-chip"><span class="erd-legend-line erd-legend-line--dashed"></span>Inactive</span>
  </div>`;
}

function erdFooter(nodes: any[], edges: any[]): string {
  const activeEdges = edges.filter((e: any) => e.active).length;
  const inactiveEdges = edges.length - activeEdges;
  const meta = nodes.length + ' table' + (nodes.length === 1 ? '' : 's') +
    ' · ' + edges.length + ' relationship' + (edges.length === 1 ? '' : 's') +
    (inactiveEdges ? ' (' + activeEdges + ' active, ' + inactiveEdges + ' inactive)' : '');
  return '<div class="panel-footer"><div class="left">' + meta +
    '</div><div class="right" style="color:var(--text-faint);font-size:11px">Drag background to pan · wheel to zoom · drag a node to move · click to open</div></div>';
}

function renderErd() {
  const el = document.getElementById('erd-content');
  if (!el) return;

  const { nodes, edges } = erdBuildGraph();

  if (nodes.length === 0) {
    el.innerHTML = erdControls(nodes, edges) +
      '<div style="text-align:center;padding:80px 20px;color:var(--text-faint);font-size:13px">No tables match the current filters.</div>' +
      erdLegend() + erdFooter(nodes, edges);
    return;
  }

  const W = 1200, H = 700;
  erdLayout(nodes, edges, W, H);

  // Persist positions for next render
  for (const n of nodes) {
    erdNodePositions[n.id] = { x: n.x, y: n.y };
    erdNodeSizes[n.id]     = { w: n.w, h: n.h };
  }

  // Bounding box + viewBox padding
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const pad = 120;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const vbW = Math.max(maxX - minX, 600);
  const vbH = Math.max(maxY - minY, 400);

  const nodeMap = new Map<string, any>(nodes.map(n => [n.id, n]));

  // Edges anchor to the node's BORDER (not its centre) via
  // erdEdgeAnchor — otherwise the line runs through the node's body
  // and the arrowhead hides inside the target box.
  const edgeMarkup = edges.map((e: any) => {
    const a = nodeMap.get(e.from);
    const b = nodeMap.get(e.to);
    if (!a || !b) return '';
    const aEdge = erdEdgeAnchor(a.x, a.y, a.w, a.h, b.x, b.y);
    const bEdge = erdEdgeAnchor(b.x, b.y, b.w, b.h, a.x, a.y);
    const cls = 'erd-edge erd-edge--' + (e.active ? 'active' : 'inactive');
    return `<g class="${cls}" data-edge="${escAttr(e.from + '->' + e.to)}">
      <line x1="${aEdge.x}" y1="${aEdge.y}" x2="${bEdge.x}" y2="${bEdge.y}"
        marker-end="url(#erd-arrow-${e.active ? 'active' : 'inactive'})" />
      <circle cx="${aEdge.x}" cy="${aEdge.y}" r="3" />
    </g>`;
  }).join('');

  const nodeMarkup = nodes.map((n: any) => {
    const w = n.w, h = n.h;
    const sub = (n.columnCount || 0) + 'c' + (n.measureCount > 0 ? ' · ' + n.measureCount + 'ƒ' : '');
    return `<g class="erd-node erd-role-${n.role}" data-node="${escAttr(n.id)}"
      transform="translate(${n.x - w/2},${n.y - h/2})">
      <rect class="erd-node-rect" width="${w}" height="${h}" rx="5" ry="5" />
      <text class="erd-node-name" x="${w/2}" y="17" text-anchor="middle">${escHtml(n.name)}</text>
      <text class="erd-node-sub" x="${w/2}" y="31" text-anchor="middle">${escHtml(sub)}</text>
    </g>`;
  }).join('');

  const controls = erdControls(nodes, edges);
  const legend = erdLegend();
  const footer = erdFooter(nodes, edges);

  el.innerHTML = controls +
    `<div class="erd-wrap">
      <svg id="erd-svg" viewBox="${minX} ${minY} ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet"
          xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="erd-arrow-active" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" class="erd-arrow-head erd-arrow-head--active"/>
          </marker>
          <marker id="erd-arrow-inactive" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" class="erd-arrow-head erd-arrow-head--inactive"/>
          </marker>
        </defs>
        <g id="erd-view" transform="translate(${erdView.tx} ${erdView.ty}) scale(${erdView.scale})">
          <g id="erd-edges">${edgeMarkup}</g>
          <g id="erd-nodes">${nodeMarkup}</g>
        </g>
      </svg>
    </div>` + legend + footer;

  erdAttachInteractions(minX, minY, vbW, vbH);
}

// Interaction state — module-level so the various handlers share it.
var erdInteraction = {
  panning: false as boolean,
  panStart: { x: 0, y: 0 },
  panStartTf: { tx: 0, ty: 0 },
  dragNode: null as (SVGGElement | null),
  dragStart: { x: 0, y: 0 },
  dragNodeStart: { x: 0, y: 0 },
  dragMoved: false,
  // viewBox dimensions so we can convert screen deltas → SVG coords
  vbMinX: 0, vbMinY: 0, vbW: 0, vbH: 0,
};

function erdSvgCoords(ev: MouseEvent, svg: SVGSVGElement): {x:number,y:number} {
  const rect = svg.getBoundingClientRect();
  const scaleX = erdInteraction.vbW / rect.width;
  const scaleY = erdInteraction.vbH / rect.height;
  return {
    x: erdInteraction.vbMinX + (ev.clientX - rect.left) * scaleX,
    y: erdInteraction.vbMinY + (ev.clientY - rect.top) * scaleY,
  };
}

function erdApplyViewTransform() {
  const view = document.getElementById('erd-view');
  if (!view) return;
  view.setAttribute('transform',
    'translate(' + erdView.tx + ' ' + erdView.ty + ') scale(' + erdView.scale + ')');
}

function erdAttachInteractions(minX: number, minY: number, vbW: number, vbH: number) {
  erdInteraction.vbMinX = minX;
  erdInteraction.vbMinY = minY;
  erdInteraction.vbW = vbW;
  erdInteraction.vbH = vbH;

  const svg = document.getElementById('erd-svg') as unknown as SVGSVGElement | null;
  if (!svg) return;

  // Background mousedown → start pan. Node mousedown → start drag.
  svg.addEventListener('mousedown', (ev: MouseEvent) => {
    const target = ev.target as Element;
    const nodeG = target.closest('.erd-node') as SVGGElement | null;
    if (nodeG) {
      ev.preventDefault();
      erdInteraction.dragNode = nodeG;
      erdInteraction.dragStart = erdSvgCoords(ev, svg);
      const id = nodeG.getAttribute('data-node') || '';
      const pos = erdNodePositions[id] || { x: 0, y: 0 };
      erdInteraction.dragNodeStart = { x: pos.x, y: pos.y };
      erdInteraction.dragMoved = false;
    } else {
      erdInteraction.panning = true;
      erdInteraction.panStart = { x: ev.clientX, y: ev.clientY };
      erdInteraction.panStartTf = { tx: erdView.tx, ty: erdView.ty };
    }
  });

  // Global mousemove + mouseup so drags continue beyond the SVG frame.
  const onMove = (ev: MouseEvent) => {
    if (erdInteraction.dragNode) {
      const coords = erdSvgCoords(ev, svg);
      const dx = coords.x - erdInteraction.dragStart.x;
      const dy = coords.y - erdInteraction.dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) erdInteraction.dragMoved = true;
      const nx = erdInteraction.dragNodeStart.x + dx;
      const ny = erdInteraction.dragNodeStart.y + dy;
      const id = erdInteraction.dragNode.getAttribute('data-node') || '';
      erdNodePositions[id] = { x: nx, y: ny };
      // Update transform in-place — no need to re-render the whole SVG.
      const rect = erdInteraction.dragNode.querySelector('rect');
      const w = rect ? parseFloat(rect.getAttribute('width') || '110') : 110;
      const h = rect ? parseFloat(rect.getAttribute('height') || '40') : 40;
      erdInteraction.dragNode.setAttribute('transform',
        'translate(' + (nx - w/2) + ' ' + (ny - h/2) + ')');
      // Update any edges that touch this node
      erdUpdateEdgesFor(id, nx, ny);
    } else if (erdInteraction.panning) {
      const dx = ev.clientX - erdInteraction.panStart.x;
      const dy = ev.clientY - erdInteraction.panStart.y;
      // Convert screen delta → SVG coords (viewBox units) to match zoom
      const rect = svg.getBoundingClientRect();
      const sx = erdInteraction.vbW / rect.width;
      const sy = erdInteraction.vbH / rect.height;
      erdView.tx = erdInteraction.panStartTf.tx + dx * sx;
      erdView.ty = erdInteraction.panStartTf.ty + dy * sy;
      erdApplyViewTransform();
    }
  };
  const onUp = () => {
    erdInteraction.dragNode = null;
    erdInteraction.panning = false;
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  // Zoom on wheel — centred on the cursor position so zoom feels natural.
  svg.addEventListener('wheel', (ev: WheelEvent) => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.2, Math.min(4, erdView.scale * factor));
    // Zoom towards the mouse position
    const pt = erdSvgCoords(ev, svg);
    erdView.tx = (erdView.tx - pt.x) * (newScale / erdView.scale) + pt.x;
    erdView.ty = (erdView.ty - pt.y) * (newScale / erdView.scale) + pt.y;
    erdView.scale = newScale;
    erdApplyViewTransform();
  }, { passive: false });

  // Click on a node → open its card on the Tables tab (unless we just
  // dragged the node — the `dragMoved` guard avoids firing a click after
  // a drag gesture).
  svg.addEventListener('click', (ev: MouseEvent) => {
    const target = ev.target as Element;
    const nodeG = target.closest('.erd-node') as SVGGElement | null;
    if (!nodeG || erdInteraction.dragMoved) return;
    const id = nodeG.getAttribute('data-node');
    if (!id) return;
    // Open the table's card
    openTables.add(id);
    switchTab('tables');
    renderTables();
    // Scroll the card into view
    setTimeout(() => {
      const cards = document.querySelectorAll('.page-card .page-name');
      for (const c of cards as unknown as HTMLElement[]) {
        if (c.textContent && c.textContent.trim() === id) {
          c.scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
      }
    }, 50);
  });
}

/** After dragging a node, update every edge that touches it in-place
 *  instead of re-rendering the whole SVG. Keeps drag smooth. Both
 *  endpoints are recomputed via erdEdgeAnchor so the line stays on
 *  the rectangle borders (not the centres) even after drag. */
function erdUpdateEdgesFor(nodeId: string, nx: number, ny: number) {
  const draggedSize = erdNodeSizes[nodeId] || { w: 110, h: ERD_NODE_H };
  const edges = document.querySelectorAll('.erd-edge');
  for (const e of edges as unknown as SVGGElement[]) {
    const edgeId = e.getAttribute('data-edge') || '';
    const [from, to] = edgeId.split('->');
    if (from !== nodeId && to !== nodeId) continue;
    const line = e.querySelector('line');
    const dot = e.querySelector('circle');
    if (!line) continue;
    // The *other* endpoint — its position hasn't moved, but its
    // anchor point needs recomputing against the dragged node's new
    // centre (the ray direction changed).
    const otherId = from === nodeId ? to : from;
    const otherPos = erdNodePositions[otherId];
    const otherSize = erdNodeSizes[otherId];
    if (!otherPos || !otherSize) continue;
    // Dragged node's anchor — ray from (nx,ny) toward the other node
    const draggedAnchor = erdEdgeAnchor(nx, ny, draggedSize.w, draggedSize.h, otherPos.x, otherPos.y);
    // Other node's anchor — ray from its centre toward the dragged node
    const otherAnchor = erdEdgeAnchor(otherPos.x, otherPos.y, otherSize.w, otherSize.h, nx, ny);
    const fromAnchor = from === nodeId ? draggedAnchor : otherAnchor;
    const toAnchor   = to   === nodeId ? draggedAnchor : otherAnchor;
    line.setAttribute('x1', String(fromAnchor.x));
    line.setAttribute('y1', String(fromAnchor.y));
    line.setAttribute('x2', String(toAnchor.x));
    line.setAttribute('y2', String(toAnchor.y));
    if (dot) {
      dot.setAttribute('cx', String(fromAnchor.x));
      dot.setAttribute('cy', String(fromAnchor.y));
    }
  }
}

function toggleErdFilter(filter: string) {
  const key = filter as keyof typeof erdFilters;
  erdFilters[key] = !erdFilters[key];
  renderErd();
}

function resetErdLayout() {
  erdNodePositions = {};
  erdView = { tx: 0, ty: 0, scale: 1 };
  renderErd();
}

function fitErdView() {
  erdView = { tx: 0, ty: 0, scale: 1 };
  erdApplyViewTransform();
}
