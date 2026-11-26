(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const BOND_LEN = 54;
  const SNAP_RADIUS = 16;

  const RING_TOOL_CONFIG = {
    ring_benzene_c: { kind: "ring", tool: "ring_benzene_c", n: 6 },
    ring_benzene_k: { kind: "ring", tool: "ring_benzene_k", n: 6 },
    ring_6: { kind: "ring", tool: "ring_6", n: 6 },
    ring_5: { kind: "ring", tool: "ring_5", n: 5 },
    ring_4: { kind: "ring", tool: "ring_4", n: 4 },
    ring_3: { kind: "ring", tool: "ring_3", n: 3 },
  };

  // Unified chips: click to select tool, or drag >= 5px into canvas for magnetic snap
  const UNIFIED_PALETTE = [
    { kind: "atom", label: "", bondType: "single", text: "C(隐)", title: "将顶点恢复为隐式碳" },
    { kind: "atom", label: "C", bondType: "single", text: "C" },
    { kind: "atom", label: "H", bondType: "single", text: "H" },
    { kind: "atom", label: "O", bondType: "single", text: "O" },
    { kind: "atom", label: "N", bondType: "single", text: "N" },
    { kind: "atom", label: "S", bondType: "single", text: "S" },
    { kind: "atom", label: "P", bondType: "single", text: "P" },
    { kind: "atom", label: "F", bondType: "single", text: "F" },
    { kind: "atom", label: "Cl", bondType: "single", text: "Cl" },
    { kind: "atom", label: "Br", bondType: "single", text: "Br" },
    { kind: "atom", label: "I", bondType: "single", text: "I" },
    { kind: "atom", label: "OH", bondType: "single", text: "OH" },
    { kind: "group", label: "O", bondType: "double", text: "=O", title: "羰基氧 =O（点选设 O，拖到原子直接生成双键 =O）" },
    { kind: "atom", label: "COOH", bondType: "single", text: "COOH" },
    { kind: "atom", label: "HOOC", bondType: "single", text: "HOOC" },
    { kind: "atom", label: "CHO", bondType: "single", text: "CHO" },
    { kind: "atom", label: "NH2", bondType: "single", text: "NH₂" },
    { kind: "atom", label: "NO2", bondType: "single", text: "NO₂" },
    { kind: "atom", label: "SO3H", bondType: "single", text: "SO₃H" },
    { kind: "atom", label: "CH3", bondType: "single", text: "CH₃" },
    { kind: "atom", label: "CN", bondType: "single", text: "CN" },
    { kind: "atom", label: "Me", bondType: "single", text: "Me" },
    { kind: "atom", label: "Ph", bondType: "single", text: "Ph" },
    { kind: "atom", label: "R", bondType: "single", text: "R" },
    { kind: "atom", label: "R′", bondType: "single", text: "R′" },
    { kind: "carboxyl", text: "-C(=O)OH", title: "展开式羧基（点选或拖入磁吸连接）" },
    { kind: "acetyl", text: "-C(=O)CH₃", title: "展开式乙酰基（点选或拖入磁吸连接）" },
    { kind: "sep" },
    { kind: "charge", chg: "+", text: "+" },
    { kind: "charge", chg: "-", text: "−" },
    { kind: "charge", chg: "⊕", text: "⊕" },
    { kind: "charge", chg: "⊖", text: "⊖" },
    { kind: "charge", chg: "·", text: "·" },
  ];

  const ATOM_HOTKEYS = {
    c: "C",
    0: "",
    h: "H",
    o: "O",
    n: "N",
    s: "S",
    p: "P",
    f: "F",
    b: "Br",
    i: "I",
  };
  const ELEMENT_LABELS = new Set([...Object.values(ATOM_HOTKEYS), "Cl"]);

  const TOOL_HINTS = {
    select: "拖原子移动(Shift 自由长/角) · 拖空白平移整体 · 双击原子改名 · 右键快删 · Delete 删除",
    single: "拖出单键 · 点击已有键改成单键 · 双击原子改名",
    double: "拖出双键 · 点击已有键改成双键 · 双击原子改名",
    triple: "拖出三键 · 点击已有键改成三键 · 双击原子改名",
    wedge: "点击已有键设为实楔形 · 再次点击翻转方向 · 从原子拖出实楔键",
    dash: "点击已有键设为虚楔形 · 再次点击翻转方向 · 从原子拖出虚楔键",
    dotted: "绘制氢键/分子间虚线 · 点击或拖向另一原子",
    erase: "点击任意原子或化学键删除（任意模式下右键也可直接快删）",
    atom: "点击原子改写标注 · 点击空白添加节点 · 双击任意原子可就地编辑",
    charge: "点击原子添加或切换形式电荷 / 自由基",
    frag: "点击原子磁吸接上基团 · 点击空白放置基团",
  };

  function createSvgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v));
    }
    return el;
  }

  function cloneState(atoms, bonds, rings) {
    return {
      atoms: atoms.map((a) => ({ ...a })),
      bonds: bonds.map((b) => ({ ...b })),
      rings: rings.map((r) => ({ ...r, atoms: [...r.atoms] })),
    };
  }

  function snap15(rad) {
    const step = (15 * Math.PI) / 180;
    return Math.round(rad / step) * step;
  }

  function formatAtomDisplay(label) {
    if (!label) return "";
    return label
      .replace(/0/g, "₀")
      .replace(/1/g, "₁")
      .replace(/2/g, "₂")
      .replace(/3/g, "₃")
      .replace(/4/g, "₄")
      .replace(/5/g, "₅")
      .replace(/6/g, "₆")
      .replace(/7/g, "₇")
      .replace(/8/g, "₈")
      .replace(/9/g, "₉");
  }

  function init(opts) {
    const modal = opts.modalEl;
    if (!modal) return null;

    const els = {
      svg: document.getElementById("sketchSvg"),
      inlineInput: document.getElementById("sketchInlineInput"),
      unifiedPalette: document.getElementById("sketchUnifiedPalette"),
      atomRail: document.getElementById("sketchAtomRail"),
      groupGrid: document.getElementById("sketchGroupGrid"),
      groupsToggleBtn: document.getElementById("sketchGroupsToggleBtn"),
      groupsPopover: document.getElementById("sketchGroupsPopover"),
      customAtomInput: document.getElementById("sketchCustomAtomInput"),
      applyCustomAtomBtn: document.getElementById("sketchApplyCustomAtomBtn"),
      codeOutput: document.getElementById("sketchCodeOutput"),
      previewSvg: document.getElementById("sketchPreviewSvg"),
      previewStatus: document.getElementById("sketchPreviewStatus"),
      optSnap: document.getElementById("sketchOptSnap"),
      optUniform: document.getElementById("sketchOptUniform"),
      optShowC: document.getElementById("sketchOptShowC"),
      optPretty: document.getElementById("sketchOptPretty"),
      undoBtn: document.getElementById("sketchUndoBtn"),
      redoBtn: document.getElementById("sketchRedoBtn"),
      rotLeftBtn: document.getElementById("sketchRotLeftBtn"),
      rotRightBtn: document.getElementById("sketchRotRightBtn"),
      rotateAngle: document.getElementById("sketchRotateAngle"),
      rotateApplyBtn: document.getElementById("sketchRotateApplyBtn"),
      flipHBtn: document.getElementById("sketchFlipHBtn"),
      centerBtn: document.getElementById("sketchCenterBtn"),
      clearBtn: document.getElementById("sketchClearBtn"),
      toolHint: document.getElementById("sketchToolHint"),
      insertBtn: document.getElementById("sketchInsertBtn"),
      loadBtn: document.getElementById("sketchLoadBtn"),
    };

    const st = {
      atoms: [],
      bonds: [],
      rings: [],
      nextId: 1,
      tool: "single",
      atomLabel: "OH",
      chargeVal: "+",
      activeFrag: null,
      inlineEditAtomId: null,
      selectedAtomId: null,
      selectedBondId: null,
      hoverAtomId: null,
      hoverBondId: null,
      drag: null,
      lastAtomClick: null,
      fragDrag: null,
      undoStack: [],
      redoStack: [],
      genTimer: null,
      renderTimer: null,
      genSeq: 0,
      renderSeq: 0,
      blockCtx: null, // { blockId, onApplyBlock } when opened from Composer
    };

    function genId(prefix) {
      return `${prefix}${st.nextId++}`;
    }

    function pushUndo() {
      st.undoStack.push(cloneState(st.atoms, st.bonds, st.rings));
      if (st.undoStack.length > 60) st.undoStack.shift();
      st.redoStack = [];
    }

    function atomById(id) {
      return st.atoms.find((a) => a.id === id) || null;
    }

    function neighborsOf(atomId) {
      const list = [];
      for (const b of st.bonds) {
        if (b.a === atomId) list.push({ id: b.b, bond: b });
        else if (b.b === atomId) list.push({ id: b.a, bond: b });
      }
      return list;
    }

    function findBondBetween(id1, id2) {
      return st.bonds.find(
        (b) => (b.a === id1 && b.b === id2) || (b.a === id2 && b.b === id1)
      );
    }

    function addBond(id1, id2, type = "single") {
      if (id1 === id2) return null;
      const existing = findBondBetween(id1, id2);
      if (existing) {
        existing.type = type;
        return existing;
      }
      const b = { id: genId("b"), a: id1, b: id2, type };
      st.bonds.push(b);
      return b;
    }

    function cleanupRings() {
      const atomSet = new Set(st.atoms.map((a) => a.id));
      st.rings = st.rings.filter((r) => {
        if (!r.atoms.every((id) => atomSet.has(id))) return false;
        for (let i = 0; i < r.atoms.length; i++) {
          if (!findBondBetween(r.atoms[i], r.atoms[(i + 1) % r.atoms.length])) {
            return false;
          }
        }
        return true;
      });
    }

    function deleteAtom(atomId) {
      st.atoms = st.atoms.filter((a) => a.id !== atomId);
      st.bonds = st.bonds.filter((b) => b.a !== atomId && b.b !== atomId);
      if (st.selectedAtomId === atomId) st.selectedAtomId = null;
      cleanupRings();
    }

    function deleteBond(bondId) {
      st.bonds = st.bonds.filter((b) => b.id !== bondId);
      if (st.selectedBondId === bondId) st.selectedBondId = null;
      cleanupRings();
    }

    function bestSproutAngle(atom) {
      const nbrs = neighborsOf(atom.id);
      if (nbrs.length === 0) return -Math.PI / 6;
      if (nbrs.length === 1) {
        const n = atomById(nbrs[0].id);
        const backAng = Math.atan2(n.y - atom.y, n.x - atom.x);
        const c1 = backAng + (2 * Math.PI) / 3;
        const c2 = backAng - (2 * Math.PI) / 3;
        return Math.cos(c1) >= Math.cos(c2) ? c1 : c2;
      }
      const angles = nbrs
        .map((nb) => {
          const n = atomById(nb.id);
          return Math.atan2(n.y - atom.y, n.x - atom.x);
        })
        .sort((a, b) => a - b);
      let bestGap = -1;
      let bestMid = 0;
      for (let i = 0; i < angles.length; i++) {
        const a1 = angles[i];
        const a2 = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
        const gap = a2 - a1;
        if (gap > bestGap) {
          bestGap = gap;
          bestMid = a1 + gap / 2;
        }
      }
      return bestMid;
    }

    function computePolygonVerts(cx, cy, n, startAngleRad) {
      const radius = BOND_LEN / (2 * Math.sin(Math.PI / n));
      const verts = [];
      for (let i = 0; i < n; i++) {
        const ang = startAngleRad + (i * 2 * Math.PI) / n;
        verts.push({ x: cx + radius * Math.cos(ang), y: cy + radius * Math.sin(ang) });
      }
      return verts;
    }

    function computeFuseGeom(bond, n, sideHintPt = null) {
      const a1 = atomById(bond.a);
      const a2 = atomById(bond.b);
      if (!a1 || !a2) return null;
      const mx = (a1.x + a2.x) / 2;
      const my = (a1.y + a2.y) / 2;
      const dx = a2.x - a1.x;
      const dy = a2.y - a1.y;
      const edgeLen = Math.hypot(dx, dy) || BOND_LEN;
      const nx = -dy / edgeLen;
      const ny = dx / edgeLen;

      let sign = 1;
      if (sideHintPt) {
        const dot = (sideHintPt.x - mx) * nx + (sideHintPt.y - my) * ny;
        sign = dot >= 0 ? 1 : -1;
      } else {
        let scorePos = 0;
        for (const nb of [...neighborsOf(a1.id), ...neighborsOf(a2.id)]) {
          if (nb.id === a1.id || nb.id === a2.id) continue;
          const p = atomById(nb.id);
          if (p) scorePos += (p.x - mx) * nx + (p.y - my) * ny;
        }
        sign = scorePos > 0 ? -1 : 1;
      }

      const apothem = (edgeLen / 2) / Math.tan(Math.PI / n);
      const cx = mx + sign * nx * apothem;
      const cy = my + sign * ny * apothem;
      const radius = (edgeLen / 2) / Math.sin(Math.PI / n);
      const ang1 = Math.atan2(a1.y - cy, a1.x - cx);
      const ang2 = Math.atan2(a2.y - cy, a2.x - cx);
      let diff = ang2 - ang1;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const step = diff >= 0 ? (2 * Math.PI) / n : -(2 * Math.PI) / n;

      const verts = [{ x: a1.x, y: a1.y, existing: a1 }, { x: a2.x, y: a2.y, existing: a2 }];
      for (let i = 2; i < n; i++) {
        const ang = ang1 + i * step;
        const px = cx + radius * Math.cos(ang);
        const py = cy + radius * Math.sin(ang);
        verts.push({ x: px, y: py, existing: findAtomNear(px, py, 14) });
      }
      return { cx, cy, radius, verts };
    }

    function placePolygonAt(cx, cy, n, startAngleRad, kind) {
      const verts = computePolygonVerts(cx, cy, n, startAngleRad);
      const ids = [];
      for (const v of verts) {
        const a = { id: genId("a"), x: v.x, y: v.y, label: "", charge: "" };
        st.atoms.push(a);
        ids.push(a.id);
      }
      for (let i = 0; i < n; i++) {
        const btype = kind === "ring_benzene_k" && i % 2 === 0 ? "double" : "single";
        addBond(ids[i], ids[(i + 1) % n], btype);
      }
      if (kind === "ring_benzene_c") {
        st.rings.push({ id: genId("r"), atoms: ids, aromatic_circle: true });
      }
      return ids;
    }

    function fuseRingToBond(bond, n, kind, sideHintPt = null) {
      const geom = computeFuseGeom(bond, n, sideHintPt);
      if (!geom) return;
      const ringIds = [];
      for (const v of geom.verts) {
        if (v.existing) {
          ringIds.push(v.existing.id);
        } else {
          const na = { id: genId("a"), x: v.x, y: v.y, label: "", charge: "" };
          st.atoms.push(na);
          ringIds.push(na.id);
        }
      }
      const startParity = bond.type === "double" ? 1 : 0;
      for (let i = 1; i < n; i++) {
        const u = ringIds[i];
        const v = ringIds[(i + 1) % n];
        const btype =
          kind === "ring_benzene_k" && (i + startParity) % 2 === 0 ? "double" : "single";
        addBond(u, v, btype);
      }
      if (kind === "ring_benzene_c") {
        st.rings.push({ id: genId("r"), atoms: ringIds, aromatic_circle: true });
      }
    }

    function attachRingToAtom(atom, n, kind, angleOverride = null) {
      const ang = angleOverride !== null ? angleOverride : bestSproutAngle(atom);
      const radius = BOND_LEN / (2 * Math.sin(Math.PI / n));
      const p1x = atom.x + BOND_LEN * Math.cos(ang);
      const p1y = atom.y + BOND_LEN * Math.sin(ang);
      const cx = p1x + radius * Math.cos(ang);
      const cy = p1y + radius * Math.sin(ang);
      const startAng = Math.atan2(p1y - cy, p1x - cx);
      const ringIds = placePolygonAt(cx, cy, n, startAng, kind);
      addBond(atom.id, ringIds[0], "single");
    }

    function findAtomNear(x, y, radius = SNAP_RADIUS) {
      let best = null;
      let bestD = radius;
      for (const a of st.atoms) {
        const d = Math.hypot(a.x - x, a.y - y);
        if (d <= bestD) {
          bestD = d;
          best = a;
        }
      }
      return best;
    }

    function findClosestBond(x, y, maxDist = 24) {
      let best = null;
      let bestD = maxDist;
      for (const b of st.bonds) {
        const a1 = atomById(b.a);
        const a2 = atomById(b.b);
        if (!a1 || !a2) continue;
        const dx = a2.x - a1.x;
        const dy = a2.y - a1.y;
        const lenSq = dx * dx + dy * dy;
        const t = lenSq ? Math.max(0, Math.min(1, ((x - a1.x) * dx + (y - a1.y) * dy) / lenSq)) : 0;
        const px = a1.x + t * dx;
        const py = a1.y + t * dy;
        const d = Math.hypot(x - px, y - py);
        if (d <= bestD) {
          bestD = d;
          best = b;
        }
      }
      return best;
    }

    function svgPointFromEvent(e) {
      const matrix = els.svg.getScreenCTM();
      if (!matrix) return { x: 0, y: 0, inside: false };
      const { x, y } = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
      const vb = els.svg.viewBox.baseVal;
      const inside = Number.isFinite(x) && Number.isFinite(y)
        && x >= vb.x && x <= vb.x + vb.width && y >= vb.y && y <= vb.y + vb.height;
      return { x, y, inside };
    }

    function updateBondDrag(drag, pt, shiftKey) {
      const { from, fromAtom } = drag;
      const distance = Math.hypot(pt.x - drag.startX, pt.y - drag.startY);
      const deltaX = pt.x - from.x;
      const deltaY = pt.y - from.y;
      const length = Math.hypot(deltaX, deltaY);
      drag.moved ||= distance > 7;
      drag.end = null;
      if (!drag.moved || !pt.inside || length < 8) return;

      const target = findAtomNear(pt.x, pt.y);
      if (target) {
        if (target !== fromAtom && Math.hypot(target.x - from.x, target.y - from.y) >= 8) {
          drag.end = target;
        }
        return;
      }

      const angle = Math.atan2(deltaY, deltaX);
      const direction = els.optSnap.checked && !shiftKey ? snap15(angle) : angle;
      const bondLength = els.optUniform?.checked && !shiftKey ? BOND_LEN : length;
      const x = from.x + bondLength * Math.cos(direction);
      const y = from.y + bondLength * Math.sin(direction);
      const vb = els.svg.viewBox.baseVal;
      if (x >= vb.x && x <= vb.x + vb.width && y >= vb.y && y <= vb.y + vb.height) {
        const projectedTarget = findAtomNear(x, y);
        if (!projectedTarget) drag.end = { x, y };
        else if (projectedTarget !== fromAtom && Math.hypot(projectedTarget.x - from.x, projectedTarget.y - from.y) >= 8) drag.end = projectedTarget;
      }
    }

    // -------------------- Magnetic Fragment Drag --------------------
    function computeFragmentSnap(frag, pt) {
      if (frag.kind === "ring") {
        const nearBond = findClosestBond(pt.x, pt.y, 26);
        if (nearBond) {
          const geom = computeFuseGeom(nearBond, frag.n, pt);
          if (geom) {
            return { kind: "fuse", bond: nearBond, verts: geom.verts, cx: geom.cx, cy: geom.cy };
          }
        }
        const nearAtom = findAtomNear(pt.x, pt.y, 38);
        if (nearAtom) {
          const dist = Math.hypot(pt.x - nearAtom.x, pt.y - nearAtom.y);
          const ang = dist < 14 ? bestSproutAngle(nearAtom) : snap15(Math.atan2(pt.y - nearAtom.y, pt.x - nearAtom.x));
          const radius = BOND_LEN / (2 * Math.sin(Math.PI / frag.n));
          const p1x = nearAtom.x + BOND_LEN * Math.cos(ang);
          const p1y = nearAtom.y + BOND_LEN * Math.sin(ang);
          const cx = p1x + radius * Math.cos(ang);
          const cy = p1y + radius * Math.sin(ang);
          const startAng = Math.atan2(p1y - cy, p1x - cx);
          return {
            kind: "attach_atom",
            atom: nearAtom,
            angle: ang,
            p1x,
            p1y,
            verts: computePolygonVerts(cx, cy, frag.n, startAng),
          };
        }
        return {
          kind: "free_ring",
          cx: pt.x,
          cy: pt.y,
          verts: computePolygonVerts(pt.x, pt.y, frag.n, -Math.PI / 2),
        };
      }

      // Group / carboxyl / acetyl fragments
      const nearAtom = findAtomNear(pt.x, pt.y, 40);
      if (nearAtom) {
        const dist = Math.hypot(pt.x - nearAtom.x, pt.y - nearAtom.y);
        if (frag.kind === "atom" && ELEMENT_LABELS.has(frag.label) && dist <= SNAP_RADIUS) {
          return { kind: "replace_atom", atom: nearAtom };
        }
        const ang = dist < 15 ? bestSproutAngle(nearAtom) : snap15(Math.atan2(pt.y - nearAtom.y, pt.x - nearAtom.x));
        return {
          kind: "attach_group",
          atom: nearAtom,
          angle: ang,
          tx: nearAtom.x + BOND_LEN * Math.cos(ang),
          ty: nearAtom.y + BOND_LEN * Math.sin(ang),
        };
      }
      return { kind: "free_group", x: pt.x, y: pt.y };
    }

    function replaceAtomLabel(atom, label) {
      if ((atom.label || "") === label) return false;
      pushUndo();
      atom.label = label;
      return true;
    }

    function commitFragmentSnap(frag, snap, pt) {
      if (snap.kind === "replace_atom") {
        replaceAtomLabel(snap.atom, frag.label);
        return;
      }
      pushUndo();
      if (frag.kind === "ring") {
        if (snap.kind === "fuse") {
          fuseRingToBond(snap.bond, frag.n, frag.tool, pt);
        } else if (snap.kind === "attach_atom") {
          attachRingToAtom(snap.atom, frag.n, frag.tool, snap.angle);
        } else {
          placePolygonAt(snap.cx, snap.cy, frag.n, -Math.PI / 2, frag.tool);
        }
        return;
      }

      if (frag.kind === "group" || frag.kind === "atom") {
        const bType = frag.bondType || "single";
        if (snap.kind === "attach_group") {
          const existing = findAtomNear(snap.tx, snap.ty, 12);
          if (existing && existing.id !== snap.atom.id) {
            existing.label = frag.label;
            addBond(snap.atom.id, existing.id, bType);
          } else {
            const na = { id: genId("a"), x: snap.tx, y: snap.ty, label: frag.label, charge: "" };
            st.atoms.push(na);
            addBond(snap.atom.id, na.id, bType);
          }
        } else {
          st.atoms.push({ id: genId("a"), x: snap.x, y: snap.y, label: frag.label, charge: "" });
        }
        return;
      }

      // Multi-atom fragments: -C(=O)OH or -C(=O)CH3
      const endLabel = frag.kind === "carboxyl" ? "OH" : "CH3";
      const baseAngle = snap.kind === "attach_group" ? snap.angle : -Math.PI / 6;
      const cx = snap.kind === "attach_group" ? snap.tx : snap.x;
      const cy = snap.kind === "attach_group" ? snap.ty : snap.y;
      const cAtom = { id: genId("a"), x: cx, y: cy, label: "C", charge: "" };
      st.atoms.push(cAtom);
      if (snap.kind === "attach_group") {
        addBond(snap.atom.id, cAtom.id, "single");
      }
      const oAng = baseAngle + Math.PI / 3;
      const ohAng = baseAngle - Math.PI / 3;
      const oAtom = {
        id: genId("a"),
        x: cx + BOND_LEN * Math.cos(oAng),
        y: cy + BOND_LEN * Math.sin(oAng),
        label: "O",
        charge: "",
      };
      const tailAtom = {
        id: genId("a"),
        x: cx + BOND_LEN * Math.cos(ohAng),
        y: cy + BOND_LEN * Math.sin(ohAng),
        label: endLabel,
        charge: "",
      };
      st.atoms.push(oAtom, tailAtom);
      addBond(cAtom.id, oAtom.id, "double");
      addBond(cAtom.id, tailAtom.id, "single");
    }

    // -------------------- Rendering SVG --------------------
    function renderCanvas() {
      const svg = els.svg;
      svg.innerHTML = "";

      const defs = createSvgEl("defs");
      const pattern = createSvgEl("pattern", {
        id: "sketchGrid",
        width: 24,
        height: 24,
        patternUnits: "userSpaceOnUse",
      });
      pattern.appendChild(
        createSvgEl("circle", { cx: 12, cy: 12, r: 1, fill: "rgba(100,116,139,0.28)" })
      );
      defs.appendChild(pattern);
      svg.appendChild(defs);

      svg.appendChild(
        createSvgEl("rect", { x: 0, y: 0, width: 600, height: 400, fill: "url(#sketchGrid)" })
      );

      // Draw aromatic inner circles
      const ringLayer = createSvgEl("g");
      for (const r of st.rings) {
        if (!r.aromatic_circle) continue;
        const pts = r.atoms.map((id) => atomById(id)).filter(Boolean);
        if (pts.length !== 6) continue;
        const cx = pts.reduce((s, p) => s + p.x, 0) / 6;
        const cy = pts.reduce((s, p) => s + p.y, 0) / 6;
        const avgR = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / 6;
        ringLayer.appendChild(
          createSvgEl("circle", {
            cx,
            cy,
            r: avgR * 0.62,
            fill: "none",
            stroke: "#0f766e",
            "stroke-width": 1.8,
          })
        );
      }
      svg.appendChild(ringLayer);

      // Draw bonds
      const bondLayer = createSvgEl("g");
      for (const b of st.bonds) {
        const a1 = atomById(b.a);
        const a2 = atomById(b.b);
        if (!a1 || !a2) continue;

        const dx = a2.x - a1.x;
        const dy = a2.y - a1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;
        const ny = ux;

        const sPad = a1.label ? 12 : 0;
        const ePad = a2.label ? 12 : 0;
        const x1 = a1.x + ux * sPad;
        const y1 = a1.y + uy * sPad;
        const x2 = a2.x - ux * ePad;
        const y2 = a2.y - uy * ePad;

        const g = createSvgEl("g", { class: "sk-bond", "data-bond-id": b.id });
        const isSel = st.selectedBondId === b.id || st.hoverBondId === b.id;

        if (isSel) {
          g.appendChild(
            createSvgEl("line", {
              x1: a1.x,
              y1: a1.y,
              x2: a2.x,
              y2: a2.y,
              stroke: "rgba(37, 99, 235, 0.28)",
              "stroke-width": 10,
              "stroke-linecap": "round",
            })
          );
        }

        const strokeCol = isSel ? "#2563eb" : "#1e293b";
        if (b.type === "double") {
          const off = 2.6;
          g.appendChild(createSvgEl("line", { x1: x1 + nx * off, y1: y1 + ny * off, x2: x2 + nx * off, y2: y2 + ny * off, stroke: strokeCol, "stroke-width": 1.9, "stroke-linecap": "round" }));
          g.appendChild(createSvgEl("line", { x1: x1 - nx * off, y1: y1 - ny * off, x2: x2 - nx * off, y2: y2 - ny * off, stroke: strokeCol, "stroke-width": 1.9, "stroke-linecap": "round" }));
        } else if (b.type === "triple") {
          for (const off of [-3.6, 0, 3.6]) {
            g.appendChild(createSvgEl("line", { x1: x1 + nx * off, y1: y1 + ny * off, x2: x2 + nx * off, y2: y2 + ny * off, stroke: strokeCol, "stroke-width": 1.65, "stroke-linecap": "round" }));
          }
        } else if (b.type === "wedge") {
          const w = 4.6;
          const pts = `${x1},${y1} ${x2 + nx * w},${y2 + ny * w} ${x2 - nx * w},${y2 - ny * w}`;
          g.appendChild(createSvgEl("polygon", { points: pts, fill: strokeCol }));
        } else if (b.type === "dash") {
          const steps = 6;
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const px = x1 + (x2 - x1) * t;
            const py = y1 + (y2 - y1) * t;
            const hw = 4.4 * t;
            g.appendChild(createSvgEl("line", { x1: px + nx * hw, y1: py + ny * hw, x2: px - nx * hw, y2: py - ny * hw, stroke: strokeCol, "stroke-width": 1.7, "stroke-linecap": "round" }));
          }
        } else if (b.type === "dotted") {
          g.appendChild(createSvgEl("line", { x1, y1, x2, y2, stroke: strokeCol, "stroke-width": 2, "stroke-dasharray": "3 4.5", "stroke-linecap": "round" }));
        } else {
          g.appendChild(createSvgEl("line", { x1, y1, x2, y2, stroke: strokeCol, "stroke-width": 2.1, "stroke-linecap": "round" }));
        }

        g.appendChild(createSvgEl("line", { x1: a1.x, y1: a1.y, x2: a2.x, y2: a2.y, stroke: "transparent", "stroke-width": 14, class: "sk-bond-hit" }));
        bondLayer.appendChild(g);
      }
      svg.appendChild(bondLayer);

      if (st.drag?.mode === "draw_bond" && st.drag.end) {
        const { from, end, type } = st.drag;
        const length = Math.hypot(end.x - from.x, end.y - from.y);
        const nx = (from.y - end.y) / length;
        const ny = (end.x - from.x) / length;
        const offsets = type === "double" ? [-2.5, 2.5] : type === "triple" ? [-4, 0, 4] : [0];
        const ghost = createSvgEl("g", { "pointer-events": "none", "data-bond-preview": "" });
        for (const offset of offsets) {
          ghost.appendChild(createSvgEl("line", {
            x1: from.x + nx * offset, y1: from.y + ny * offset,
            x2: end.x + nx * offset, y2: end.y + ny * offset,
            stroke: "#0f766e", "stroke-width": 2, "stroke-dasharray": "4 3",
          }));
        }
        if (end.id) ghost.appendChild(createSvgEl("circle", {
          cx: end.x, cy: end.y, r: 13, fill: "none", stroke: "#0f766e", "stroke-width": 2,
        }));
        svg.appendChild(ghost);
      }

      // Magnetic Fragment Ghost Preview
      if (st.fragDrag && st.fragDrag.inside && st.fragDrag.snap) {
        const { frag, snap } = st.fragDrag;
        const ghost = createSvgEl("g", { class: "sk-ghost" });
        if (frag.kind === "ring" && snap.verts) {
          if (snap.kind === "attach_atom") {
            ghost.appendChild(createSvgEl("line", { x1: snap.atom.x, y1: snap.atom.y, x2: snap.p1x, y2: snap.p1y, stroke: "#0f766e", "stroke-width": 2.4 }));
            ghost.appendChild(createSvgEl("circle", { cx: snap.atom.x, cy: snap.atom.y, r: 15, fill: "rgba(15,118,110,0.18)", stroke: "#0f766e", "stroke-width": 1.6 }));
          } else if (snap.kind === "fuse") {
            const ba = atomById(snap.bond.a);
            const bb = atomById(snap.bond.b);
            if (ba && bb) {
              ghost.appendChild(createSvgEl("line", { x1: ba.x, y1: ba.y, x2: bb.x, y2: bb.y, stroke: "rgba(37,99,235,0.45)", "stroke-width": 9, "stroke-linecap": "round" }));
            }
          }
          const ptsStr = snap.verts.map((v) => `${v.x},${v.y}`).join(" ");
          ghost.appendChild(createSvgEl("polygon", { points: ptsStr, fill: "rgba(15,118,110,0.08)", stroke: "#0f766e", "stroke-width": 2.2, "stroke-dasharray": "5 3" }));
        } else if (snap.kind === "replace_atom") {
          ghost.appendChild(createSvgEl("circle", { cx: snap.atom.x, cy: snap.atom.y, r: 17, fill: "none", stroke: "#0f766e", "stroke-width": 2.4, "stroke-dasharray": "3 2" }));
        } else if (snap.kind === "attach_group") {
          ghost.appendChild(createSvgEl("circle", { cx: snap.atom.x, cy: snap.atom.y, r: 15, fill: "rgba(15,118,110,0.18)", stroke: "#0f766e", "stroke-width": 1.6 }));
          ghost.appendChild(createSvgEl("line", { x1: snap.atom.x, y1: snap.atom.y, x2: snap.tx, y2: snap.ty, stroke: "#0f766e", "stroke-width": 2.2, "stroke-dasharray": "4 3" }));
          const t = createSvgEl("text", { x: snap.tx, y: snap.ty + 4, "text-anchor": "middle", "font-size": 13, "font-weight": 700, fill: "#0f766e" });
          t.textContent = frag.text;
          ghost.appendChild(t);
        } else if (snap.kind === "free_group") {
          const t = createSvgEl("text", { x: snap.x, y: snap.y + 4, "text-anchor": "middle", "font-size": 13, "font-weight": 700, fill: "#0f766e" });
          t.textContent = frag.text;
          ghost.appendChild(t);
        }
        svg.appendChild(ghost);
      }

      // Draw atoms
      const atomLayer = createSvgEl("g");
      for (const a of st.atoms) {
        const g = createSvgEl("g", { class: "sk-atom", "data-atom-id": a.id });
        const isSel = st.selectedAtomId === a.id || st.hoverAtomId === a.id;

        if (isSel) {
          g.appendChild(createSvgEl("circle", { cx: a.x, cy: a.y, r: 13, fill: "rgba(15, 118, 110, 0.16)", stroke: "#0f766e", "stroke-width": 1.4 }));
        }

        if (a.label) {
          const disp = formatAtomDisplay(a.label);
          const w = Math.max(18, disp.length * 8.5 + 8);
          g.appendChild(createSvgEl("rect", { x: a.x - w / 2, y: a.y - 10, width: w, height: 20, rx: 5, fill: "#ffffff" }));
          const txt = createSvgEl("text", { x: a.x, y: a.y + 4.5, "text-anchor": "middle", "font-size": 13.5, "font-weight": 600, "font-family": "Consolas, monospace", fill: "#0f172a" });
          txt.textContent = disp;
          g.appendChild(txt);
        } else if (neighborsOf(a.id).length === 0 || isSel) {
          g.appendChild(createSvgEl("circle", { cx: a.x, cy: a.y, r: isSel ? 4.2 : 3.2, fill: "#0f766e" }));
        }

        if (a.charge) {
          const ox = a.label ? Math.max(12, a.label.length * 4.5 + 4) : 9;
          const cTxt = createSvgEl("text", { x: a.x + ox, y: a.y - 6, "text-anchor": "start", "font-size": 11, "font-weight": 700, fill: "#b91c1c" });
          cTxt.textContent = a.charge;
          g.appendChild(cTxt);
        }

        g.appendChild(createSvgEl("circle", { cx: a.x, cy: a.y, r: 13, fill: "transparent", class: "sk-atom-hit" }));
        atomLayer.appendChild(g);
      }
      svg.appendChild(atomLayer);
    }

    // -------------------- Backend Conversion & Live Preview --------------------
    function scheduleSync() {
      renderCanvas();
      if (st.genTimer) clearTimeout(st.genTimer);
      if (st.atoms.length === 0) {
        els.codeOutput.value = "";
        els.previewSvg.innerHTML = '<span class="sk-empty-hint">从左侧选择键型/环系、右侧选择原子/基团，点击或拖入画布绘制</span>';
        els.previewStatus.textContent = "画板为空";
        return;
      }
      els.previewStatus.textContent = "生成代码中…";
      st.genTimer = setTimeout(runSketchConvert, 140);
    }

    async function runSketchConvert() {
      if (st.atoms.length === 0) return;
      const seq = ++st.genSeq;
      try {
        const resp = await fetch("/api/sketch-to-chemfig", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            atoms: st.atoms,
            bonds: st.bonds,
            rings: st.rings,
            rotate: 0,
            snap_angles: els.optSnap.checked,
            uniform_bonds: els.optUniform ? els.optUniform.checked : true,
            show_carbon: els.optShowC.checked,
            pretty: els.optPretty.checked,
          }),
        });
        const data = await resp.json();
        if (seq !== st.genSeq) return;
        if (!resp.ok || !data.ok) {
          els.previewStatus.textContent = data.error || "生成失败";
          return;
        }
        els.codeOutput.value = data.code;
        scheduleSketchPreview(data.code);
      } catch (err) {
        els.previewStatus.textContent = `生成异常：${err}`;
      }
    }

    function scheduleSketchPreview(code) {
      if (st.renderTimer) clearTimeout(st.renderTimer);
      if (!code.trim()) return;
      els.previewStatus.textContent = "Tectonic 编译预览中…";
      st.renderTimer = setTimeout(async () => {
        const rSeq = ++st.renderSeq;
        try {
          const resp = await fetch("/api/render", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          const data = await resp.json();
          if (rSeq !== st.renderSeq) return;
          if (!resp.ok || !data.ok) {
            els.previewStatus.textContent = data.error || "预览编译失败";
            return;
          }
          const scope = window.scopeSvgIds || ((s) => s);
          els.previewSvg.innerHTML = scope(data.svg);
          els.previewStatus.textContent = `编译成功 · ${data.elapsed_ms} ms`;
        } catch (err) {
          els.previewStatus.textContent = `预览请求失败：${err}`;
        }
      }, 240);
    }

    // -------------------- Transforms & Presets --------------------
    function rotateAll(deg) {
      if (!Number.isFinite(deg) || st.atoms.length === 0) return false;
      if (els.optSnap.checked && Math.abs(deg / 15 - Math.round(deg / 15)) > 1e-8) {
        els.optSnap.checked = false;
      }
      pushUndo();
      const cx = st.atoms.reduce((s, a) => s + a.x, 0) / st.atoms.length;
      const cy = st.atoms.reduce((s, a) => s + a.y, 0) / st.atoms.length;
      const rad = (deg * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      for (const a of st.atoms) {
        const dx = a.x - cx;
        const dy = a.y - cy;
        a.x = cx + dx * c - dy * s;
        a.y = cy + dx * s + dy * c;
      }
      scheduleSync();
      return true;
    }

    function flipHorizontal() {
      if (st.atoms.length === 0) return;
      pushUndo();
      const cx = st.atoms.reduce((s, a) => s + a.x, 0) / st.atoms.length;
      for (const a of st.atoms) {
        a.x = cx - (a.x - cx);
      }
      scheduleSync();
    }

    function centerCanvas() {
      if (st.atoms.length === 0) return;
      pushUndo();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const a of st.atoms) {
        if (a.x < minX) minX = a.x;
        if (a.x > maxX) maxX = a.x;
        if (a.y < minY) minY = a.y;
        if (a.y > maxY) maxY = a.y;
      }
      const dx = 300 - (minX + maxX) / 2;
      const dy = 200 - (minY + maxY) / 2;
      for (const a of st.atoms) {
        a.x += dx;
        a.y += dy;
      }
      scheduleSync();
    }

    function loadPreset(name) {
      pushUndo();
      st.atoms = [];
      st.bonds = [];
      st.rings = [];
      st.selectedAtomId = null;
      st.selectedBondId = null;
      closeInlineEditor(false);

      if (name === "phenol_circle") {
        const ringIds = placePolygonAt(280, 200, 6, -Math.PI / 2, "ring_benzene_c");
        const target = atomById(ringIds[1]);
        const ang = -Math.PI / 6; // +30 deg radial outward from top-right vertex
        const oh = {
          id: genId("a"),
          x: target.x + BOND_LEN * Math.cos(ang),
          y: target.y + BOND_LEN * Math.sin(ang),
          label: "OH",
          charge: "",
        };
        st.atoms.push(oh);
        addBond(target.id, oh.id, "single");
      } else if (name === "benzene_k") {
        placePolygonAt(300, 200, 6, -Math.PI / 2, "ring_benzene_k");
      } else if (name === "citric") {
        const a1 = { id: genId("a"), x: 160, y: 210, label: "HOOC", charge: "" };
        const a2 = { id: genId("a"), x: 225, y: 185, label: "", charge: "" };
        const a3 = { id: genId("a"), x: 290, y: 210, label: "", charge: "" };
        const a4 = { id: genId("a"), x: 355, y: 185, label: "", charge: "" };
        const a5 = { id: genId("a"), x: 420, y: 210, label: "COOH", charge: "" };
        const top = { id: genId("a"), x: 290, y: 152, label: "COOH", charge: "" };
        const bot = { id: genId("a"), x: 290, y: 268, label: "OH", charge: "" };
        st.atoms.push(a1, a2, a3, a4, a5, top, bot);
        addBond(a1.id, a2.id, "single");
        addBond(a2.id, a3.id, "single");
        addBond(a3.id, a4.id, "single");
        addBond(a4.id, a5.id, "single");
        addBond(a3.id, top.id, "single");
        addBond(a3.id, bot.id, "single");
      }
      scheduleSync();
    }

    // -------------------- Inline Atom Editor & Tool UI --------------------
    function closeInlineEditor(commit = false) {
      const inp = els.inlineInput;
      if (!inp || inp.classList.contains("hidden")) {
        st.inlineEditAtomId = null;
        return;
      }
      const atomId = st.inlineEditAtomId;
      st.inlineEditAtomId = null;
      inp.classList.add("hidden");
      if (commit && atomId) {
        const atom = atomById(atomId);
        const nextVal = inp.value.trim();
        if (atom && nextVal !== (atom.label || "")) {
          pushUndo();
          atom.label = nextVal;
          scheduleSync();
        }
      }
    }

    function openInlineEditor(atom) {
      if (!els.inlineInput || !atom) return;
      const matrix = els.svg.getScreenCTM();
      if (!matrix) return;
      const wrapRect = els.inlineInput.parentElement.getBoundingClientRect();
      const point = new DOMPoint(atom.x, atom.y).matrixTransform(matrix);
      const px = point.x - wrapRect.left - els.inlineInput.parentElement.clientLeft;
      const py = point.y - wrapRect.top - els.inlineInput.parentElement.clientTop;
      st.inlineEditAtomId = atom.id;
      els.inlineInput.style.left = `${px}px`;
      els.inlineInput.style.top = `${py}px`;
      els.inlineInput.value = atom.label || "";
      els.inlineInput.classList.remove("hidden");
      els.inlineInput.focus();
      els.inlineInput.select();
    }

    function clearChipActive() {
      modal.querySelectorAll(".sk-chip").forEach((c) => c.classList.remove("active"));
    }

    function setTool(toolName) {
      st.tool = toolName;
      modal.querySelectorAll("[data-sktool]").forEach((b) => {
        b.classList.toggle("active", b.dataset.sktool === toolName);
      });
      if (!["atom", "charge", "frag"].includes(toolName)) {
        clearChipActive();
      }
      if (els.toolHint) {
        if (RING_TOOL_CONFIG[toolName]) {
          els.toolHint.textContent = "点击空白放环 · 点击键自动并环 · 点击原子外延成环 · 也可直接按住环形按钮拖入画布";
        } else {
          els.toolHint.textContent = TOOL_HINTS[toolName] || TOOL_HINTS.single;
        }
      }
    }

    function chooseAtomLabel(label, chipEl = null) {
      closeGroupsPopover();
      const selected = st.tool === "select" && atomById(st.selectedAtomId);
      if (selected) {
        if (replaceAtomLabel(selected, label)) scheduleSync();
        return;
      }
      st.atomLabel = label;
      setTool("atom");
      clearChipActive();
      chipEl?.classList.add("active");
    }

    const CORE_ATOM_LABELS = new Set(["", "C", "H", "O", "N", "S", "P", "F", "Cl", "Br", "I"]);

    function closeGroupsPopover() {
      els.groupsPopover?.classList.add("hidden");
      els.groupsToggleBtn?.classList.remove("active");
    }

    function makePaletteChip(item, { compact = false } = {}) {
      const btn = document.createElement("button");
      btn.type = "button";
      if (item.kind === "charge") {
        btn.className = "sk-chip sk-chg";
        btn.textContent = item.text;
        btn.title = `点击原子设置电荷：${item.chg}`;
        btn.addEventListener("click", () => {
          st.chargeVal = item.chg;
          setTool("charge");
          clearChipActive();
          btn.classList.add("active");
          closeGroupsPopover();
        });
        return btn;
      }

      btn.className = "sk-chip sk-draggable";
      btn.textContent = compact && item.label === "" ? "·C·" : item.text;
      btn.title = item.title || (item.kind === "atom" && ELEMENT_LABELS.has(item.label)
        ? `选中顶点后点 ${item.text} 进行替换，也可直接拖到顶点`
        : `点击选择 ${item.text}，或拖到画布上连接`);
      if (item.kind === "atom" || item.kind === "group") {
        btn.addEventListener("click", (e) => {
          if (e.detail === 0) chooseAtomLabel(item.label, btn);
        });
      }
      btn.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        st.fragDrag = {
          frag: item,
          chipEl: btn,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
          inside: false,
          snap: null,
          pt: null,
        };
      });
      return btn;
    }

    function buildPalettes() {
      if (els.atomRail && els.groupGrid) {
        els.atomRail.innerHTML = "";
        els.groupGrid.innerHTML = "";
        let addedChargeSep = false;
        UNIFIED_PALETTE.forEach((item) => {
          if (item.kind === "sep") return;
          if (item.kind === "charge") {
            if (!addedChargeSep) {
              const sep = document.createElement("span");
              sep.className = "sk-rail-sep";
              sep.setAttribute("aria-hidden", "true");
              els.atomRail.appendChild(sep);
              addedChargeSep = true;
            }
            els.atomRail.appendChild(makePaletteChip(item, { compact: true }));
            return;
          }
          if (item.kind === "atom" && CORE_ATOM_LABELS.has(item.label)) {
            els.atomRail.appendChild(makePaletteChip(item, { compact: true }));
          } else {
            els.groupGrid.appendChild(makePaletteChip(item));
          }
        });
        return;
      }

      if (!els.unifiedPalette) return;
      els.unifiedPalette.innerHTML = "";
      UNIFIED_PALETTE.forEach((item) => {
        if (item.kind === "sep") {
          const sep = document.createElement("span");
          sep.className = "sk-sep";
          sep.setAttribute("aria-hidden", "true");
          els.unifiedPalette.appendChild(sep);
          return;
        }
        els.unifiedPalette.appendChild(makePaletteChip(item));
      });
    }

    function ringSizeFromTool(tool) {
      if (tool === "ring_benzene_c" || tool === "ring_benzene_k" || tool === "ring_6") return 6;
      if (tool === "ring_5") return 5;
      if (tool === "ring_4") return 4;
      if (tool === "ring_3") return 3;
      return 0;
    }

    const BOND_TOOLS = new Set(["single", "double", "triple", "wedge", "dash", "dotted"]);

    els.svg.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || st.fragDrag) return;
      if (st.inlineEditAtomId) closeInlineEditor(true);
      const pt = svgPointFromEvent(e);
      if (!pt.inside) return;
      const atomEl = e.target.closest("[data-atom-id]");
      const bondEl = e.target.closest("[data-bond-id]");
      const atom = atomEl ? atomById(atomEl.dataset.atomId) : null;
      const bond = !atom && bondEl ? st.bonds.find((b) => b.id === bondEl.dataset.bondId) : null;
      if (!atom || (st.tool !== "select" && !BOND_TOOLS.has(st.tool))) st.lastAtomClick = null;

      if (st.tool === "erase") {
        if (atom) {
          pushUndo();
          deleteAtom(atom.id);
          scheduleSync();
        } else if (bond) {
          pushUndo();
          deleteBond(bond.id);
          scheduleSync();
        }
        return;
      }

      if (st.tool === "select") {
        if (atom) {
          st.selectedAtomId = atom.id;
          st.selectedBondId = null;
          st.drag = { mode: "move", atom, startX: pt.x, startY: pt.y, moved: false };
          renderCanvas();
        } else if (bond) {
          st.selectedBondId = bond.id;
          st.selectedAtomId = null;
          renderCanvas();
        } else {
          st.selectedAtomId = null;
          st.selectedBondId = null;
          if (st.atoms.length > 0) {
            st.drag = { mode: "pan_all", startX: pt.x, startY: pt.y, prevX: pt.x, prevY: pt.y, moved: false };
          }
          renderCanvas();
        }
        return;
      }

      if (st.tool === "atom") {
        const target = atom || findAtomNear(pt.x, pt.y, SNAP_RADIUS + 4);
        if (target) {
          if (replaceAtomLabel(target, st.atomLabel)) scheduleSync();
          return;
        }
        pushUndo();
        st.atoms.push({ id: genId("a"), x: pt.x, y: pt.y, label: st.atomLabel, charge: "" });
        scheduleSync();
        return;
      }

      if (st.tool === "frag" && st.activeFrag) {
        const snap = computeFragmentSnap(st.activeFrag, pt);
        commitFragmentSnap(st.activeFrag, snap, pt);
        scheduleSync();
        return;
      }

      if (st.tool === "charge") {
        if (atom) {
          pushUndo();
          atom.charge = atom.charge === st.chargeVal ? "" : st.chargeVal;
          scheduleSync();
        }
        return;
      }

      const ringN = ringSizeFromTool(st.tool);
      if (ringN > 0) {
        pushUndo();
        if (bond) {
          fuseRingToBond(bond, ringN, st.tool);
        } else if (atom) {
          attachRingToAtom(atom, ringN, st.tool);
        } else {
          placePolygonAt(pt.x, pt.y, ringN, -Math.PI / 2, st.tool);
        }
        scheduleSync();
        return;
      }

      if (BOND_TOOLS.has(st.tool)) {
        if (bond) {
          if (bond.type === st.tool && st.tool !== "wedge" && st.tool !== "dash") return;
          pushUndo();
          if ((st.tool === "wedge" || st.tool === "dash") && bond.type === st.tool) {
            const tmp = bond.a;
            bond.a = bond.b;
            bond.b = tmp;
          } else {
            bond.type = st.tool;
          }
          scheduleSync();
          return;
        }
        st.drag = {
          mode: "draw_bond", type: st.tool, from: atom || pt, fromAtom: atom,
          startX: pt.x, startY: pt.y, moved: false, end: null,
        };
      }
    });

    els.svg.addEventListener("dblclick", (e) => {
      if (st.tool !== "atom") return;
      const atomEl = e.target.closest("[data-atom-id]");
      const atom = atomEl ? atomById(atomEl.dataset.atomId) : null;
      if (atom) {
        e.preventDefault();
        openInlineEditor(atom);
      }
    });

    els.svg.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      closeInlineEditor(false);
      const atomEl = e.target.closest("[data-atom-id]");
      const bondEl = e.target.closest("[data-bond-id]");
      const atom = atomEl ? atomById(atomEl.dataset.atomId) : null;
      const bond = !atom && bondEl ? st.bonds.find((b) => b.id === bondEl.dataset.bondId) : null;
      if (atom) {
        pushUndo();
        deleteAtom(atom.id);
        scheduleSync();
      } else if (bond) {
        pushUndo();
        deleteBond(bond.id);
        scheduleSync();
      }
    });

    if (els.inlineInput) {
      els.inlineInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          closeInlineEditor(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          closeInlineEditor(false);
        }
      });
      els.inlineInput.addEventListener("blur", () => closeInlineEditor(true));
    }

    window.addEventListener("mousemove", (e) => {
      if (st.fragDrag) {
        if (Math.hypot(e.clientX - st.fragDrag.startX, e.clientY - st.fragDrag.startY) > 5) {
          st.fragDrag.moved = true;
          closeGroupsPopover();
        }
        const pt = svgPointFromEvent(e);
        st.fragDrag.inside = pt.inside;
        st.fragDrag.pt = pt;
        if (pt.inside) {
          st.fragDrag.snap = computeFragmentSnap(st.fragDrag.frag, pt);
        } else {
          st.fragDrag.snap = null;
        }
        renderCanvas();
        return;
      }

      if (!st.drag) return;
      const pt = svgPointFromEvent(e);
      if (st.drag.mode === "move") {
        if (!st.drag.moved && Math.hypot(pt.x - st.drag.startX, pt.y - st.drag.startY) > 2) {
          pushUndo();
          st.drag.moved = true;
        }
        if (st.drag.moved) {
          const a = st.drag.atom;
          const nbrs = neighborsOf(a.id);
          if (nbrs.length === 1 && !e.shiftKey) {
            const anchor = atomById(nbrs[0].id);
            const dx = pt.x - anchor.x;
            const dy = pt.y - anchor.y;
            const angle = Math.atan2(dy, dx);
            const direction = els.optSnap.checked ? snap15(angle) : angle;
            const length = els.optUniform?.checked ? BOND_LEN : Math.hypot(dx, dy);
            a.x = anchor.x + length * Math.cos(direction);
            a.y = anchor.y + length * Math.sin(direction);
          } else {
            a.x = pt.x;
            a.y = pt.y;
          }
          renderCanvas();
        }
      } else if (st.drag.mode === "pan_all") {
        if (!st.drag.moved && Math.hypot(pt.x - st.drag.startX, pt.y - st.drag.startY) > 2) {
          pushUndo();
          st.drag.moved = true;
        }
        if (st.drag.moved) {
          const dx = pt.x - st.drag.prevX;
          const dy = pt.y - st.drag.prevY;
          st.drag.prevX = pt.x;
          st.drag.prevY = pt.y;
          for (const a of st.atoms) {
            a.x += dx;
            a.y += dy;
          }
          renderCanvas();
        }
      } else if (st.drag.mode === "draw_bond") {
        updateBondDrag(st.drag, pt, e.shiftKey);
        if (st.drag.moved) renderCanvas();
      }
    });

    function selectOrEditAtom(atom, e) {
      const previous = st.lastAtomClick;
      st.selectedAtomId = atom.id;
      st.selectedBondId = null;
      if (previous?.id === atom.id && e.timeStamp - previous.time <= 450) {
        st.lastAtomClick = null;
        openInlineEditor(atom);
      } else {
        st.lastAtomClick = { id: atom.id, time: e.timeStamp };
      }
      renderCanvas();
    }

    window.addEventListener("mouseup", (e) => {
      if (e.button !== 0) return;
      if (st.fragDrag) {
        const fd = st.fragDrag;
        st.fragDrag = null;
        if (fd.moved && fd.inside && fd.snap) {
          commitFragmentSnap(fd.frag, fd.snap, fd.pt);
          scheduleSync();
        } else {
          if (!fd.moved) {
            if (fd.frag.kind === "ring") {
              setTool(fd.frag.tool);
            } else if (fd.frag.kind === "atom" || fd.frag.kind === "group") {
              chooseAtomLabel(fd.frag.label, fd.chipEl);
            } else if (fd.frag.kind === "carboxyl" || fd.frag.kind === "acetyl") {
              st.activeFrag = fd.frag;
              setTool("frag");
              clearChipActive();
              if (fd.chipEl) fd.chipEl.classList.add("active");
              closeGroupsPopover();
            }
          }
          renderCanvas();
        }
        return;
      }

      if (!st.drag) return;
      const drag = st.drag;
      st.drag = null;
      if (drag.mode === "move" || drag.mode === "pan_all") {
        if (drag.moved) {
          st.lastAtomClick = null;
          scheduleSync();
        } else if (drag.mode === "move" && svgPointFromEvent(e).inside) {
          selectOrEditAtom(drag.atom, e);
        }
        return;
      }
      const pt = svgPointFromEvent(e);
      updateBondDrag(drag, pt, e.shiftKey);
      if (!drag.moved && pt.inside && drag.fromAtom) {
        selectOrEditAtom(drag.fromAtom, e);
        return;
      }
      st.lastAtomClick = null;
      if (!drag.end) {
        renderCanvas();
        return;
      }
      if (drag.fromAtom && drag.end.id && findBondBetween(drag.fromAtom.id, drag.end.id)?.type === drag.type) {
        renderCanvas();
        return;
      }
      pushUndo();
      function ensureEndpoint(point) {
        if (point.id) return point.id;
        const atom = { id: genId("a"), x: point.x, y: point.y, label: "", charge: "" };
        st.atoms.push(atom);
        return atom.id;
      }
      addBond(ensureEndpoint(drag.from), ensureEndpoint(drag.end), drag.type);
      scheduleSync();
    });

    els.svg.addEventListener("mousemove", (e) => {
      if (st.drag || st.fragDrag) return;
      const atomEl = e.target.closest("[data-atom-id]");
      const bondEl = e.target.closest("[data-bond-id]");
      const nextA = atomEl ? atomEl.dataset.atomId : null;
      const nextB = !nextA && bondEl ? bondEl.dataset.bondId : null;
      if (nextA !== st.hoverAtomId || nextB !== st.hoverBondId) {
        st.hoverAtomId = nextA;
        st.hoverBondId = nextB;
        renderCanvas();
      }
    });

    els.svg.addEventListener("mouseleave", () => {
      if (st.hoverAtomId || st.hoverBondId) {
        st.hoverAtomId = null;
        st.hoverBondId = null;
        renderCanvas();
      }
    });

    modal.querySelectorAll("[data-sktool]").forEach((btn) => {
      const toolName = btn.dataset.sktool;
      const ringCfg = RING_TOOL_CONFIG[toolName];
      if (ringCfg) {
        btn.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          st.fragDrag = {
            frag: ringCfg,
            chipEl: btn,
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
            inside: false,
            snap: null,
            pt: null,
          };
        });
      } else {
        btn.addEventListener("click", () => {
          setTool(toolName);
        });
      }
    });

    modal.querySelectorAll("[data-skpreset]").forEach((btn) => {
      btn.addEventListener("click", () => loadPreset(btn.dataset.skpreset));
    });

    els.groupsToggleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!els.groupsPopover) return;
      const open = els.groupsPopover.classList.toggle("hidden") === false;
      els.groupsToggleBtn.classList.toggle("active", open);
    });
    modal.addEventListener("mousedown", (e) => {
      if (
        els.groupsPopover &&
        !els.groupsPopover.classList.contains("hidden") &&
        !e.target.closest("#sketchGroupsPopover, #sketchGroupsToggleBtn")
      ) {
        closeGroupsPopover();
      }
    });

    els.applyCustomAtomBtn.addEventListener("click", () => {
      const val = els.customAtomInput.value.trim();
      if (!val) return;
      chooseAtomLabel(val);
    });
    els.customAtomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        els.applyCustomAtomBtn.click();
      }
    });

    els.undoBtn.addEventListener("click", () => {
      if (st.undoStack.length === 0) return;
      closeInlineEditor(false);
      st.redoStack.push(cloneState(st.atoms, st.bonds, st.rings));
      const prev = st.undoStack.pop();
      st.atoms = prev.atoms;
      st.bonds = prev.bonds;
      st.rings = prev.rings;
      scheduleSync();
    });

    els.redoBtn.addEventListener("click", () => {
      if (st.redoStack.length === 0) return;
      closeInlineEditor(false);
      st.undoStack.push(cloneState(st.atoms, st.bonds, st.rings));
      const nxt = st.redoStack.pop();
      st.atoms = nxt.atoms;
      st.bonds = nxt.bonds;
      st.rings = nxt.rings;
      scheduleSync();
    });

    els.rotateApplyBtn?.addEventListener("click", () => {
      const angle = els.rotateAngle?.value.trim() || "";
      if (!angle || !Number.isFinite(Number(angle))) {
        opts.toast?.("请输入有效的旋转角度", true);
        els.rotateAngle?.focus();
        return;
      }
      if (!st.atoms.length) {
        opts.toast?.("画板为空，无法旋转", true);
        return;
      }
      if (rotateAll(Number(angle))) opts.toast?.(`已旋转 ${Number(angle)}°`);
    });
    els.rotateAngle?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        els.rotateApplyBtn?.click();
      }
    });
    els.rotLeftBtn.addEventListener("click", () => rotateAll(-15));
    els.rotRightBtn.addEventListener("click", () => rotateAll(15));
    els.flipHBtn.addEventListener("click", flipHorizontal);
    if (els.centerBtn) {
      els.centerBtn.addEventListener("click", centerCanvas);
    }
    els.clearBtn.addEventListener("click", () => {
      if (st.atoms.length === 0) return;
      closeInlineEditor(false);
      pushUndo();
      st.atoms = [];
      st.bonds = [];
      st.rings = [];
      st.selectedAtomId = null;
      st.selectedBondId = null;
      scheduleSync();
    });

    [els.optSnap, els.optUniform, els.optShowC, els.optPretty].filter(Boolean).forEach((chk) => {
      chk.addEventListener("change", () => runSketchConvert());
    });

    els.codeOutput.addEventListener("input", () => {
      scheduleSketchPreview(els.codeOutput.value);
    });

    els.insertBtn.addEventListener("click", () => {
      const code = els.codeOutput.value.trim();
      if (!code) return opts.toast?.("画板代码为空", true);
      opts.onInsert?.(code);
    });

    els.loadBtn.addEventListener("click", () => {
      const code = els.codeOutput.value.trim();
      if (!code) return opts.toast?.("画板代码为空", true);
      if (st.blockCtx && st.blockCtx.onApplyBlock) {
        st.blockCtx.onApplyBlock({
          blockId: st.blockCtx.blockId,
          name: st.blockCtx.name || "",
          code,
          sketchData: cloneState(st.atoms, st.bonds, st.rings),
        });
        return;
      }
      opts.onLoad?.(code);
    });

    window.addEventListener("keydown", (e) => {
      if (modal.classList.contains("hidden")) return;
      if (document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) els.redoBtn.click();
        else els.undoBtn.click();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        els.redoBtn.click();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const targetAtomId = st.hoverAtomId || st.selectedAtomId;
      const targetBondId = st.hoverBondId || st.selectedBondId;

      if (e.key === "Escape") {
        e.preventDefault();
        closeGroupsPopover();
        closeInlineEditor(false);
        if (st.drag?.mode === "draw_bond") st.drag = null;
        st.lastAtomClick = null;
        st.selectedAtomId = null;
        st.selectedBondId = null;
        setTool("select");
        renderCanvas();
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && (targetAtomId || targetBondId)) {
        e.preventDefault();
        pushUndo();
        if (targetAtomId) deleteAtom(targetAtomId);
        else if (targetBondId) deleteBond(targetBondId);
        scheduleSync();
        return;
      }

      const k = e.key.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(ATOM_HOTKEYS, k) && targetAtomId) {
        const atom = atomById(targetAtomId);
        if (atom) {
          e.preventDefault();
          if (replaceAtomLabel(atom, ATOM_HOTKEYS[k])) scheduleSync();
          return;
        }
      }

      if (k === "1" || k === "2" || k === "3") {
        const bType = k === "1" ? "single" : k === "2" ? "double" : "triple";
        if (targetBondId) {
          const bond = st.bonds.find((b) => b.id === targetBondId);
          if (bond) {
            e.preventDefault();
            if (bond.type !== bType) {
              pushUndo();
              bond.type = bType;
              scheduleSync();
            }
            return;
          }
        }
        e.preventDefault();
        setTool(bType);
      }
    });

    buildPalettes();
    loadPreset("phenol_circle");
    setTool(st.tool);

    let parseSeq = 0;

    async function loadFromChemfig(code) {
      const seq = ++parseSeq;
      st.atoms = [];
      st.bonds = [];
      st.rings = [];
      st.selectedAtomId = null;
      st.selectedBondId = null;
      st.undoStack = [];
      st.redoStack = [];
      renderCanvas();
      els.codeOutput.value = code;
      els.previewStatus.textContent = "正在解析当前结构…";
      try {
        const resp = await fetch("/api/chemfig-to-sketch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await resp.json();
        if (seq !== parseSeq) return;
        if (!resp.ok || !data.ok || !Array.isArray(data.atoms) || data.atoms.length === 0) {
          els.previewStatus.textContent = "该代码暂无法反解为 2D 节点（可直接绘制）";
          opts.toast?.(data.error || "该结构代码暂不支持自动反解，可在画板直接绘制", true);
          scheduleSketchPreview(code);
          return;
        }
        st.atoms = data.atoms.map((a) => ({ ...a }));
        st.bonds = (data.bonds || []).map((b) => ({ ...b }));
        st.rings = (data.rings || []).map((r) => ({ ...r, atoms: [...(r.atoms || [])] }));
        st.nextId = Math.max(10, st.atoms.length + st.bonds.length + st.rings.length + 10);
        scheduleSync();
      } catch (err) {
        if (seq !== parseSeq) return;
        els.previewStatus.textContent = `解析失败：${err}`;
        scheduleSketchPreview(code);
      }
    }

    return {
      openStandalone() {
        parseSeq++;
        st.blockCtx = null;
        st.drag = null;
        st.lastAtomClick = null;
        st.fragDrag = null;
        closeInlineEditor(false);
        els.insertBtn.classList.remove("hidden");
        els.loadBtn.textContent = "覆盖载入并渲染";
        scheduleSync();
      },
      openForBlock({ blockId, sketchData, code, name, onApplyBlock }) {
        parseSeq++;
        st.blockCtx = { blockId, name: name || "", onApplyBlock };
        st.drag = null;
        st.lastAtomClick = null;
        st.fragDrag = null;
        closeInlineEditor(false);
        els.insertBtn.classList.add("hidden");
        els.loadBtn.textContent = blockId ? "保存并更新积木" : "完成并放入拼装画布";
        if (sketchData && Array.isArray(sketchData.atoms) && sketchData.atoms.length > 0) {
          const copy = cloneState(sketchData.atoms, sketchData.bonds || [], sketchData.rings || []);
          st.atoms = copy.atoms;
          st.bonds = copy.bonds;
          st.rings = copy.rings;
          st.selectedAtomId = null;
          st.selectedBondId = null;
          st.undoStack = [];
          st.redoStack = [];
          st.nextId = Math.max(10, st.atoms.length + st.bonds.length + st.rings.length + 10);
          scheduleSync();
        } else if (code && code.trim()) {
          loadFromChemfig(code.trim());
        } else {
          // Brand new molecule block: start with a clean canvas
          st.atoms = [];
          st.bonds = [];
          st.rings = [];
          st.selectedAtomId = null;
          st.selectedBondId = null;
          st.undoStack = [];
          st.redoStack = [];
          scheduleSync();
        }
      },
    };
  }

  window.ChemSketcher = { init };
})();
