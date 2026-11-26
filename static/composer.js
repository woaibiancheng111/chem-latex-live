(() => {
  "use strict";

  let _svgScopeCounter = 0;
  window.scopeSvgIds = function scopeSvgIds(svg) {
    if (!svg || typeof svg !== "string") return svg || "";
    const prefix = `sv${++_svgScopeCounter}_`;
    return svg
      .replace(/\bid="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
      .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`)
      .replace(/(xlink:href|href)="#([^"]+)"/g, (_, attr, id) => `${attr}="#${prefix}${id}"`);
  };

  const STORAGE_KEY = "chemlatex_composer_v1";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PT_PER_CM = 28.3465;

  function parseSvgSizePt(svg) {
    if (!svg || typeof svg !== "string") return null;
    const tagMatch = svg.match(/<svg\b([^>]*)>/i);
    if (!tagMatch) return null;
    const attrs = tagMatch[1];
    const wm = attrs.match(/\bwidth="([\d.]+)(?:pt)?"/i);
    const hm = attrs.match(/\bheight="([\d.]+)(?:pt)?"/i);
    if (wm && hm) {
      const w = parseFloat(wm[1]);
      const h = parseFloat(hm[1]);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
    }
    const vb = attrs.match(/\bviewBox="[^"]*?([\d.]+)\s+([\d.]+)"/i);
    if (vb) {
      const w = parseFloat(vb[1]);
      const h = parseFloat(vb[2]);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
    }
    return null;
  }

  const PALETTE_ITEMS = [
    { kind: "plus", label: "+", sub: "", title: "添加反应加号 +" },
    { kind: "arrow", arrowStyle: "->", label: "→", sub: "", title: "添加向右反应箭头（可双击填上下条件）" },
    { kind: "arrow", arrowStyle: "<=>", label: "⇌", sub: "", title: "添加可逆平衡箭头" },
    { kind: "arrow", arrowStyle: "<->", label: "↔", sub: "", title: "添加共振双向箭头" },
    { kind: "ce", label: "\\ce", sub: "", title: "添加 mhchem 化学式（如 H2SO4、CO2）" },
    { kind: "text", label: "Aa", sub: "", title: "添加文字 / 旁注块" },
    { kind: "newline", label: "↵", sub: "", title: "换行写下一步反应（仅反应流模式）" },
  ];

  const ARROW_SYMBOLS = {
    "->": "→",
    "<=>": "⇌",
    "<->": "↔",
  };

  const CONNECTOR_LABELS = {
    dotted: "··· 虚线/氢键",
    arrow: "→ 实线箭头",
    curved: "↷ 弯箭头",
    solid: "— 实线",
  };

  function uid(prefix = "blk") {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36).slice(-3)}`;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function boxMacroName(idx) {
    // TeX macro names must use letters only (A..Z, AA..AZ, ...)
    let n = idx;
    let letters = "";
    do {
      letters = String.fromCharCode(65 + (n % 26)) + letters;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return `\\cmpBox${letters}`;
  }

  function sanitizeCondition(raw) {
    const s = (raw || "").trim();
    return formatAnnotationLatex(s);
  }

  function hasLatexAnnotation(raw) {
    return /\\[A-Za-z]+|\$|[_^]/.test(String(raw || ""));
  }

  function isStandaloneEnvCode(code) {
    return /\\schemestart|\\\[|\$\$|\\begin\{tikzpicture\}/.test(String(code || ""));
  }

  function isSketchEditableCode(code) {
    const s = String(code || "").trim();
    if (!s || !/\\chemfig(?:\[[^\]]*\])?\{/.test(s)) return false;
    if (/\\schemestart|\\schemestop|\\arrow|\\chemmove|\\ce\{|\\pu\{|\\begin\{|\\\[|\$\$|@\{|\\\+/.test(s)) {
      return false;
    }
    return true;
  }

  function escapeLatexText(raw) {
    const replacements = {
      "\\": "\\textbackslash{}",
      "{": "\\{",
      "}": "\\}",
      "$": "\\$",
      "&": "\\&",
      "#": "\\#",
      "%": "\\%",
      "_": "\\_",
      "~": "\\textasciitilde{}",
      "^": "\\textasciicircum{}",
    };
    return [...String(raw || "")].map((ch) => replacements[ch] || ch).join("");
  }

  function escapeLatexReserved(raw) {
    const text = String(raw || "");
    let output = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\\") {
        output += ch;
        if (i + 1 < text.length) {
          if (/[A-Za-z]/.test(text[i + 1])) {
            while (i + 1 < text.length && /[A-Za-z]/.test(text[i + 1])) output += text[++i];
          } else {
            output += text[++i];
          }
        }
      } else {
        output += "%&#".includes(ch) ? `\\${ch}` : ch;
      }
    }
    return output;
  }

  function formatAnnotationLatex(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (s.includes("$") || /\\(?:ce|pu|text|mathrm)\s*\{/.test(s)) return escapeLatexReserved(s);
    if (hasLatexAnnotation(s)) return `$${escapeLatexReserved(s)}$`;
    return `\\text{${escapeLatexText(s)}}`;
  }

  function cloneData(val) {
    return JSON.parse(JSON.stringify(val));
  }

  function init(opts) {
    const view = opts.containerEl;
    if (!view) return null;

    const els = {
      flowBtn: document.getElementById("cmpFlowBtn"),
      freeBtn: document.getElementById("cmpFreeBtn"),
      palette: document.getElementById("cmpPalette"),
      connBar: document.getElementById("cmpConnBar"),
      autoAlignBtn: document.getElementById("cmpAutoAlignBtn"),
      undoBtn: document.getElementById("cmpUndoBtn"),
      redoBtn: document.getElementById("cmpRedoBtn"),
      clearBtn: document.getElementById("cmpClearBtn"),
      presetHydration: document.getElementById("cmpPresetHydration"),
      presetHBond: document.getElementById("cmpPresetHBond"),
      switchCodeBtn: document.getElementById("cmpSwitchCodeBtn"),
      canvas: document.getElementById("composerCanvas"),
      popover: document.getElementById("cmpEditPopover"),
      popTitle: document.getElementById("cmpPopoverTitle"),
      popClose: document.getElementById("cmpPopoverClose"),
      popBody: document.getElementById("cmpPopoverBody"),
      popSave: document.getElementById("cmpPopoverSave"),
      popDelete: document.getElementById("cmpPopoverDelete"),
    };

    const st = {
      layoutMode: "flow",
      blocks: [],
      connectors: [],
      connectTool: null,
      connectFromId: null,
      selectedBlockId: null,
      editingBlockId: null,
      editingConnId: null,
      undoStack: [],
      redoStack: [],
      dragBlockId: null,
      justDragged: false,
      blockEls: new Map(),
    };
    const annotationSvgCache = new Map();
    const annotationSvgPending = new Map();

    function renderAnnotationSvg(snippet) {
      if (!opts.renderSnippetSvg) return Promise.resolve("");
      if (annotationSvgCache.has(snippet)) return Promise.resolve(annotationSvgCache.get(snippet));
      if (annotationSvgPending.has(snippet)) return annotationSvgPending.get(snippet);
      const pending = Promise.resolve(opts.renderSnippetSvg(snippet))
        .then((svg) => {
          if (svg) annotationSvgCache.set(snippet, svg);
          return svg || "";
        })
        .finally(() => annotationSvgPending.delete(snippet));
      annotationSvgPending.set(snippet, pending);
      return pending;
    }

    function saveLocal() {
      try {
        const slimBlocks = st.blocks.map((b) => ({ ...b }));
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            layoutMode: st.layoutMode,
            blocks: slimBlocks,
            connectors: st.connectors,
          })
        );
      } catch {
        // Ignore quota errors
      }
    }

    function pushUndo() {
      st.undoStack.push(cloneData({ layoutMode: st.layoutMode, blocks: st.blocks, connectors: st.connectors }));
      if (st.undoStack.length > 50) st.undoStack.shift();
      st.redoStack = [];
    }

    function blockLatex(b) {
      if (b.type === "ce") return `\\ce{${(b.ce || "H2O").trim()}}`;
      if (b.type === "text") return formatAnnotationLatex(b.text || "");
      if (b.type === "plus") return "\\+";
      if (b.type === "arrow") {
        const style = b.arrowStyle || "->";
        const top = sanitizeCondition(b.top);
        const bot = sanitizeCondition(b.bottom);
        if (top && bot) return `\\arrow{${style}[${top}][${bot}]}`;
        if (top) return `\\arrow{${style}[${top}]}`;
        if (bot) return `\\arrow{${style}[][${bot}]}`;
        return `\\arrow{${style}}`;
      }
      return (b.code || "").trim();
    }

    function freeBlockTexContent(b) {
      if (b.type === "ce") return `\\ce{${(b.ce || "H2O").trim()}}`;
      if (b.type === "text") return formatAnnotationLatex(b.text || "注释");
      if (b.type === "plus") return "$+$";
      if (b.type === "arrow") {
        const style = b.arrowStyle || "->";
        const top = sanitizeCondition(b.top);
        const bot = sanitizeCondition(b.bottom);
        if (top || bot) {
          return `\\schemestart\\arrow{${style}[${top}][${bot}]}\\schemestop`;
        }
        if (style === "<=>") return "\\ce{<=>}";
        if (style === "<->") return "\\ce{<->}";
        return "\\ce{->}";
      }
      if (b.type === "raw") {
        const raw = (b.code || "").trim();
        const disp = raw.match(/^\\\[([\s\S]*?)\\\]$/);
        if (disp) return `$\\displaystyle ${disp[1].trim()}$`;
        return raw || "\\ce{?}";
      }
      return (b.code || "").trim() || "\\ce{?}";
    }

    function blockSizePx(b) {
      const el = st.blockEls.get(b.id);
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        return { w: el.offsetWidth, h: el.offsetHeight };
      }
      if (st.layoutMode === "free" && b.svg) {
        const sz = parseSvgSizePt(b.svg);
        if (sz) {
          return {
            w: Math.max(44, Math.min(520, sz.w) + 20),
            h: Math.max(40, Math.min(260, sz.h) + 30),
          };
        }
      }
      return {
        w: b.type === "plus" ? 36 : b.type === "arrow" ? 82 : 96,
        h: b.type === "plus" ? 40 : b.type === "arrow" ? 56 : 74,
      };
    }

    function blockCenterPx(b) {
      const { w, h } = blockSizePx(b);
      return { cx: (b.x || 0) + w / 2, cy: (b.y || 0) + h / 2 };
    }

    function generateLatex() {
      if (st.blocks.length === 0) return "";

      if (st.layoutMode === "flow") {
        const nonNewline = st.blocks.filter((b) => b.type !== "newline");
        if (nonNewline.length === 0) return "";

        const rows = [];
        let cur = [];
        for (const b of st.blocks) {
          if (b.type === "newline") {
            if (cur.length) rows.push(cur);
            cur = [];
          } else {
            cur.push(b);
          }
        }
        if (cur.length) rows.push(cur);

        const segments = [];
        const flushChunk = (chunk) => {
          if (!chunk.length) return;
          if (chunk.length === 1 && !["arrow", "plus"].includes(chunk[0].type)) {
            const single = blockLatex(chunk[0]);
            if (single) segments.push(single);
            return;
          }
          const parts = chunk.map((b) => blockLatex(b)).filter(Boolean);
          if (parts.length) {
            segments.push(`\\schemestart\n  ${parts.join(" ")}\n\\schemestop`);
          }
        };

        rows.forEach((row) => {
          let chunk = [];
          row.forEach((b) => {
            if (b.type === "raw" && isStandaloneEnvCode(b.code)) {
              flushChunk(chunk);
              chunk = [];
              const code = blockLatex(b);
              if (code) segments.push(code);
            } else {
              chunk.push(b);
            }
          });
          flushChunk(chunk);
        });

        return segments.join("\n\\par\\medskip\n");
      }

      // Free Canvas Mode: \savebox + tikzpicture using block center coordinates (avoids nested tikzpicture)
      const active = st.blocks.filter((b) => b.type !== "newline");
      if (active.length === 0) return "";

      const centers = active.map((b) => blockCenterPx(b));
      const minCx = Math.min(...centers.map((p) => p.cx));
      const maxCy = Math.max(...centers.map((p) => p.cy));
      let effScale = 1.0;
      for (const b of active) {
        if (!b.svg) continue;
        const sz = parseSvgSizePt(b.svg);
        if (!sz) continue;
        const card = blockSizePx(b);
        const realW = Math.max(12, sz.w - 16);
        const realH = Math.max(12, sz.h - 16);
        effScale = Math.max(effScale, realW / Math.max(24, card.w), realH / Math.max(24, card.h));
      }
      const pxPerCm = PT_PER_CM / effScale;

      const boxDefs = [];
      const nodeLines = [];
      const idToNode = new Map();

      active.forEach((b, idx) => {
        const boxName = boxMacroName(idx);
        const nodeId = `b${idx + 1}`;
        idToNode.set(b.id, nodeId);
        const { cx: cxPx, cy: cyPx } = centers[idx];
        const cx = ((cxPx - minCx) / pxPerCm).toFixed(2).replace(/\.?0+$/, "") || "0";
        const cy = ((maxCy - cyPx) / pxPerCm).toFixed(2).replace(/\.?0+$/, "") || "0";
        boxDefs.push(`\\newsavebox{${boxName}}\\savebox{${boxName}}{${freeBlockTexContent(b)}}`);
        nodeLines.push(`  \\node[inner sep=2pt] (${nodeId}) at (${cx},${cy}) {\\usebox{${boxName}}};`);
      });

      const connLines = [];
      for (const c of st.connectors) {
        const n1 = idToNode.get(c.from);
        const n2 = idToNode.get(c.to);
        if (!n1 || !n2 || n1 === n2) continue;
        let opt = "thick,shorten <=3pt,shorten >=3pt";
        let pathOp = "--";
        if (c.style === "dotted") {
          opt = `dotted,${opt}`;
        } else if (c.style === "arrow") {
          opt = `-{Stealth[length=2.2mm]},${opt}`;
        } else if (c.style === "curved") {
          opt = `-{Stealth[length=2.2mm]},${opt}`;
          pathOp = "to[bend left=28]";
        }
        const lbl = (c.label || "").trim();
        const labelNode = lbl ? `node[midway,above,font=\\small] {${formatAnnotationLatex(lbl)}} ` : "";
        connLines.push(`  \\draw[${opt}] (${n1}) ${pathOp} ${labelNode}(${n2});`);
      }

      return [
        ...boxDefs,
        "\\begin{tikzpicture}[x=1cm,y=1cm,line cap=round,line join=round]",
        ...nodeLines,
        ...connLines,
        "\\end{tikzpicture}",
      ].join("\n");
    }

    function syncOutput({ immediate = false } = {}) {
      saveLocal();
      const latex = generateLatex();
      opts.onCodeGenerated?.(latex, { immediate });
    }

    function needsAnnotationPreview(block) {
      if (["ce", "chemfig", "raw"].includes(block.type)) return true;
      if (block.type === "text") return hasLatexAnnotation(block.text);
      if (block.type === "arrow") return hasLatexAnnotation(block.top) || hasLatexAnnotation(block.bottom);
      return false;
    }

    function blockPreviewLatex(block) {
      const code = blockLatex(block);
      return block.type === "arrow" ? `\\schemestart${code}\\schemestop` : code;
    }

    async function ensureBlockSvg(block) {
      if (block.svg || !needsAnnotationPreview(block)) return;
      const snippet = blockPreviewLatex(block);
      if (!snippet || !opts.renderSnippetSvg) return;
      try {
        const svg = await renderAnnotationSvg(snippet);
        if (svg) {
          if (blockPreviewLatex(block) !== snippet) return;
          block.svg = svg;
          saveLocal();
          renderCanvas();
          if (st.layoutMode === "free") syncOutput({ immediate: true });
        }
      } catch {
        // Leave fallback text
      }
    }

    function nextFreeCoords() {
      const active = st.blocks.filter((b) => b.type !== "newline");
      if (active.length === 0) return { x: 48, y: 56 };
      const last = active[active.length - 1];
      const lastSz = blockSizePx(last);
      const maxW = Math.max(560, (els.canvas.clientWidth || 620) - 32);
      let nx = Math.round(((last.x || 48) + lastSz.w + 28) / 8) * 8;
      let ny = last.y || 56;
      if (nx + 120 > maxW) {
        const maxBottom = active.reduce((m, b) => {
          const s = blockSizePx(b);
          return Math.max(m, (b.y || 40) + s.h);
        }, 56);
        nx = 48;
        ny = Math.round((maxBottom + 28) / 8) * 8;
      }
      return { x: nx, y: ny };
    }

    function autoLayoutFreeBlocks({ onlyIfOverlapping = false } = {}) {
      const active = st.blocks.filter((b) => b.type !== "newline");
      if (active.length === 0) return false;
      if (onlyIfOverlapping) {
        let overlaps = false;
        for (let i = 0; i < active.length && !overlaps; i++) {
          const a = active[i];
          const as = blockSizePx(a);
          const ax = a.x || 0;
          const ay = a.y || 0;
          for (let j = i + 1; j < active.length; j++) {
            const b = active[j];
            const bs = blockSizePx(b);
            const bx = b.x || 0;
            const by = b.y || 0;
            if (ax < bx + bs.w + 8 && ax + as.w + 8 > bx && ay < by + bs.h + 8 && ay + as.h + 8 > by) {
              overlaps = true;
              break;
            }
          }
        }
        if (!overlaps) return false;
      }

      const maxRowWidth = Math.max(520, (els.canvas.clientWidth || 620) - 36);
      const rows = [];
      let row = [];
      let rowW = 48;
      let rowMaxH = 0;
      active.forEach((b) => {
        const sz = blockSizePx(b);
        if (row.length > 0 && rowW + sz.w > maxRowWidth) {
          rows.push({ items: row, maxH: rowMaxH });
          row = [];
          rowW = 48;
          rowMaxH = 0;
        }
        row.push({ b, sz });
        rowW += sz.w + 28;
        rowMaxH = Math.max(rowMaxH, sz.h);
      });
      if (row.length > 0) rows.push({ items: row, maxH: rowMaxH });

      let curY = 48;
      rows.forEach((r) => {
        let curX = 48;
        const centerY = curY + r.maxH / 2;
        r.items.forEach(({ b, sz }) => {
          b.x = Math.round(curX / 8) * 8;
          b.y = Math.max(16, Math.round((centerY - sz.h / 2) / 8) * 8);
          curX += sz.w + 28;
        });
        curY += r.maxH + 28;
      });
      return true;
    }

    function makeBlockFromPalette(spec, pos = null) {
      const coords = pos || nextFreeCoords();
      if (spec.kind === "plus") {
        return { id: uid(), type: "plus", name: "加号", ...coords };
      }
      if (spec.kind === "arrow") {
        return {
          id: uid(),
          type: "arrow",
          name: "反应箭头",
          arrowStyle: spec.arrowStyle || "->",
          top: "",
          bottom: "",
          ...coords,
        };
      }
      if (spec.kind === "ce") {
        return { id: uid(), type: "ce", name: "化学式", ce: "H2O", ...coords };
      }
      if (spec.kind === "text") {
        return { id: uid(), type: "text", name: "文字标注", text: "条件/说明", ...coords };
      }
      if (spec.kind === "newline") {
        return { id: uid(), type: "newline", name: "换行", ...coords };
      }
      return null;
    }

    function makeBlockFromLibrary(item, pos = null) {
      const coords = pos || nextFreeCoords();
      const code = (item.code || "").trim();
      const cachedSvg = item.svg || opts.getPreviewSvg?.(item.id) || "";
      const ceMatch = code.match(/^\\ce\{([\s\S]+)\}$/);
      if (ceMatch && !code.includes("->") && !code.includes("<=>")) {
        return {
          id: uid(),
          type: "ce",
          name: item.name || "化学式",
          ce: ceMatch[1],
          svg: cachedSvg,
          ...coords,
        };
      }
      return {
        id: uid(),
        type: code.startsWith("\\chemfig") ? "chemfig" : "raw",
        name: item.name || "结构/模板",
        code,
        svg: cachedSvg,
        ...coords,
      };
    }

    function insertBlockAt(block, insertIdx = null) {
      pushUndo();
      if (insertIdx === null || insertIdx < 0 || insertIdx > st.blocks.length) {
        st.blocks.push(block);
      } else {
        st.blocks.splice(insertIdx, 0, block);
      }
      st.selectedBlockId = block.id;
      render();
      syncOutput({ immediate: true });
      ensureBlockSvg(block);
    }

    function addBlockFromLibrary(item, insertIdx = null, pos = null) {
      const blk = makeBlockFromLibrary(item, pos);
      insertBlockAt(blk, insertIdx);
      return blk;
    }

    function upsertSketchBlock(blockIdOrNull, { name, code, sketchData }) {
      pushUndo();
      if (blockIdOrNull) {
        const existing = st.blocks.find((b) => b.id === blockIdOrNull);
        if (existing) {
          existing.type = "chemfig";
          existing.name = name || existing.name || "手绘分子";
          existing.code = code;
          existing.sketchData = sketchData || null;
          existing.svg = "";
          render();
          syncOutput({ immediate: true });
          ensureBlockSvg(existing);
          return existing;
        }
      }
      const coords = nextFreeCoords();
      const blk = {
        id: uid(),
        type: "chemfig",
        name: name || "手绘分子",
        code,
        sketchData: sketchData || null,
        svg: "",
        ...coords,
      };
      st.blocks.push(blk);
      st.selectedBlockId = blk.id;
      render();
      syncOutput({ immediate: true });
      ensureBlockSvg(blk);
      return blk;
    }

    // -------------------- Presets --------------------
    function loadPreset(presetName, { silent = false } = {}) {
      if (!silent) pushUndo();
      if (presetName === "hydration") {
        st.layoutMode = "flow";
        st.connectors = [];
        st.blocks = [
          { id: uid(), type: "chemfig", name: "丙烯", code: "\\chemfig{=[:30]-[:-30]}", x: 40, y: 80 },
          { id: uid(), type: "plus", name: "加号", x: 180, y: 80 },
          { id: uid(), type: "ce", name: "水", ce: "H2O", x: 240, y: 80 },
          {
            id: uid(),
            type: "arrow",
            name: "反应箭头",
            arrowStyle: "->",
            top: "\\ce{H2SO4}",
            bottom: "$\\Delta$",
            x: 340,
            y: 80,
          },
          { id: uid(), type: "chemfig", name: "2-丙醇", code: "\\chemfig{-[:30](-[2]OH)-[:-30]}", x: 470, y: 80 },
        ];
      } else if (presetName === "hbond") {
        st.layoutMode = "free";
        const b1 = {
          id: uid(),
          type: "chemfig",
          name: "对羟基苯甲酸",
          code: "\\chemfig{[:30]**6((-[6]O-H)---(-[2]COOH)---)}",
          x: 48,
          y: 48,
        };
        const b2 = {
          id: uid(),
          type: "ce",
          name: "水分子",
          ce: "H2O",
          x: 248,
          y: 88,
        };
        st.blocks = [b1, b2];
        st.connectors = [{ id: uid("conn"), from: b1.id, to: b2.id, style: "dotted", label: "氢键" }];
      }
      render();
      if (silent) {
        saveLocal();
      } else {
        syncOutput({ immediate: true });
      }
      st.blocks.forEach((b) => ensureBlockSvg(b));
    }

    // -------------------- Block & Connector Popover --------------------
    function closePopover() {
      els.popover.classList.add("hidden");
      st.editingBlockId = null;
      st.editingConnId = null;
    }

    function openBlockEditor(block) {
      closePopover();
      st.editingBlockId = block.id;
      els.popTitle.textContent = `编辑：${block.name || block.type}`;
      els.popDelete.classList.remove("hidden");
      els.popBody.innerHTML = "";

      if (block.type === "arrow") {
        els.popBody.innerHTML = `
          <label class="cmp-pop-field">箭头类型
            <select id="cmpPopArrowStyle">
              <option value="->" ${block.arrowStyle === "->" ? "selected" : ""}>→ 向右反应</option>
              <option value="<=>" ${block.arrowStyle === "<=>" ? "selected" : ""}>⇌ 可逆平衡</option>
              <option value="<->" ${block.arrowStyle === "<->" ? "selected" : ""}>↔ 共振箭头</option>
            </select>
          </label>
          <label class="cmp-pop-field">上方条件
            <input type="text" id="cmpPopTop" value="${escapeHtml(block.top || "")}" placeholder="例如 \\ce{H2SO4}, \\ce{H2O}" />
          </label>
          <label class="cmp-pop-field">下方条件
            <input type="text" id="cmpPopBot" value="${escapeHtml(block.bottom || "")}" placeholder="例如 $\\Delta$ 或 \\text{加热}" />
          </label>
          <div class="cmp-cond-chips">
            <span>快填：</span>
            <button type="button" class="mini-pill" data-cond-target="top" data-cond="\\ce{H2SO4}">H₂SO₄</button>
            <button type="button" class="mini-pill" data-cond-target="top" data-cond="\\ce{H2O}">H₂O</button>
            <button type="button" class="mini-pill" data-cond-target="top" data-cond="\\text{催化剂}">催化剂</button>
            <button type="button" class="mini-pill" data-cond-target="bottom" data-cond="$\\Delta$">Δ 加热</button>
            <button type="button" class="mini-pill" data-cond-target="bottom" data-cond="$h\\nu$">hν 光照</button>
          </div>
        `;
        els.popBody.querySelectorAll("[data-cond]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const targetEl = document.getElementById(
              btn.dataset.condTarget === "bottom" ? "cmpPopBot" : "cmpPopTop"
            );
            const val = btn.dataset.cond;
            targetEl.value = targetEl.value ? `${targetEl.value}, ${val}` : val;
          });
        });
      } else if (block.type === "ce") {
        els.popBody.innerHTML = `
          <label class="cmp-pop-field">化学式 / 离子（自动排版上下标）
            <input type="text" id="cmpPopCe" value="${escapeHtml(block.ce || "")}" placeholder="如 H2SO4、SO4^{2-}、CO2" />
          </label>
        `;
      } else if (block.type === "text") {
        els.popBody.innerHTML = `
          <label class="cmp-pop-field">文字内容
            <input type="text" id="cmpPopText" value="${escapeHtml(block.text || "")}" placeholder="例如：主要产物 / 氢键" />
          </label>
        `;
      } else if (block.type === "plus" || block.type === "newline") {
        els.popBody.innerHTML = `<p class="cmp-pop-hint">此积木用于控制分隔或换行，可直接拖动调顺序或删除。</p>`;
      } else {
        const sketchable = isSketchEditableCode(block.code);
        els.popBody.innerHTML = `
          <label class="cmp-pop-field">名称
            <input type="text" id="cmpPopName" value="${escapeHtml(block.name || "")}" />
          </label>
          <label class="cmp-pop-field">LaTeX 结构代码
            <textarea id="cmpPopCode" rows="4" spellcheck="false">${escapeHtml(block.code || "")}</textarea>
          </label>
          ${sketchable
            ? `<div class="cmp-pop-extra">
                <button type="button" class="chip-btn accent" id="cmpPopOpenSketch">⬡ 在 2D 分子画板中编辑结构</button>
              </div>`
            : `<p class="cmp-pop-hint">此积木包含反应框图、机理弯箭头或复合公式，请切到 LaTeX 源码精修（2D 画板仅编辑单个分子结构）。</p>
              <div class="cmp-pop-extra">
                <button type="button" class="chip-btn accent" id="cmpPopOpenCode">&lt;/&gt; 切到 LaTeX 源码精修</button>
              </div>`}
        `;
        document.getElementById("cmpPopOpenSketch")?.addEventListener("click", () => {
          const id = block.id;
          const liveCode = (document.getElementById("cmpPopCode")?.value || block.code || "").trim();
          const liveName = (document.getElementById("cmpPopName")?.value || block.name || "").trim();
          if (!isSketchEditableCode(liveCode)) {
            opts.toast?.("当前代码含反应框图或复合公式，请切到 LaTeX 源码编辑", true);
            return;
          }
          const codeChanged = liveCode !== (block.code || "").trim();
          const sketchData = codeChanged ? null : (block.sketchData || null);
          closePopover();
          opts.onOpenSketch?.({ blockId: id, sketchData, code: liveCode, name: liveName });
        });
        document.getElementById("cmpPopOpenCode")?.addEventListener("click", () => {
          const liveCode = (document.getElementById("cmpPopCode")?.value || block.code || "").trim();
          const liveName = (document.getElementById("cmpPopName")?.value || block.name || "").trim();
          if (liveName && liveName !== block.name) block.name = liveName;
          if (liveCode && liveCode !== (block.code || "").trim()) {
            pushUndo();
            block.code = liveCode;
            block.svg = "";
            syncOutput({ immediate: true });
          }
          closePopover();
          opts.onSwitchToCode?.();
        });
      }

      els.popover.classList.remove("hidden");
    }

    function openConnectorEditor(conn) {
      closePopover();
      st.editingConnId = conn.id;
      els.popTitle.textContent = "编辑连线";
      els.popDelete.classList.remove("hidden");
      els.popBody.innerHTML = `
        <label class="cmp-pop-field">连线样式
          <select id="cmpPopConnStyle">
            <option value="dotted" ${conn.style === "dotted" ? "selected" : ""}>··· 虚线 / 氢键</option>
            <option value="arrow" ${conn.style === "arrow" ? "selected" : ""}>→ 实线箭头</option>
            <option value="curved" ${conn.style === "curved" ? "selected" : ""}>↷ 弯箭头</option>
            <option value="solid" ${conn.style === "solid" ? "selected" : ""}>— 实线</option>
          </select>
        </label>
        <label class="cmp-pop-field">连线旁标注（可选）
          <input type="text" id="cmpPopConnLabel" value="${escapeHtml(conn.label || "")}" placeholder="如：氢键、\\ce{H2O}、$\\Delta$" />
        </label>
      `;
      els.popover.classList.remove("hidden");
    }

    els.popClose.addEventListener("click", closePopover);
    els.popDelete.addEventListener("click", () => {
      pushUndo();
      if (st.editingBlockId) {
        const bid = st.editingBlockId;
        st.blocks = st.blocks.filter((b) => b.id !== bid);
        st.connectors = st.connectors.filter((c) => c.from !== bid && c.to !== bid);
      } else if (st.editingConnId) {
        const cid = st.editingConnId;
        st.connectors = st.connectors.filter((c) => c.id !== cid);
      }
      closePopover();
      render();
      syncOutput({ immediate: true });
    });

    els.popSave.addEventListener("click", () => {
      if (st.editingBlockId) {
        const block = st.blocks.find((b) => b.id === st.editingBlockId);
        if (!block) return closePopover();
        pushUndo();
        if (block.type === "arrow") {
          block.arrowStyle = document.getElementById("cmpPopArrowStyle").value;
          block.top = document.getElementById("cmpPopTop").value;
          block.bottom = document.getElementById("cmpPopBot").value;
          block.svg = "";
          ensureBlockSvg(block);
        } else if (block.type === "ce") {
          block.ce = document.getElementById("cmpPopCe").value.trim() || "H2O";
          block.svg = "";
          ensureBlockSvg(block);
        } else if (block.type === "text") {
          block.text = document.getElementById("cmpPopText").value;
          block.svg = "";
          ensureBlockSvg(block);
        } else if (block.type === "chemfig" || block.type === "raw") {
          block.name = document.getElementById("cmpPopName").value.trim() || block.name;
          const nextCode = document.getElementById("cmpPopCode").value.trim();
          if (nextCode !== block.code) {
            block.code = nextCode;
            block.sketchData = null;
            block.svg = "";
            ensureBlockSvg(block);
          }
        }
      } else if (st.editingConnId) {
        const conn = st.connectors.find((c) => c.id === st.editingConnId);
        if (!conn) return closePopover();
        pushUndo();
        conn.style = document.getElementById("cmpPopConnStyle").value;
        conn.label = document.getElementById("cmpPopConnLabel").value.trim();
      }
      closePopover();
      render();
      syncOutput({ immediate: true });
    });

    // -------------------- Rendering --------------------
    function createBlockVisual(b) {
      const card = document.createElement("div");
      card.className = `cmp-block type-${b.type}${st.selectedBlockId === b.id ? " selected" : ""}${st.connectFromId === b.id ? " connect-src" : ""}`;
      card.dataset.blockId = b.id;

      const miniActions = document.createElement("div");
      miniActions.className = "cmp-block-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "cmp-mini-btn";
      editBtn.textContent = "✎";
      editBtn.title = "编辑积木";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openBlockEditor(b);
      });

      const dupBtn = document.createElement("button");
      dupBtn.type = "button";
      dupBtn.className = "cmp-mini-btn";
      dupBtn.textContent = "⧉";
      dupBtn.title = "复制一份";
      dupBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const copy = cloneData(b);
        copy.id = uid();
        copy.x = (b.x || 60) + 36;
        copy.y = (b.y || 60) + 36;
        const idx = st.blocks.findIndex((x) => x.id === b.id);
        insertBlockAt(copy, idx >= 0 ? idx + 1 : null);
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "cmp-mini-btn del";
      delBtn.textContent = "×";
      delBtn.title = "删除";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        pushUndo();
        st.blocks = st.blocks.filter((x) => x.id !== b.id);
        st.connectors = st.connectors.filter((c) => c.from !== b.id && c.to !== b.id);
        if (st.selectedBlockId === b.id) st.selectedBlockId = null;
        render();
        syncOutput({ immediate: true });
      });

      if (b.type === "chemfig" && isSketchEditableCode(b.code)) {
        const sketchBtn = document.createElement("button");
        sketchBtn.type = "button";
        sketchBtn.className = "cmp-mini-btn";
        sketchBtn.textContent = "⬡";
        sketchBtn.title = "在 2D 分子画板中编辑结构";
        sketchBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          opts.onOpenSketch?.({
            blockId: b.id,
            sketchData: b.sketchData || null,
            code: b.code || "",
            name: b.name || "",
          });
        });
        miniActions.appendChild(sketchBtn);
      }

      miniActions.append(editBtn, dupBtn, delBtn);
      card.appendChild(miniActions);

      const body = document.createElement("div");
      body.className = "cmp-block-body";

      if (b.type === "plus") {
        body.innerHTML = `<span class="cmp-plus-sym">+</span>`;
      } else if (b.type === "newline") {
        body.innerHTML = `<span class="cmp-nl-tag">↵ 换行</span>`;
      } else if (b.type === "arrow") {
        if (b.svg) {
          body.innerHTML = `<div class="cmp-block-thumb">${window.scopeSvgIds(b.svg)}</div>`;
        } else {
          const sym = ARROW_SYMBOLS[b.arrowStyle || "->"] || "→";
          body.innerHTML = `
            <div class="cmp-arrow-viz">
              <span class="cmp-arrow-cond">${escapeHtml(b.top || "") || "&nbsp;"}</span>
              <span class="cmp-arrow-glyph">${sym}</span>
              <span class="cmp-arrow-cond">${escapeHtml(b.bottom || "") || "&nbsp;"}</span>
            </div>
          `;
        }
      } else if (b.type === "text") {
        if (b.svg) {
          body.innerHTML = `<div class="cmp-block-thumb">${window.scopeSvgIds(b.svg)}</div>`;
        } else {
          body.innerHTML = `<span class="cmp-text-pill">${escapeHtml(b.text || "文字")}</span>`;
        }
      } else if (b.type === "ce") {
        if (b.svg) {
          body.innerHTML = `<div class="cmp-block-thumb">${window.scopeSvgIds(b.svg)}</div>`;
        } else {
          body.innerHTML = `<div class="cmp-ce-fallback">${escapeHtml(b.ce || "H2O")}</div>`;
        }
      } else {
        if (b.svg) {
          body.innerHTML = `<div class="cmp-block-thumb">${window.scopeSvgIds(b.svg)}</div>`;
        } else {
          body.innerHTML = `<code class="cmp-code-fallback">${escapeHtml((b.code || "").slice(0, 42))}</code>`;
        }
      }
      card.appendChild(body);

      if (!["plus", "newline", "arrow"].includes(b.type)) {
        const cap = document.createElement("div");
        cap.className = "cmp-block-cap";
        cap.textContent = b.name || b.type;
        card.appendChild(cap);
      }

      card.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        openBlockEditor(b);
      });

      card.addEventListener("click", (e) => {
        e.stopPropagation();
        if (st.justDragged) return;
        if (st.layoutMode === "free" && st.connectTool) {
          if (!st.connectFromId) {
            st.connectFromId = b.id;
            renderCanvas();
          } else if (st.connectFromId !== b.id) {
            pushUndo();
            st.connectors.push({
              id: uid("conn"),
              from: st.connectFromId,
              to: b.id,
              style: st.connectTool,
              label: st.connectTool === "dotted" ? "氢键" : "",
            });
            st.connectFromId = null;
            renderCanvas();
            syncOutput();
          } else {
            st.connectFromId = null;
            renderCanvas();
          }
          return;
        }
        st.selectedBlockId = b.id;
        renderCanvas();
      });

      return card;
    }

    function renderFlowStage() {
      const stage = els.canvas;
      stage.className = "cmp-canvas cmp-flow-stage";
      stage.innerHTML = "";

      if (st.blocks.length === 0) {
        const empty = document.createElement("div");
        empty.className = "cmp-empty";
        empty.innerHTML = `
          <strong>把左侧模板 / 分子卡片，或上方 <code>+</code> <code>→</code> <code>\\ce{}</code> 拖到这里组合</strong>
          <p>也可以直接点击左侧卡片加入反应流，双击积木修改条件或用 2D 画板绘制</p>
          <div class="cmp-empty-actions">
            <button type="button" class="chip-btn accent" data-empty-act="hydration">载入丙烯水合示例</button>
            <button type="button" class="chip-btn" data-empty-act="hbond">载入氢键示例</button>
            <button type="button" class="chip-btn" data-empty-act="sketch">打开 2D 画板</button>
          </div>
        `;
        empty.querySelector('[data-empty-act="hydration"]')?.addEventListener("click", () => loadPreset("hydration"));
        empty.querySelector('[data-empty-act="hbond"]')?.addEventListener("click", () => loadPreset("hbond"));
        empty.querySelector('[data-empty-act="sketch"]')?.addEventListener("click", () => {
          opts.onOpenSketch?.({ blockId: null, sketchData: null });
        });
        stage.appendChild(empty);
      } else {
        const rows = [];
        let cur = [];
        st.blocks.forEach((b, i) => {
          if (b.type === "newline") {
            rows.push({ items: cur, nlBlock: b, nlIndex: i });
            cur = [];
          } else {
            cur.push({ block: b, index: i });
          }
        });
        rows.push({ items: cur, nlBlock: null, nlIndex: st.blocks.length });

        rows.forEach((row) => {
          const rowEl = document.createElement("div");
          rowEl.className = "cmp-flow-row";

          row.items.forEach(({ block, index }) => {
            const slot = createDropSlot(index);
            rowEl.appendChild(slot);

            const card = createBlockVisual(block);
            card.draggable = true;
            card.addEventListener("dragstart", (e) => {
              st.dragBlockId = block.id;
              card.classList.add("dragging");
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/x-chemlatex-reorder", block.id);
            });
            card.addEventListener("dragend", () => {
              st.dragBlockId = null;
              card.classList.remove("dragging");
              stage.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
            });
            rowEl.appendChild(card);
          });

          rowEl.appendChild(createDropSlot(row.nlIndex));
          stage.appendChild(rowEl);

          if (row.nlBlock) {
            const sep = document.createElement("div");
            sep.className = "cmp-row-break";
            sep.innerHTML = `<span>↵ 换行（下一步反应）</span>`;
            const delNl = document.createElement("button");
            delNl.type = "button";
            delNl.className = "cmp-mini-btn del";
            delNl.textContent = "×";
            delNl.title = "合并上下两行";
            delNl.addEventListener("click", () => {
              pushUndo();
              st.blocks = st.blocks.filter((x) => x.id !== row.nlBlock.id);
              render();
              syncOutput({ immediate: true });
            });
            sep.appendChild(delNl);
            stage.appendChild(sep);
          }
        });
      }

      // Stage-level fallback drop
      stage.ondragover = (e) => {
        e.preventDefault();
        stage.classList.add("drag-over");
      };
      stage.ondragleave = (e) => {
        if (e.target === stage) stage.classList.remove("drag-over");
      };
      stage.ondrop = (e) => {
        e.preventDefault();
        stage.classList.remove("drag-over");
        handleDropAt(e, st.blocks.length, null);
      };
    }

    function createDropSlot(insertIndex) {
      const slot = document.createElement("div");
      slot.className = "cmp-drop-slot";
      slot.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        slot.classList.add("drag-over");
      });
      slot.addEventListener("dragleave", () => {
        slot.classList.remove("drag-over");
      });
      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        slot.classList.remove("drag-over");
        handleDropAt(e, insertIndex, null);
      });
      return slot;
    }

    function drawFreeConnectors(svgEl) {
      svgEl.innerHTML = "";
      const defs = document.createElementNS(SVG_NS, "defs");
      const marker = document.createElementNS(SVG_NS, "marker");
      marker.setAttribute("id", "cmpArrowHead");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "8");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "7");
      marker.setAttribute("markerHeight", "7");
      marker.setAttribute("orient", "auto-start-reverse");
      const poly = document.createElementNS(SVG_NS, "path");
      poly.setAttribute("d", "M 0 1 L 10 5 L 0 9 z");
      poly.setAttribute("fill", "#0f766e");
      marker.appendChild(poly);
      defs.appendChild(marker);
      svgEl.appendChild(defs);

      for (const c of st.connectors) {
        const el1 = st.blockEls.get(c.from);
        const el2 = st.blockEls.get(c.to);
        if (!el1 || !el2) continue;

        const x1 = el1.offsetLeft + el1.offsetWidth / 2;
        const y1 = el1.offsetTop + el1.offsetHeight / 2;
        const x2 = el2.offsetLeft + el2.offsetWidth / 2;
        const y2 = el2.offsetTop + el2.offsetHeight / 2;

        let pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
        let labelX = (x1 + x2) / 2;
        let labelY = (y1 + y2) / 2 - 8;

        if (c.style === "curved") {
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const cx = (x1 + x2) / 2 + nx * 42;
          const cy = (y1 + y2) / 2 + ny * 42;
          pathD = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
          labelX = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
          labelY = 0.25 * y1 + 0.5 * cy + 0.25 * y2 - 6;
        }

        const g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("class", "cmp-conn-group");

        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", pathD);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#0f766e");
        path.setAttribute("stroke-width", "2.2");
        if (c.style === "dotted") path.setAttribute("stroke-dasharray", "4 5");
        if (c.style === "arrow" || c.style === "curved") {
          path.setAttribute("marker-end", "url(#cmpArrowHead)");
        }
        g.appendChild(path);

        const hit = document.createElementNS(SVG_NS, "path");
        hit.setAttribute("d", pathD);
        hit.setAttribute("fill", "none");
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", "14");
        hit.style.cursor = "pointer";
        hit.style.pointerEvents = "stroke";
        hit.addEventListener("click", (e) => {
          e.stopPropagation();
          openConnectorEditor(c);
        });
        g.appendChild(hit);

        const lblText = c.label || "···";
        const txt = document.createElementNS(SVG_NS, "text");
        txt.setAttribute("x", String(labelX));
        txt.setAttribute("y", String(labelY));
        txt.setAttribute("text-anchor", "middle");
        txt.setAttribute("font-size", "11");
        txt.setAttribute("font-weight", "600");
        txt.setAttribute("fill", "#0f766e");
        txt.style.cursor = "pointer";
        txt.style.pointerEvents = "all";
        txt.textContent = lblText;
        txt.addEventListener("click", (e) => {
          e.stopPropagation();
          openConnectorEditor(c);
        });
        g.appendChild(txt);

        if (c.label && hasLatexAnnotation(c.label)) {
          const label = c.label.trim();
          const snippet = formatAnnotationLatex(label);
          renderAnnotationSvg(snippet).then((renderedSvg) => {
            const current = st.connectors.find((item) => item.id === c.id);
            if (!renderedSvg || !g.isConnected || !current || current.label.trim() !== label) return;
            const scopedSvg = (window.scopeSvgIds || ((value) => value))(renderedSvg);
            const parsed = new DOMParser().parseFromString(scopedSvg, "image/svg+xml");
            const root = parsed.documentElement;
            const viewBox = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
            if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) return;

            const height = Math.max(12, Number(txt.getAttribute("font-size")) * 1.4);
            const width = (viewBox[2] / viewBox[3]) * height;
            const embedded = document.importNode(root, true);
            embedded.setAttribute("x", String(labelX - width / 2));
            embedded.setAttribute("y", String(labelY - height / 2));
            embedded.setAttribute("width", String(width));
            embedded.setAttribute("height", String(height));
            embedded.setAttribute("preserveAspectRatio", "xMidYMid meet");
            embedded.style.cursor = "pointer";
            embedded.addEventListener("click", (e) => {
              e.stopPropagation();
              openConnectorEditor(c);
            });
            txt.setAttribute("visibility", "hidden");
            g.appendChild(embedded);
          }).catch(() => {});
        }

        svgEl.appendChild(g);
      }
    }

    function renderFreeStage() {
      const stage = els.canvas;
      stage.className = "cmp-canvas cmp-free-stage";
      stage.innerHTML = "";
      st.blockEls.clear();

      const svgEl = document.createElementNS(SVG_NS, "svg");
      svgEl.setAttribute("class", "cmp-conn-svg");
      stage.appendChild(svgEl);

      const guideH = document.createElement("div");
      guideH.className = "cmp-guide-h hidden";
      const guideV = document.createElement("div");
      guideV.className = "cmp-guide-v hidden";
      stage.append(guideH, guideV);

      const active = st.blocks.filter((b) => b.type !== "newline");
      const maxBx = active.reduce((m, b) => Math.max(m, (b.x || 40) + blockSizePx(b).w + 80), 680);
      const maxBy = active.reduce((m, b) => Math.max(m, (b.y || 40) + blockSizePx(b).h + 80), 360);
      svgEl.style.width = `${maxBx}px`;
      svgEl.style.height = `${maxBy}px`;

      if (active.length === 0) {
        const empty = document.createElement("div");
        empty.className = "cmp-empty";
        empty.innerHTML = `
          <strong>自由画布模式：把任意积木拖到画布自由定位</strong>
          <p>可用上方连线工具为两个积木拉出“氢键虚线”或“弯曲箭头”</p>
        `;
        stage.appendChild(empty);
      }

      active.forEach((b) => {
        const card = createBlockVisual(b);
        card.draggable = false;
        card.style.left = `${b.x || 40}px`;
        card.style.top = `${b.y || 40}px`;

        card.addEventListener("mousedown", (e) => {
          if (e.button !== 0 || e.target.closest(".cmp-block-actions")) return;
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const origX = b.x || 40;
          const origY = b.y || 40;
          let moved = false;

          const onMove = (me) => {
            const dx = me.clientX - startX;
            const dy = me.clientY - startY;
            if (!moved && Math.hypot(dx, dy) > 4) {
              moved = true;
              pushUndo();
            }
            if (!moved) return;
            let nx = Math.max(8, Math.round((origX + dx) / 8) * 8);
            let ny = Math.max(8, Math.round((origY + dy) / 8) * 8);

            // Magnetic alignment to sibling blocks
            let snapV = null;
            let snapH = null;
            const myCx = nx + card.offsetWidth / 2;
            const myCy = ny + card.offsetHeight / 2;
            for (const sib of active) {
              if (sib.id === b.id) continue;
              const sibEl = st.blockEls.get(sib.id);
              if (!sibEl) continue;
              const scx = (sib.x || 0) + sibEl.offsetWidth / 2;
              const scy = (sib.y || 0) + sibEl.offsetHeight / 2;
              if (Math.abs(myCx - scx) <= 8) {
                nx = Math.round(scx - card.offsetWidth / 2);
                snapV = scx;
              }
              if (Math.abs(myCy - scy) <= 8) {
                ny = Math.round(scy - card.offsetHeight / 2);
                snapH = scy;
              }
            }
            guideV.classList.toggle("hidden", snapV === null);
            if (snapV !== null) guideV.style.left = `${snapV}px`;
            guideH.classList.toggle("hidden", snapH === null);
            if (snapH !== null) guideH.style.top = `${snapH}px`;

            b.x = nx;
            b.y = ny;
            card.style.left = `${nx}px`;
            card.style.top = `${ny}px`;
            svgEl.style.width = `${Math.max(parseInt(svgEl.style.width, 10) || 680, nx + card.offsetWidth + 80)}px`;
            svgEl.style.height = `${Math.max(parseInt(svgEl.style.height, 10) || 360, ny + card.offsetHeight + 80)}px`;
            drawFreeConnectors(svgEl);
          };

          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            guideH.classList.add("hidden");
            guideV.classList.add("hidden");
            if (moved) {
              st.justDragged = true;
              setTimeout(() => { st.justDragged = false; }, 0);
              syncOutput({ immediate: true });
            }
          };

          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        });

        stage.appendChild(card);
        st.blockEls.set(b.id, card);
      });

      requestAnimationFrame(() => drawFreeConnectors(svgEl));

      stage.onclick = () => {
        if (st.justDragged) return;
        st.connectFromId = null;
        st.selectedBlockId = null;
        renderCanvas();
      };

      stage.ondragover = (e) => {
        e.preventDefault();
        stage.classList.add("drag-over");
      };
      stage.ondragleave = (e) => {
        if (e.target === stage) stage.classList.remove("drag-over");
      };
      stage.ondrop = (e) => {
        e.preventDefault();
        stage.classList.remove("drag-over");
        const rect = stage.getBoundingClientRect();
        const x = Math.max(12, Math.round((e.clientX - rect.left + stage.scrollLeft - 45) / 8) * 8);
        const y = Math.max(12, Math.round((e.clientY - rect.top + stage.scrollTop - 28) / 8) * 8);
        handleDropAt(e, st.blocks.length, { x, y });
      };
    }

    function handleDropAt(e, insertIndex, freePos) {
      const reorderId = e.dataTransfer?.getData("application/x-chemlatex-reorder");
      if (reorderId) {
        const oldIdx = st.blocks.findIndex((b) => b.id === reorderId);
        if (oldIdx === -1) return;
        pushUndo();
        const [moved] = st.blocks.splice(oldIdx, 1);
        const targetIdx = insertIndex > oldIdx ? insertIndex - 1 : insertIndex;
        st.blocks.splice(Math.max(0, Math.min(st.blocks.length, targetIdx)), 0, moved);
        render();
        syncOutput({ immediate: true });
        return;
      }

      const libRaw = e.dataTransfer?.getData("application/x-chemlatex-lib");
      if (libRaw) {
        try {
          const item = JSON.parse(libRaw);
          addBlockFromLibrary(item, insertIndex, freePos);
          opts.toast?.(`已拖入：${item.name}`);
        } catch {
          // Ignore invalid drag payload
        }
        return;
      }

      const palRaw = e.dataTransfer?.getData("application/x-chemlatex-palette");
      if (palRaw) {
        try {
          const spec = JSON.parse(palRaw);
          const blk = makeBlockFromPalette(spec, freePos);
          if (blk) {
            insertBlockAt(blk, insertIndex);
            if (blk.type === "ce" || blk.type === "arrow" || blk.type === "text") {
              openBlockEditor(blk);
            }
          }
        } catch {
          // Ignore
        }
      }
    }

    function renderPalette() {
      els.palette.innerHTML = "";
      PALETTE_ITEMS.forEach((spec) => {
        if (spec.kind === "newline" && st.layoutMode !== "flow") return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cmp-chip";
        btn.draggable = true;
        btn.title = `${spec.title}（可点击或直接拖到下方画布）`;
        btn.innerHTML = `<strong>${escapeHtml(spec.label)}</strong><span>${escapeHtml(spec.sub)}</span>`;
        btn.addEventListener("dragstart", (e) => {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData("application/x-chemlatex-palette", JSON.stringify(spec));
        });
        btn.addEventListener("click", () => {
          const blk = makeBlockFromPalette(spec);
          if (blk) {
            insertBlockAt(blk);
            if (blk.type === "ce" || blk.type === "arrow" || blk.type === "text") {
              openBlockEditor(blk);
            }
          }
        });
        els.palette.appendChild(btn);
      });
    }

    function renderCanvas() {
      if (st.layoutMode === "flow") {
        renderFlowStage();
      } else {
        renderFreeStage();
      }
    }

    function render() {
      els.flowBtn.classList.toggle("active", st.layoutMode === "flow");
      els.freeBtn.classList.toggle("active", st.layoutMode === "free");
      els.connBar.classList.toggle("hidden", st.layoutMode !== "free");
      els.connBar.querySelectorAll("[data-conn-style]").forEach((b) => {
        b.classList.toggle("active", (st.connectTool || "") === (b.dataset.connStyle || ""));
      });
      renderPalette();
      renderCanvas();
    }

    // -------------------- Control Wiring --------------------
    els.flowBtn.addEventListener("click", () => {
      if (st.layoutMode === "flow") return;
      st.layoutMode = "flow";
      st.connectTool = null;
      st.connectFromId = null;
      render();
      syncOutput({ immediate: true });
    });

    els.freeBtn.addEventListener("click", () => {
      if (st.layoutMode === "free") return;
      st.layoutMode = "free";
      render();
      if (autoLayoutFreeBlocks({ onlyIfOverlapping: true })) {
        render();
      }
      syncOutput({ immediate: true });
    });

    els.connBar.querySelectorAll("[data-conn-style]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = btn.dataset.connStyle || null;
        st.connectTool = s ? (st.connectTool === s ? null : s) : null;
        st.connectFromId = null;
        render();
        if (st.connectTool) {
          opts.toast?.(`已开启「${CONNECTOR_LABELS[st.connectTool]}」：依次点击两个积木连线，仍可直接拖动积木`);
        }
      });
    });

    els.autoAlignBtn.addEventListener("click", () => {
      const active = st.blocks.filter((b) => b.type !== "newline");
      if (active.length === 0) return;
      pushUndo();
      autoLayoutFreeBlocks({ onlyIfOverlapping: false });
      render();
      syncOutput({ immediate: true });
    });

    function performUndo() {
      if (st.undoStack.length === 0) return false;
      st.redoStack.push(cloneData({ layoutMode: st.layoutMode, blocks: st.blocks, connectors: st.connectors }));
      const prev = st.undoStack.pop();
      st.layoutMode = prev.layoutMode;
      st.blocks = prev.blocks;
      st.connectors = prev.connectors;
      closePopover();
      render();
      syncOutput({ immediate: true });
      return true;
    }

    function performRedo() {
      if (st.redoStack.length === 0) return false;
      st.undoStack.push(cloneData({ layoutMode: st.layoutMode, blocks: st.blocks, connectors: st.connectors }));
      const nxt = st.redoStack.pop();
      st.layoutMode = nxt.layoutMode;
      st.blocks = nxt.blocks;
      st.connectors = nxt.connectors;
      closePopover();
      render();
      syncOutput({ immediate: true });
      return true;
    }

    function deleteSelected() {
      if (!st.selectedBlockId) return false;
      const idx = st.blocks.findIndex((b) => b.id === st.selectedBlockId);
      if (idx === -1) return false;
      pushUndo();
      const bid = st.selectedBlockId;
      st.blocks.splice(idx, 1);
      st.connectors = st.connectors.filter((c) => c.from !== bid && c.to !== bid);
      st.selectedBlockId = null;
      closePopover();
      render();
      syncOutput({ immediate: true });
      return true;
    }

    function handleEscape() {
      if (!els.popover.classList.contains("hidden")) {
        closePopover();
        return true;
      }
      if (st.connectTool || st.connectFromId) {
        st.connectTool = null;
        st.connectFromId = null;
        render();
        return true;
      }
      return false;
    }

    els.undoBtn.addEventListener("click", performUndo);
    els.redoBtn?.addEventListener("click", performRedo);

    els.clearBtn.addEventListener("click", () => {
      if (st.blocks.length === 0) return;
      pushUndo();
      st.blocks = [];
      st.connectors = [];
      st.selectedBlockId = null;
      closePopover();
      render();
      syncOutput({ immediate: true });
    });

    els.presetHydration?.addEventListener("click", () => {
      els.presetHydration.closest(".dropdown-wrap")?.classList.remove("open");
      loadPreset("hydration");
    });
    els.presetHBond?.addEventListener("click", () => {
      els.presetHBond.closest(".dropdown-wrap")?.classList.remove("open");
      loadPreset("hbond");
    });
    els.switchCodeBtn?.addEventListener("click", () => opts.onSwitchToCode?.());

    // Restore from localStorage or load default reaction example
    let restoredFromStorage = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
          st.layoutMode = parsed.layoutMode === "free" ? "free" : "flow";
          st.blocks = parsed.blocks;
          st.connectors = Array.isArray(parsed.connectors) ? parsed.connectors : [];
          restoredFromStorage = true;
        }
      }
    } catch {
      // Ignore corrupt storage
    }
    if (restoredFromStorage) {
      render();
      st.blocks.forEach((b) => ensureBlockSvg(b));
    } else {
      loadPreset("hydration", { silent: opts.autoSync === false });
    }

    // -------------------- Ribbon & Bidirectional LaTeX Sync --------------------
    function extractBalanced(str, openPos, openCh, closeCh) {
      let depth = 1;
      let i = openPos + 1;
      while (i < str.length && depth > 0) {
        const c = str[i];
        if (c === openCh && str[i - 1] !== "\\") depth++;
        else if (c === closeCh && str[i - 1] !== "\\") depth--;
        i++;
      }
      if (depth !== 0) return null;
      return { content: str.slice(openPos + 1, i - 1), end: i };
    }

    function parseArrowArg(raw) {
      const m = raw.match(/^(<=>|<->|->|<-)\s*(.*)$/s);
      if (!m) return { arrowStyle: "->", top: "", bottom: "" };
      const arrowStyle = m[1];
      let rest = m[2].trim();
      let top = "";
      let bottom = "";
      if (rest.startsWith("[")) {
        const b1 = extractBalanced(rest, 0, "[", "]");
        if (b1) {
          top = b1.content.trim();
          rest = rest.slice(b1.end).trim();
          if (rest.startsWith("[")) {
            const b2 = extractBalanced(rest, 0, "[", "]");
            if (b2) bottom = b2.content.trim();
          }
        }
      }
      return { arrowStyle, top, bottom };
    }

    function parseSchemeTokens(body, oldByCode) {
      const blocks = [];
      let i = 0;
      const n = body.length;
      while (i < n) {
        while (i < n && /\s/.test(body[i])) i++;
        if (i >= n) break;

        if (body.startsWith("\\+", i)) {
          blocks.push({ id: uid(), type: "plus", name: "加号", ...nextFreeCoords() });
          i += 2;
          continue;
        }
        if (body.startsWith("\\chemfig", i)) {
          let p = i + 8;
          while (p < n && /\s/.test(body[p])) p++;
          for (let k = 0; k < 2; k++) {
            if (p < n && body[p] === "[") {
              const opt = extractBalanced(body, p, "[", "]");
              if (!opt) return null;
              p = opt.end;
              while (p < n && /\s/.test(body[p])) p++;
            }
          }
          if (p >= n || body[p] !== "{") return null;
          const arg = extractBalanced(body, p, "{", "}");
          if (!arg) return null;
          const full = body.slice(i, arg.end).trim();
          const prev = oldByCode.get(full);
          blocks.push({
            id: uid(),
            type: "chemfig",
            name: prev?.name || "分子结构",
            code: full,
            svg: prev?.svg || "",
            sketchData: prev?.sketchData || null,
            ...nextFreeCoords(),
          });
          i = arg.end;
          continue;
        }
        if (body.startsWith("\\ce", i) && !/[A-Za-z]/.test(body[i + 3] || "")) {
          let p = i + 3;
          while (p < n && /\s/.test(body[p])) p++;
          if (p >= n || body[p] !== "{") return null;
          const arg = extractBalanced(body, p, "{", "}");
          if (!arg) return null;
          const ceVal = arg.content.trim();
          const prev = oldByCode.get(`\\ce{${ceVal}}`);
          blocks.push({
            id: uid(),
            type: "ce",
            name: prev?.name || "化学式",
            ce: ceVal,
            svg: prev?.svg || "",
            ...nextFreeCoords(),
          });
          i = arg.end;
          continue;
        }
        if (body.startsWith("\\arrow", i)) {
          let p = i + 6;
          while (p < n && /\s/.test(body[p])) p++;
          if (p >= n || body[p] !== "{") return null;
          const arg = extractBalanced(body, p, "{", "}");
          if (!arg) return null;
          const parsedArr = parseArrowArg(arg.content.trim());
          blocks.push({
            id: uid(),
            type: "arrow",
            name: "反应箭头",
            ...parsedArr,
            ...nextFreeCoords(),
          });
          i = arg.end;
          continue;
        }
        if (body.startsWith("\\text", i) && !/[A-Za-z]/.test(body[i + 5] || "")) {
          let p = i + 5;
          while (p < n && /\s/.test(body[p])) p++;
          if (p >= n || body[p] !== "{") return null;
          const arg = extractBalanced(body, p, "{", "}");
          if (!arg) return null;
          blocks.push({
            id: uid(),
            type: "text",
            name: "文字标注",
            text: arg.content.trim(),
            ...nextFreeCoords(),
          });
          i = arg.end;
          continue;
        }
        // Unrecognized token inside schemestart -> fallback to raw block
        return null;
      }
      return blocks.length > 0 ? blocks : null;
    }

    function syncFromLatex(rawCode, { recordUndo = true, fallbackName = "自定义 LaTeX", fallbackSvg = "" } = {}) {
      const code = (rawCode || "").trim();
      const curGen = generateLatex().trim();
      if (code === curGen) {
        return { synced: false, fallbackRaw: false };
      }

      if (recordUndo && st.blocks.length > 0) {
        pushUndo();
      }

      const oldByCode = new Map();
      for (const b of st.blocks) {
        const key = blockLatex(b).trim();
        if (key && !oldByCode.has(key)) oldByCode.set(key, b);
      }

      closePopover();
      if (!code) {
        st.blocks = [];
        st.connectors = [];
        st.selectedBlockId = null;
        render();
        saveLocal();
        return { synced: true, fallbackRaw: false };
      }

      // Parse \schemestart ... \schemestop rows when there is no external \chemmove / tikzpicture
      if (
        code.includes("\\schemestart") &&
        !code.includes("\\chemmove") &&
        !code.includes("\\begin{tikzpicture}")
      ) {
        const rowRegex = /\\schemestart([\s\S]*?)\\schemestop/g;
        const rows = [];
        let m;
        let consumed = "";
        while ((m = rowRegex.exec(code)) !== null) {
          rows.push(m[1]);
          consumed += m[0];
        }
        const leftover = code
          .replace(rowRegex, "")
          .replace(/\\par|\\medskip|\\bigskip|\\\\/g, "")
          .trim();
        if (rows.length > 0 && !leftover) {
          const allBlocks = [];
          let ok = true;
          rows.forEach((rowBody, rIdx) => {
            if (!ok) return;
            const parsed = parseSchemeTokens(rowBody, oldByCode);
            if (!parsed) {
              ok = false;
              return;
            }
            if (rIdx > 0) allBlocks.push({ id: uid(), type: "newline", name: "换行", x: 40, y: 80 });
            allBlocks.push(...parsed);
          });
          if (ok && allBlocks.length > 0) {
            st.layoutMode = "flow";
            st.connectors = [];
            st.blocks = allBlocks;
            st.selectedBlockId = allBlocks[0].id;
            render();
            saveLocal();
            st.blocks.forEach((b) => ensureBlockSvg(b));
            return { synced: true, fallbackRaw: false };
          }
        }
      }

      // Single \chemfig{...}
      if (code.startsWith("\\chemfig")) {
        const parsed = parseSchemeTokens(code, oldByCode);
        if (parsed && parsed.length === 1 && parsed[0].type === "chemfig") {
          if (fallbackName && fallbackName !== "自定义 LaTeX") parsed[0].name = fallbackName;
          if (!parsed[0].svg && fallbackSvg) parsed[0].svg = fallbackSvg;
          st.layoutMode = "flow";
          st.connectors = [];
          st.blocks = parsed;
          st.selectedBlockId = parsed[0].id;
          render();
          saveLocal();
          ensureBlockSvg(parsed[0]);
          return { synced: true, fallbackRaw: false };
        }
      }

      // Single simple \ce{...}
      const ceSingle = code.match(/^\\ce\{([\s\S]+)\}$/);
      if (ceSingle && !code.includes("->") && !code.includes("<=>")) {
        const blk = {
          id: uid(),
          type: "ce",
          name: oldByCode.get(code)?.name || fallbackName || "化学式",
          ce: ceSingle[1].trim(),
          svg: oldByCode.get(code)?.svg || fallbackSvg || "",
          x: 60,
          y: 80,
        };
        st.layoutMode = "flow";
        st.connectors = [];
        st.blocks = [blk];
        st.selectedBlockId = blk.id;
        render();
        saveLocal();
        ensureBlockSvg(blk);
        return { synced: true, fallbackRaw: false };
      }

      // Fallback: represent arbitrary edited LaTeX/TikZ as a single raw block so composer stays 100% consistent
      const rawBlk = {
        id: uid(),
        type: "raw",
        name: fallbackName || "自定义 LaTeX",
        code,
        svg: oldByCode.get(code)?.svg || fallbackSvg || "",
        x: 60,
        y: 80,
      };
      st.layoutMode = "flow";
      st.connectors = [];
      st.blocks = [rawBlk];
      st.selectedBlockId = rawBlk.id;
      render();
      saveLocal();
      ensureBlockSvg(rawBlk);
      return { synced: true, fallbackRaw: true };
    }

    function insertIntoOpenPopover(item) {
      if (els.popover.classList.contains("hidden")) return false;
      const inputs = Array.from(els.popBody.querySelectorAll("textarea, input[type='text']"));
      if (inputs.length === 0) return false;
      const target = inputs.includes(document.activeElement) ? document.activeElement : inputs[0];
      const text = item.snippet || "";
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.value = target.value.slice(0, start) + text + target.value.slice(end);
      target.focus();
      target.setSelectionRange(start + text.length, start + text.length);
      return true;
    }

    function addBlockFromRibbon(item) {
      const id = item.id || "";
      // 1) Ring skeletons & standalone chemfig groups
      if (id.startsWith("r_") || id.startsWith("fg_") || id === "rx_cf") {
        const snippet = (item.snippet || "").trim();
        const code = snippet.startsWith("\\chemfig") ? snippet : `\\chemfig{${snippet}}`;
        const blk = {
          id: uid(),
          type: "chemfig",
          name: item.sub || item.label || "分子结构",
          code,
          svg: "",
          ...nextFreeCoords(),
        };
        insertBlockAt(blk);
        return true;
      }
      // 2) Reaction arrows & plus & \ce{}
      if (id === "sc_plus") {
        insertBlockAt(makeBlockFromPalette({ kind: "plus" }));
        return true;
      }
      if (id === "rx_ce") {
        const blk = makeBlockFromPalette({ kind: "ce" });
        insertBlockAt(blk);
        openBlockEditor(blk);
        return true;
      }
      if (id === "rx_arr") {
        insertBlockAt(makeBlockFromPalette({ kind: "arrow", arrowStyle: "->" }));
        return true;
      }
      if (id === "rx_eq") {
        insertBlockAt(makeBlockFromPalette({ kind: "arrow", arrowStyle: "<=>" }));
        return true;
      }
      if (id === "rx_res") {
        insertBlockAt(makeBlockFromPalette({ kind: "arrow", arrowStyle: "<->" }));
        return true;
      }
      if (id === "rx_heat") {
        insertBlockAt({ id: uid(), type: "arrow", name: "反应箭头", arrowStyle: "->", top: "$\\Delta$", bottom: "", ...nextFreeCoords() });
        return true;
      }
      if (id === "rx_hv") {
        insertBlockAt({ id: uid(), type: "arrow", name: "反应箭头", arrowStyle: "->", top: "$h\\nu$", bottom: "", ...nextFreeCoords() });
        return true;
      }
      if (id === "rx_cond") {
        insertBlockAt({ id: uid(), type: "arrow", name: "反应箭头", arrowStyle: "->", top: "催化剂", bottom: "高温、高压", ...nextFreeCoords() });
        return true;
      }
      if (id === "sc_arrow" || id === "sc_step" || id === "sc_eq") {
        const m = (item.snippet || "").match(/\\arrow\{([\s\S]+)\}/);
        const parsed = m ? parseArrowArg(m[1]) : { arrowStyle: "->", top: "", bottom: "" };
        insertBlockAt({ id: uid(), type: "arrow", name: "反应箭头", ...parsed, ...nextFreeCoords() });
        return true;
      }
      if (id === "sc_block") {
        syncFromLatex(item.snippet || "");
        syncOutput({ immediate: true });
        return true;
      }
      if (id === "m_disp" || id === "m_inl" || id === "tk_env" || id === "sc_move") {
        const blk = {
          id: uid(),
          type: "raw",
          name: item.sub || item.label || "公式块",
          code: (item.standalone || item.snippet || "").trim(),
          svg: "",
          ...nextFreeCoords(),
        };
        insertBlockAt(blk);
        return true;
      }
      // Syntax-level tokens (bonds b_*, angles ang_*, branches br_*, charges g_*, etc.)
      return false;
    }

    function getSelectedBlock() {
      return st.blocks.find((b) => b.id === st.selectedBlockId) || null;
    }

    return {
      addBlockFromLibrary,
      addBlockFromRibbon,
      insertIntoOpenPopover,
      upsertSketchBlock,
      syncFromLatex,
      getSelectedBlock,
      getGeneratedLatex: () => generateLatex().trim(),
      getMode: () => st.layoutMode,
      syncNow: (syncOpts) => syncOutput(syncOpts || { immediate: true }),
      loadPreset,
      undo: performUndo,
      redo: performRedo,
      deleteSelected,
      handleEscape,
      isStandaloneEnvCode,
      hasBlocks: () => st.blocks.some((b) => b.type !== "newline"),
    };
  }

  window.ChemComposer = { init };
})();
