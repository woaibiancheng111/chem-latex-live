(() => {
  "use strict";

  const STORAGE_KEYS = {
    theme: "chemlatex_theme",
    code: "chemlatex_code",
    editorMode: "chemlatex_editor_mode",
    history: "chemlatex_history",
    favorites: "chemlatex_favorites",
    splitPct: "chemlatex_split_pct",
    sidePanelTab: "chemlatex_side_tab",
    sidePanelOpen: "chemlatex_side_open",
    sidePanelWidth: "chemlatex_side_width",
    wordWrap: "chemlatex_word_wrap",
    previewBg: "chemlatex_preview_bg",
  };

  const DEFAULT_CODE =
    "\\schemestart\n  \\chemfig{=[:30]-[:-30]}\n  \\arrow{->[\\ce{H2SO4}, \\ce{H2O}][$\\Delta$]}\n  \\chemfig{-[:30](-[2]OH)-[:-30]}\n\\schemestop";

  const AUTOCOMPLETE_ITEMS = [
    { cmd: "\\chemfig{", insert: "\\chemfig{", close: "}", desc: "二维结构式环境" },
    { cmd: "\\ce{", insert: "\\ce{", close: "}", desc: "mhchem 化学式/方程式" },
    { cmd: "\\pu{", insert: "\\pu{", close: "}", desc: "物理化学单位" },
    { cmd: "\\schemestart", insert: "\\schemestart\n  \n\\schemestop", desc: "反应框图块" },
    { cmd: "\\arrow{->}", insert: "\\arrow{->[", close: "][]}", desc: "框图条件箭头" },
    { cmd: "\\chemmove{", insert: "\\chemmove{\\draw[->,shorten <=2pt,shorten >=2pt](", close: ")..controls +(120:6mm) and +(90:6mm)..();}", desc: "电子转移弯箭头" },
    { cmd: "\\charge{", insert: "\\charge{90=\\:}{", close: "}", desc: "孤对电子 / 电荷标注" },
    { cmd: "\\chemabove{", insert: "\\chemabove{", close: "}{}", desc: "原子上方标注" },
    { cmd: "\\chembelow{", insert: "\\chembelow{", close: "}{}", desc: "原子下方标注" },
    { cmd: "\\polymerdelim", insert: "\\polymerdelim[height=6pt,indice=n]{", close: "}", desc: "高分子括号" },
    { cmd: "\\Delta", insert: "\\Delta", desc: "加热 / 变化量 Δ" },
    { cmd: "\\ominus", insert: "\\ominus", desc: "标准态 / 圈负号 ⊖" },
    { cmd: "\\oplus", insert: "\\oplus", desc: "圈正号 ⊕" },
    { cmd: "\\bullet", insert: "\\bullet", desc: "自由基点 ·" },
    { cmd: "\\prime", insert: "\\prime", desc: "撇号 ′" },
    { cmd: "\\alpha", insert: "\\alpha", desc: "希腊字母 α" },
    { cmd: "\\beta", insert: "\\beta", desc: "希腊字母 β" },
    { cmd: "\\gamma", insert: "\\gamma", desc: "希腊字母 γ" },
    { cmd: "\\nu", insert: "\\nu", desc: "化学计量数/频率 ν" },
    { cmd: "\\lambda", insert: "\\lambda", desc: "波长 λ" },
    { cmd: "\\frac{", insert: "\\frac{", close: "}{}", desc: "分式 a/b" },
    { cmd: "\\sqrt{", insert: "\\sqrt{", close: "}", desc: "平方根" },
    { cmd: "\\mathrm{", insert: "\\mathrm{", close: "}", desc: "正体字母" },
    { cmd: "\\text{", insert: "\\text{", close: "}", desc: "公式内中文/正体" },
    { cmd: "\\begin{tikzpicture}", insert: "\\begin{tikzpicture}[x=1cm,y=1cm,line cap=round,line join=round]\n  \n\\end{tikzpicture}", desc: "TikZ 绘图画布" },
    { cmd: "\\draw", insert: "\\draw ", desc: "TikZ 画线/图形" },
    { cmd: "\\node", insert: "\\node at (0,0) {", close: "};", desc: "TikZ 节点" },
    { cmd: "\\qquad", insert: "\\qquad ", desc: "双倍间距分隔" },
  ];

  const CHEM_COMMANDS = new Set([
    "chemfig", "ce", "pu", "schemestart", "schemestop", "arrow", "chemmove",
    "charge", "chemabove", "chembelow", "polymerdelim", "setchemfig", "qquad",
  ]);

  const state = {
    catalog: {
      ribbon_tabs: [],
      formula_categories: [],
      formula_templates: [],
      molecule_categories: [],
      molecule_library: [],
      previews: {},
    },
    activeRibbonTab: "bonds",
    symQuery: "",
    libMode: "formulas",
    libCategory: "all",
    libQuery: "",
    sidePanelTab: "library",
    sidePanelOpen: true,
    wordWrap: true,
    zoom: 1.25,
    panX: 0,
    panY: 0,
    lastSvg: "",
    lastWidth: 0,
    lastHeight: 0,
    lastTexSource: "",
    errorLine: null,
    renderTimer: null,
    renderController: null,
    renderSeq: 0,
    undoStack: [],
    redoStack: [],
    undoTimer: null,
    pendingUndoSnapshot: null,
    history: [],
    favorites: [],
    acItems: [],
    acIndex: 0,
    acStart: -1,
    lastOcrId: null,
    lastOcrFile: null,
    editorMode: "composer",
    composer: null,
    sketcher: null,
    cmdItems: [],
    cmdIndex: 0,
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    themeToggleBtn: $("themeToggleBtn"),
    themeIconUse: $("themeIconUse"),
    sidePanel: $("sidePanel"),
    sidePanelTitle: $("sidePanelTitle"),
    sideResizer: $("sideResizer"),
    railCollapseBtn: $("railCollapseBtn"),
    sidePanelCloseBtn: $("sidePanelCloseBtn"),
    ribbonTabs: $("ribbonTabs"),
    ribbonBody: $("ribbonBody"),
    symSearchInput: $("symSearchInput"),
    favoritesList: $("favoritesList"),
    panelSaveFavBtn: $("panelSaveFavBtn"),
    editorPane: $("editorPane"),
    editorModeSwitch: $("editorModeSwitch"),
    editorActionsBar: $("editorActionsBar"),
    codeQuickStrip: $("codeQuickStrip"),
    composerView: $("composerView"),
    codeView: $("codeView"),
    codeBox: $("codeBox"),
    codeStage: $("codeStage"),
    wordWrapBtn: $("wordWrapBtn"),
    previewPane: $("previewPane"),
    paneResizer: $("paneResizer"),
    codeEditor: $("codeEditor"),
    codeHighlight: $("codeHighlight"),
    lineNumbers: $("lineNumbers"),
    acPopup: $("acPopup"),
    nudgeBar: $("nudgeBar"),
    nudgeLabel: $("nudgeLabel"),
    detectedPills: $("detectedPills"),
    cursorPos: $("cursorPos"),
    cursorCtx: $("cursorCtx"),
    bracketStatus: $("bracketStatus"),
    compileNowBtn: $("compileNowBtn"),
    layoutToggleBtn: $("layoutToggleBtn"),
    layoutBar: $("layoutBar"),
    preambleBar: $("preambleBar"),
    togglePreambleBtn: $("togglePreambleBtn"),
    optAtomSep: $("optAtomSep"),
    optBondOffset: $("optBondOffset"),
    optDoubleSep: $("optDoubleSep"),
    optFontSize: $("optFontSize"),
    optPreamble: $("optPreamble"),
    resetOptsBtn: $("resetOptsBtn"),
    renderBadge: $("renderBadge"),
    dimBadge: $("dimBadge"),
    previewStage: $("previewStage"),
    svgViewport: $("svgViewport"),
    svgHolder: $("svgHolder"),
    zoomLabel: $("zoomLabel"),
    errorCard: $("errorCard"),
    errorMsg: $("errorMsg"),
    errorHint: $("errorHint"),
    errorRawLog: $("errorRawLog"),
    toggleLastValidBtn: $("toggleLastValidBtn"),
    dismissErrorBtn: $("dismissErrorBtn"),
    libCategories: $("libCategories"),
    libGrid: $("libGrid"),
    libSearchInput: $("libSearchInput"),
    formulaCount: $("formulaCount"),
    moleculeCount: $("moleculeCount"),
    favTabCount: $("favTabCount"),
    favCountBadge: $("favCountBadge"),
    libTotalBadge: $("libTotalBadge"),
    libHoverPreview: $("libHoverPreview"),
    cmdPaletteModal: $("cmdPaletteModal"),
    cmdSearchInput: $("cmdSearchInput"),
    cmdResults: $("cmdResults"),
    openCmdPaletteBtn: $("openCmdPaletteBtn"),
    openOcrBtn: $("openOcrBtn"),
    sketchModal: $("sketchModal"),
    ocrModal: $("ocrModal"),
    ocrDropZone: $("ocrDropZone"),
    ocrFileInput: $("ocrFileInput"),
    ocrTargetSelect: $("ocrTargetSelect"),
    ocrPreprocessSelect: $("ocrPreprocessSelect"),
    ocrThickenSelect: $("ocrThickenSelect"),
    ocrRotateInput: $("ocrRotateInput"),
    ocrSnapChk: $("ocrSnapChk"),
    ocrCircleChk: $("ocrCircleChk"),
    ocrShowCChk: $("ocrShowCChk"),
    ocrShowMeChk: $("ocrShowMeChk"),
    ocrPreviewRow: $("ocrPreviewRow"),
    ocrThumb: $("ocrThumb"),
    ocrRenderMini: $("ocrRenderMini"),
    ocrStatusText: $("ocrStatusText"),
    ocrOutput: $("ocrOutput"),
    ocrActions: $("ocrActions"),
    ocrError: $("ocrError"),
    guideModal: $("guideModal"),
    drawerList: $("drawerList"),
    toastContainer: $("toastContainer"),
  };

  function toast(msg, isError = false) {
    const div = document.createElement("div");
    div.className = `toast${isError ? " err" : ""}`;
    div.textContent = msg;
    els.toastContainer.appendChild(div);
    setTimeout(() => {
      div.remove();
    }, 2600);
  }

  function loadJsonStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJsonStorage(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      // Ignore storage quota errors
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // -------------------- Theme & Split Pane --------------------
  function setPreviewBg(bg, { persist = true } = {}) {
    const valid = ["grid", "white", "checker", "dark"].includes(bg) ? bg : "grid";
    document.querySelectorAll(".bg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.bg === valid);
    });
    els.previewStage.className = `preview-stage bg-${valid}`;
    if (persist) {
      localStorage.setItem(STORAGE_KEYS.previewBg, valid);
    }
  }

  function applyTheme(theme, { syncPreview = false } = {}) {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(STORAGE_KEYS.theme, next);
    const useEl = els.themeIconUse?.querySelector("use");
    if (useEl) {
      useEl.setAttribute("href", next === "dark" ? "#ic-sun" : "#ic-moon");
    }
    if (syncPreview || !localStorage.getItem(STORAGE_KEYS.previewBg)) {
      setPreviewBg(next === "dark" ? "dark" : "grid", { persist: syncPreview });
    }
  }

  const SIDE_PANEL_TITLES = {
    library: "模板与分子库",
    symbols: "快捷化学符号",
    favorites: "我的收藏",
    history: "最近编辑",
  };

  function setSidePanel(tabName, { open = true, persist = true } = {}) {
    const tab = SIDE_PANEL_TITLES[tabName] ? tabName : "library";
    state.sidePanelTab = tab;
    state.sidePanelOpen = Boolean(open);

    document.querySelectorAll(".rail-btn[data-rail]").forEach((btn) => {
      btn.classList.toggle("active", state.sidePanelOpen && btn.dataset.rail === tab);
    });
    els.railCollapseBtn?.classList.toggle("active", state.sidePanelOpen);
    els.sidePanel?.classList.toggle("collapsed", !state.sidePanelOpen);
    els.sideResizer?.classList.toggle("collapsed", !state.sidePanelOpen);

    if (els.sidePanelTitle) {
      els.sidePanelTitle.textContent = SIDE_PANEL_TITLES[tab];
    }
    document.querySelectorAll(".side-pane[data-panel]").forEach((pane) => {
      pane.classList.toggle("hidden", pane.dataset.panel !== tab);
    });

    if (state.sidePanelOpen) {
      if (tab === "favorites") renderFavoritesList();
      if (tab === "history") renderHistoryList();
    } else {
      hideLibHoverPreview();
    }

    if (persist) {
      localStorage.setItem(STORAGE_KEYS.sidePanelTab, state.sidePanelTab);
      localStorage.setItem(STORAGE_KEYS.sidePanelOpen, state.sidePanelOpen ? "1" : "0");
    }
  }

  function initSideResizer() {
    const savedW = parseInt(localStorage.getItem(STORAGE_KEYS.sidePanelWidth) || "", 10);
    if (Number.isFinite(savedW) && savedW >= 220 && savedW <= 440 && els.sidePanel) {
      els.sidePanel.style.width = `${savedW}px`;
    }
    if (!els.sideResizer || !els.sidePanel) return;

    let dragging = false;
    let startX = 0;
    let startW = 280;

    els.sideResizer.addEventListener("mousedown", (e) => {
      if (els.sidePanel.classList.contains("collapsed")) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startW = els.sidePanel.getBoundingClientRect().width;
      els.sideResizer.classList.add("dragging");
      document.body.style.cursor = "col-resize";
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const next = Math.max(220, Math.min(440, startW + (e.clientX - startX)));
      els.sidePanel.style.width = `${Math.round(next)}px`;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      els.sideResizer.classList.remove("dragging");
      document.body.style.cursor = "";
      localStorage.setItem(
        STORAGE_KEYS.sidePanelWidth,
        String(Math.round(els.sidePanel.getBoundingClientRect().width))
      );
    });
  }

  function initSplitResizer() {
    const savedPct = parseFloat(localStorage.getItem(STORAGE_KEYS.splitPct) || "47");
    if (Number.isFinite(savedPct) && savedPct >= 24 && savedPct <= 76) {
      els.editorPane.style.width = `${savedPct}%`;
    }

    let dragging = false;
    els.paneResizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      els.paneResizer.classList.add("dragging");
      document.body.style.cursor = "col-resize";
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const ws = $("workspace").getBoundingClientRect();
      const pct = ((e.clientX - ws.left) / ws.width) * 100;
      const clamped = Math.max(24, Math.min(76, pct));
      els.editorPane.style.width = `${clamped.toFixed(1)}%`;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      els.paneResizer.classList.remove("dragging");
      document.body.style.cursor = "";
      localStorage.setItem(
        STORAGE_KEYS.splitPct,
        els.editorPane.style.width.replace("%", "")
      );
    });
  }

  // -------------------- Unified Undo / Redo --------------------
  function makeSnapshot() {
    return {
      code: els.codeEditor.value,
      start: els.codeEditor.selectionStart ?? 0,
      end: els.codeEditor.selectionEnd ?? 0,
    };
  }

  function flushPendingUndo() {
    if (state.undoTimer) {
      clearTimeout(state.undoTimer);
      state.undoTimer = null;
    }
    if (state.pendingUndoSnapshot) {
      const snap = state.pendingUndoSnapshot;
      state.pendingUndoSnapshot = null;
      const top = state.undoStack[state.undoStack.length - 1];
      if (!top || top.code !== snap.code) {
        state.undoStack.push(snap);
        if (state.undoStack.length > 100) state.undoStack.shift();
        state.redoStack = [];
      }
    }
  }

  function pushUndoSnapshot(snap = null) {
    flushPendingUndo();
    const s = snap || makeSnapshot();
    const top = state.undoStack[state.undoStack.length - 1];
    if (!top || top.code !== s.code) {
      state.undoStack.push(s);
      if (state.undoStack.length > 100) state.undoStack.shift();
      state.redoStack = [];
    }
  }

  function scheduleTypingUndo(beforeSnap) {
    if (!state.pendingUndoSnapshot) {
      state.pendingUndoSnapshot = beforeSnap;
    }
    if (state.undoTimer) clearTimeout(state.undoTimer);
    state.undoTimer = setTimeout(() => {
      flushPendingUndo();
    }, 380);
  }

  function performUndo() {
    flushPendingUndo();
    if (state.undoStack.length === 0) return;
    state.redoStack.push(makeSnapshot());
    const prev = state.undoStack.pop();
    els.codeEditor.value = prev.code;
    els.codeEditor.focus();
    els.codeEditor.setSelectionRange(prev.start, prev.end);
    onCodeChanged({ triggerRender: true });
  }

  function performRedo() {
    flushPendingUndo();
    if (state.redoStack.length === 0) return;
    state.undoStack.push(makeSnapshot());
    const nxt = state.redoStack.pop();
    els.codeEditor.value = nxt.code;
    els.codeEditor.focus();
    els.codeEditor.setSelectionRange(nxt.start, nxt.end);
    onCodeChanged({ triggerRender: true });
  }

  function setEditorCode(newCode, { render = true, immediate = false, recordUndo = true } = {}) {
    if (recordUndo) {
      pushUndoSnapshot();
    }
    els.codeEditor.value = newCode;
    onCodeChanged({ triggerRender: render, immediate });
  }

  function insertAtCursor(snippet, selectText = "") {
    const ta = els.codeEditor;
    pushUndoSnapshot();
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + snippet + ta.value.slice(end);
    ta.focus();

    if (selectText) {
      const idx = snippet.indexOf(selectText);
      if (idx !== -1) {
        ta.setSelectionRange(start + idx, start + idx + selectText.length);
      } else {
        ta.setSelectionRange(start + snippet.length, start + snippet.length);
      }
    } else {
      ta.setSelectionRange(start + snippet.length, start + snippet.length);
    }
    onCodeChanged({ triggerRender: true });
  }

  function wrapSelection(prefix, suffix, placeholder) {
    const ta = els.codeEditor;
    pushUndoSnapshot();
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = ta.value.slice(start, end);
    const inner = selected || placeholder;
    const inserted = `${prefix}${inner}${suffix}`;
    ta.value = ta.value.slice(0, start) + inserted + ta.value.slice(end);
    ta.focus();
    ta.setSelectionRange(start + prefix.length, start + prefix.length + inner.length);
    onCodeChanged({ triggerRender: true });
  }

  // -------------------- Syntax & Bracket Highlighting --------------------
  function analyzeBrackets(code, cursorPos) {
    const pairs = { "{": "}", "(": ")", "[": "]" };
    const closeToOpen = { "}": "{", ")": "(", "]": "[" };
    const stack = [];
    const depthAt = new Map();
    const pairAt = new Map();
    const badSet = new Set();

    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === "\\" && i + 1 < code.length && "{}()[]".includes(code[i + 1])) {
        i++;
        continue;
      }
      if (ch === "%") {
        while (i < code.length && code[i] !== "\n") i++;
        continue;
      }
      if (pairs[ch]) {
        depthAt.set(i, stack.length % 3);
        stack.push({ ch, idx: i });
      } else if (closeToOpen[ch]) {
        if (stack.length > 0 && stack[stack.length - 1].ch === closeToOpen[ch]) {
          const top = stack.pop();
          const d = stack.length % 3;
          depthAt.set(i, d);
          pairAt.set(top.idx, i);
          pairAt.set(i, top.idx);
        } else {
          badSet.add(i);
        }
      }
    }
    for (const unclosed of stack) {
      badSet.add(unclosed.idx);
    }

    const activeMatch = new Set();
    for (const probe of [cursorPos - 1, cursorPos]) {
      if (probe >= 0 && probe < code.length && pairAt.has(probe)) {
        activeMatch.add(probe);
        activeMatch.add(pairAt.get(probe));
        break;
      }
    }

    return { depthAt, badSet, activeMatch, unclosedCount: stack.length };
  }

  function renderCodeHighlight() {
    const code = els.codeEditor.value;
    const cursorPos = els.codeEditor.selectionStart ?? 0;
    const { depthAt, badSet, activeMatch } = analyzeBrackets(code, cursorPos);

    const lines = code.split("\n");
    let globalIdx = 0;
    const htmlLines = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const lineNo = lineIdx + 1;
      let out = "";
      let i = 0;

      while (i < line.length) {
        const ch = line[i];
        const absIdx = globalIdx + i;

        if (ch === "%") {
          out += `<span class="tok-comment">${escapeHtml(line.slice(i))}</span>`;
          i = line.length;
          break;
        }

        if (ch === "\\") {
          if (i + 1 < line.length && !/[A-Za-z]/.test(line[i + 1])) {
            out += `<span class="tok-cmd">${escapeHtml(line.slice(i, i + 2))}</span>`;
            i += 2;
            continue;
          }
          let j = i + 1;
          while (j < line.length && /[A-Za-z]/.test(line[j])) j++;
          const cmdName = line.slice(i + 1, j);
          const cls = CHEM_COMMANDS.has(cmdName) ? "tok-chem" : "tok-cmd";
          out += `<span class="${cls}">${escapeHtml(line.slice(i, j))}</span>`;
          i = j;
          continue;
        }

        if ("{}()[]".includes(ch)) {
          const classes = [];
          if (badSet.has(absIdx)) {
            classes.push("tok-b-bad");
          } else {
            if (depthAt.has(absIdx)) classes.push(`tok-b${depthAt.get(absIdx)}`);
            if (activeMatch.has(absIdx)) classes.push("tok-b-match");
          }
          if (classes.length) {
            out += `<span class="${classes.join(" ")}">${escapeHtml(ch)}</span>`;
          } else {
            out += escapeHtml(ch);
          }
          i++;
          continue;
        }

        if (ch === ":" && i > 0 && line[i - 1] === "[") {
          let j = i;
          while (j < line.length && line[j] !== "]" && line[j] !== "\n") j++;
          out += `<span class="tok-opt">${escapeHtml(line.slice(i, j))}</span>`;
          i = j;
          continue;
        }

        out += escapeHtml(ch);
        i++;
      }

      const isErr = state.errorLine === lineNo;
      htmlLines.push(`<span class="code-line${isErr ? " err-line" : ""}">${out || " "}</span>`);
      globalIdx += line.length + 1;
    }

    els.codeHighlight.innerHTML = htmlLines.join("");
    els.codeHighlight.scrollTop = els.codeEditor.scrollTop;
    els.codeHighlight.scrollLeft = els.codeEditor.scrollLeft;
    syncLineNumberHeights();
  }

  function syncLineNumberHeights() {
    if (!els.lineNumbers || !els.codeHighlight) return;
    const lnRows = els.lineNumbers.children;
    if (!state.wordWrap) {
      for (let i = 0; i < lnRows.length; i++) {
        lnRows[i].style.height = "21px";
      }
      return;
    }
    const codeLines = els.codeHighlight.children;
    const n = Math.min(lnRows.length, codeLines.length);
    for (let i = 0; i < n; i++) {
      const h = codeLines[i].offsetHeight;
      lnRows[i].style.height = `${h > 0 ? h : 21}px`;
    }
  }

  function applyWordWrap(enabled, { persist = true } = {}) {
    state.wordWrap = Boolean(enabled);
    els.codeBox?.classList.toggle("word-wrap", state.wordWrap);
    els.wordWrapBtn?.classList.toggle("active", state.wordWrap);
    if (persist) {
      localStorage.setItem(STORAGE_KEYS.wordWrap, state.wordWrap ? "1" : "0");
    }
    requestAnimationFrame(syncLineNumberHeights);
  }

  function updateLineNumbers() {
    const count = els.codeEditor.value.split("\n").length;
    const rows = [];
    for (let i = 1; i <= count; i++) {
      const errCls = state.errorLine === i ? " err" : "";
      rows.push(`<span class="ln-row${errCls}">${i}</span>`);
    }
    els.lineNumbers.innerHTML = rows.join("");
    els.lineNumbers.scrollTop = els.codeEditor.scrollTop;
    syncLineNumberHeights();
  }

  function jumpToLine(lineNo) {
    if (!lineNo || lineNo < 1) return;
    const lines = els.codeEditor.value.split("\n");
    const target = Math.min(lineNo, lines.length);
    let offset = 0;
    for (let i = 0; i < target - 1; i++) {
      offset += lines[i].length + 1;
    }
    els.codeEditor.focus();
    els.codeEditor.setSelectionRange(offset, offset + (lines[target - 1]?.length || 0));
    const lineHeight = 21;
    els.codeEditor.scrollTop = Math.max(0, (target - 3) * lineHeight);
    updateCursorPos();
    renderCodeHighlight();
  }

  // -------------------- Autocomplete Popup --------------------
  function hideAutocomplete() {
    els.acPopup.classList.add("hidden");
    state.acItems = [];
    state.acStart = -1;
  }

  function updateAutocomplete() {
    const ta = els.codeEditor;
    const pos = ta.selectionStart ?? 0;
    if (pos !== (ta.selectionEnd ?? 0)) {
      hideAutocomplete();
      return;
    }
    const before = ta.value.slice(0, pos);
    const m = before.match(/\\([A-Za-z]*)$/);
    if (!m) {
      hideAutocomplete();
      return;
    }
    const prefix = "\\" + m[1].toLowerCase();
    const matches = AUTOCOMPLETE_ITEMS.filter((it) =>
      it.cmd.toLowerCase().startsWith(prefix)
    ).slice(0, 8);
    if (matches.length === 0) {
      hideAutocomplete();
      return;
    }

    state.acItems = matches;
    state.acIndex = 0;
    state.acStart = pos - m[0].length;

    els.acPopup.innerHTML = "";
    matches.forEach((it, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ac-item${idx === 0 ? " active" : ""}`;
      btn.innerHTML = `<code>${escapeHtml(it.cmd)}</code><span class="ac-desc">${escapeHtml(it.desc)}</span>`;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        acceptAutocomplete(idx);
      });
      els.acPopup.appendChild(btn);
    });

    const lines = before.split("\n");
    const row = lines.length;
    const col = lines[lines.length - 1].length;
    const lineH = 21;
    const charW = 8.1;
    const top = Math.min(
      els.codeEditor.clientHeight - 40,
      Math.max(24, row * lineH - els.codeEditor.scrollTop + 16)
    );
    const left = Math.min(
      Math.max(46, els.codeEditor.clientWidth - 250),
      46 + col * charW - els.codeEditor.scrollLeft
    );
    els.acPopup.style.top = `${top}px`;
    els.acPopup.style.left = `${left}px`;
    els.acPopup.classList.remove("hidden");
  }

  function acceptAutocomplete(index = state.acIndex) {
    const item = state.acItems[index];
    if (!item || state.acStart < 0) return false;
    const ta = els.codeEditor;
    const end = ta.selectionEnd ?? ta.selectionStart ?? 0;
    pushUndoSnapshot();
    const full = item.insert + (item.close || "");
    ta.value = ta.value.slice(0, state.acStart) + full + ta.value.slice(end);
    const caretPos = state.acStart + item.insert.length;
    ta.focus();
    ta.setSelectionRange(caretPos, caretPos);
    hideAutocomplete();
    onCodeChanged({ triggerRender: true });
    return true;
  }

  function moveAutocompleteSelection(delta) {
    if (state.acItems.length === 0) return;
    state.acIndex = (state.acIndex + delta + state.acItems.length) % state.acItems.length;
    const btns = els.acPopup.querySelectorAll(".ac-item");
    btns.forEach((b, i) => b.classList.toggle("active", i === state.acIndex));
    btns[state.acIndex]?.scrollIntoView({ block: "nearest" });
  }

  // -------------------- Contextual Angle / Length Nudge --------------------
  function findEditableTokenAtCursor(code, pos) {
    // Match [:angle] or [:angle,len...] or [0]..[7]
    const open = code.lastIndexOf("[", pos);
    if (open === -1) return null;
    const close = code.indexOf("]", open);
    if (close === -1 || pos > close + 1) return null;
    const inner = code.slice(open + 1, close);

    // [:angle] or [:angle,len,...]
    const angMatch = inner.match(/^:([+-]?\d+(?:\.\d+)?)(?:,([+-]?\d+(?:\.\d+)?))?/);
    if (angMatch) {
      const angStart = open + 2;
      const angEnd = angStart + angMatch[1].length;
      if (angMatch[2] !== undefined) {
        const lenStart = angEnd + 1;
        const lenEnd = lenStart + angMatch[2].length;
        if (pos >= lenStart && pos <= lenEnd + 1) {
          return {
            kind: "length",
            start: lenStart,
            end: lenEnd,
            value: parseFloat(angMatch[2]),
          };
        }
      }
      return {
        kind: "angle",
        start: angStart,
        end: angEnd,
        value: parseFloat(angMatch[1]),
      };
    }

    // 8-direction [0]..[7]
    if (/^[0-7]$/.test(inner)) {
      return {
        kind: "dir8",
        start: open + 1,
        end: close,
        value: parseInt(inner, 10) * 45,
      };
    }
    return null;
  }

  function updateNudgeBar() {
    const tok = findEditableTokenAtCursor(
      els.codeEditor.value,
      els.codeEditor.selectionStart ?? 0
    );
    if (!tok || Number.isNaN(tok.value)) {
      els.nudgeBar.classList.add("hidden");
      return;
    }
    els.nudgeBar.classList.remove("hidden");
    const btns = els.nudgeBar.querySelectorAll(".nudge-btn");
    if (tok.kind === "length") {
      els.nudgeLabel.textContent = `键长倍率 ×${tok.value}`;
      const steps = [-0.2, -0.1, 0.1, 0.2];
      btns.forEach((b, i) => {
        b.dataset.delta = String(steps[i]);
        b.textContent = steps[i] > 0 ? `+${steps[i]}` : String(steps[i]);
      });
    } else {
      els.nudgeLabel.textContent = `键角 ${tok.value}°`;
      const steps = [-15, -5, 5, 15];
      btns.forEach((b, i) => {
        b.dataset.delta = String(steps[i]);
        b.textContent = steps[i] > 0 ? `+${steps[i]}°` : `${steps[i]}°`;
      });
    }
  }

  function applyNudge(delta) {
    const ta = els.codeEditor;
    const tok = findEditableTokenAtCursor(ta.value, ta.selectionStart ?? 0);
    if (!tok || Number.isNaN(tok.value)) return false;

    pushUndoSnapshot();
    let replacement = "";
    if (tok.kind === "length") {
      const next = Math.max(0.2, Math.min(5.0, Math.round((tok.value + delta) * 100) / 100));
      replacement = String(next);
    } else {
      let next = ((tok.value + delta + 180) % 360 + 360) % 360 - 180;
      if (Math.abs(next + 180) < 1e-6) next = 180;
      next = Math.round(next * 10) / 10;
      replacement = tok.kind === "dir8" ? `:${next}` : String(next);
    }

    ta.value = ta.value.slice(0, tok.start) + replacement + ta.value.slice(tok.end);
    const newCaret = tok.start + replacement.length;
    ta.focus();
    ta.setSelectionRange(newCaret, newCaret);
    onCodeChanged({ triggerRender: true });
    return true;
  }

  // -------------------- chemfig Formatting & Aromatic Toggle --------------------
  function formatChemfigCode(raw) {
    let text = raw.trim();
    if (!text) return raw;

    // Normalize \schemestart ... \schemestop blocks
    text = text
      .replace(/\\schemestart\s*/g, "\\schemestart\n  ")
      .replace(/\s*\\schemestop/g, "\n\\schemestop")
      .replace(/\s*(\\arrow\{[^}]*\})\s*/g, "\n  $1\n  ")
      .replace(/\s*(\\chemmove\{)/g, "\n$1");

    // Break long \chemfig{...} blocks cleanly with TeX %
    text = text.replace(/\\chemfig(\[[^\]]*\])?\{([\s\S]*?)\}(?=\s|$|\\)/g, (full, opt, inner) => {
      const cleanInner = inner.replace(/%\s*\n\s*/g, "");
      if (cleanInner.length < 56) {
        return `\\chemfig${opt || ""}{${cleanInner}}`;
      }
      const lines = [];
      let cur = "";
      let depth = 0;
      for (const ch of cleanInner) {
        cur += ch;
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
        if (depth === 0 && "-=~>".includes(ch) && cur.length > 34) {
          lines.push("    " + cur + "%");
          cur = "";
        }
      }
      if (cur) lines.push("    " + cur);
      if (lines.length <= 1) return `\\chemfig${opt || ""}{${cleanInner}}`;
      return `\\chemfig${opt || ""}{%\n${lines.join("\n")}\n  }`;
    });

    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  function minifyChemfigCode(raw) {
    return raw
      .replace(/%\s*\r?\n\s*/g, "")
      .replace(/\r?\n\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function toggleAromaticStyle(raw) {
    if (/\*\*6\(/.test(raw)) {
      return raw.replace(/\*\*6\(([^)]*)\)/g, (m, inner) => {
        if (inner === "------") return "*6(-=-=-=)";
        return `*6(${inner})`;
      });
    }
    if (/\*6\(/.test(raw)) {
      return raw.replace(/\*6\(([^)]*)\)/g, (m, inner) => {
        if (inner === "-=-=-=" || inner === "=-=-=-") return "**6(------)";
        return `**6(${inner})`;
      });
    }
    return null;
  }

  // -------------------- Context & Status --------------------
  function detectCursorContext(code, pos) {
    const braceStack = [];
    let schemeDepth = 0;
    let tikzDepth = 0;
    let displayBracket = false;
    let inlineParen = false;
    let doubleDollar = false;
    let singleDollar = false;

    const len = Math.min(pos, code.length);
    let i = 0;
    while (i < len) {
      const ch = code[i];
      if (ch === "\\") {
        if (i + 1 < len && code[i + 1] === "\\") {
          i += 2;
          continue;
        }
        if (i + 1 < len) {
          const nxt = code[i + 1];
          if (nxt === "[") { displayBracket = true; i += 2; continue; }
          if (nxt === "]") { displayBracket = false; i += 2; continue; }
          if (nxt === "(") { inlineParen = true; i += 2; continue; }
          if (nxt === ")") { inlineParen = false; i += 2; continue; }
          if ("{}$%&#_".includes(nxt)) { i += 2; continue; }
        }
        let j = i + 1;
        while (j < len && /[A-Za-z]/.test(code[j])) j++;
        const cmd = code.slice(i + 1, j);
        if (cmd === "schemestart") { schemeDepth++; i = j; continue; }
        if (cmd === "schemestop") { schemeDepth = Math.max(0, schemeDepth - 1); i = j; continue; }
        if (cmd === "begin" || cmd === "end") {
          let k = j;
          while (k < len && /\s/.test(code[k])) k++;
          if (k < len && code[k] === "{") {
            const closeIdx = code.indexOf("}", k + 1);
            if (closeIdx !== -1 && closeIdx < len) {
              const envName = code.slice(k + 1, closeIdx).trim();
              if (envName === "tikzpicture") {
                tikzDepth = cmd === "begin" ? tikzDepth + 1 : Math.max(0, tikzDepth - 1);
              }
              i = closeIdx + 1;
              continue;
            }
          }
        }
        if (cmd === "chemfig" || cmd === "ce") {
          let k = j;
          while (k < len && /\s/.test(code[k])) k++;
          if (cmd === "chemfig" && k < len && code[k] === "[") {
            let bDepth = 1;
            k++;
            while (k < len && bDepth > 0) {
              if (code[k] === "\\") { k += 2; continue; }
              if (code[k] === "[") bDepth++;
              else if (code[k] === "]") bDepth--;
              k++;
            }
            while (k < len && /\s/.test(code[k])) k++;
          }
          if (k < len && code[k] === "{") {
            braceStack.push(cmd);
            i = k + 1;
            continue;
          }
        }
        i = j > i + 1 ? j : i + 1;
        continue;
      }
      if (ch === "{") braceStack.push("other");
      else if (ch === "}") {
        if (braceStack.length > 0) braceStack.pop();
      } else if (ch === "$") {
        if (i + 1 < len && code[i + 1] === "$") {
          doubleDollar = !doubleDollar;
          i += 2;
          continue;
        }
        singleDollar = !singleDollar;
      }
      i++;
    }

    return {
      inChemfig: braceStack.includes("chemfig"),
      inCe: braceStack.includes("ce"),
      inScheme: schemeDepth > 0,
      inTikz: tikzDepth > 0,
      inMath: displayBracket || inlineParen || doubleDollar || singleDollar,
    };
  }

  function insertRibbonItem(item) {
    if (state.editorMode === "composer" && state.composer) {
      if (state.composer.insertIntoOpenPopover(item)) {
        return;
      }
      if (state.composer.addBlockFromRibbon(item)) {
        toast(`已添加到拼装画布：${item.sub || item.label}`);
        return;
      }
      // Low-level syntax token (basic bond, angle, branch, charge): switch cleanly to LaTeX source
      // and position cursor inside the selected block's \chemfig{...} if applicable.
      const selBlock = state.composer.getSelectedBlock?.();
      els.editorModeSwitch.querySelector('[data-mode="code"]')?.click();
      if (selBlock && selBlock.code) {
        const pos = els.codeEditor.value.indexOf(selBlock.code);
        if (pos !== -1) {
          const closeBrace = selBlock.code.lastIndexOf("}");
          const caret = closeBrace !== -1 ? pos + closeBrace : pos + selBlock.code.length;
          els.codeEditor.setSelectionRange(caret, caret);
        }
      }
      toast(`「${item.sub || item.label}」为源码级符号，已切至 LaTeX 源码并定位插入（画结构请用 2D 分子画板）`);
    }

    const ta = els.codeEditor;
    pushUndoSnapshot();
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const ctx = detectCursorContext(ta.value, start);
    const container = item.container || "none";

    const alreadyInside =
      container === "none" ||
      (container === "chemfig" && (ctx.inChemfig || (ctx.inCe && item.ce_ok))) ||
      (container === "ce" && ctx.inCe) ||
      (container === "scheme" && ctx.inScheme) ||
      (container === "tikz" && ctx.inTikz) ||
      (container === "math" && (ctx.inMath || (ctx.inCe && item.ce_ok) || (ctx.inChemfig && item.chemfig_ok)));

    let textToInsert = "";
    let selStartOffset = 0;
    let selEndOffset = 0;
    const selectHint = item.select || "";

    if (alreadyInside) {
      textToInsert =
        container === "none" && item.standalone && !/@\{/.test(ta.value)
          ? item.standalone
          : item.snippet;
      if (selectHint && textToInsert.includes(selectHint)) {
        selStartOffset = textToInsert.indexOf(selectHint);
        selEndOffset = selStartOffset + selectHint.length;
      } else {
        selStartOffset = textToInsert.length;
        selEndOffset = textToInsert.length;
      }
    } else {
      const inner = item.standalone || item.snippet;
      let prefix = "";
      let suffix = "";
      if (container === "chemfig") {
        prefix = "\\chemfig{";
        suffix = "}";
      } else if (container === "ce") {
        prefix = "\\ce{";
        suffix = "}";
      } else if (container === "scheme") {
        prefix = "\\schemestart\n  ";
        suffix = "\n\\schemestop";
      } else if (container === "math") {
        prefix = "\\[ ";
        suffix = " \\]";
      } else if (container === "tikz") {
        prefix = "\\begin{tikzpicture}[x=1cm,y=1cm,line cap=round,line join=round]\n  ";
        suffix = "\n\\end{tikzpicture}";
      }

      textToInsert = `${prefix}${inner}${suffix}`;
      if (selectHint && inner.includes(selectHint)) {
        selStartOffset = prefix.length + inner.indexOf(selectHint);
        selEndOffset = selStartOffset + selectHint.length;
      } else {
        selStartOffset = prefix.length + inner.length;
        selEndOffset = selStartOffset;
      }
    }

    ta.value = ta.value.slice(0, start) + textToInsert + ta.value.slice(end);
    ta.focus();
    ta.setSelectionRange(start + selStartOffset, start + selEndOffset);
    onCodeChanged({ triggerRender: true });
  }

  function updateCursorPos() {
    const val = els.codeEditor.value;
    const pos = els.codeEditor.selectionStart || 0;
    const sub = val.slice(0, pos);
    const lines = sub.split("\n");
    const row = lines.length;
    const col = lines[lines.length - 1].length + 1;
    els.cursorPos.textContent = `行 ${row}, 列 ${col}`;

    const ctx = detectCursorContext(val, pos);
    let label = "顶层位置";
    let tip = "顶层位置 · 点击符号自动包裹";
    let inside = false;
    if (ctx.inChemfig) {
      label = "\\chemfig{} 内";
      tip = "位于 \\chemfig{} 内 · 点击化学键/方位将直接拼接";
      inside = true;
    } else if (ctx.inCe) {
      label = "\\ce{} 内";
      tip = "位于 \\ce{} 内 · 点击直接拼接";
      inside = true;
    } else if (ctx.inScheme) {
      label = "\\schemestart 内";
      tip = "位于 \\schemestart 内 · 直接拼接反应物与箭头";
      inside = true;
    } else if (ctx.inTikz) {
      label = "tikzpicture 内";
      tip = "位于 tikzpicture 内 · 直接拼接 TikZ 语句";
      inside = true;
    } else if (ctx.inMath) {
      label = "数学环境内";
      tip = "位于数学环境内 · 直接拼接";
      inside = true;
    }
    els.cursorCtx.textContent = label;
    els.cursorCtx.title = tip;
    els.cursorCtx.className = `ctx-pill${inside ? " inside" : ""}`;
    updateNudgeBar();
    renderCodeHighlight();
  }

  function checkBrackets(code) {
    const { badSet, unclosedCount } = analyzeBrackets(code, 0);
    if (badSet.size === 0) {
      els.bracketStatus.textContent = "括号正常";
      els.bracketStatus.className = "bracket-status ok";
    } else if (unclosedCount > 0) {
      els.bracketStatus.textContent = `未闭合 (${unclosedCount})`;
      els.bracketStatus.className = "bracket-status bad";
    } else {
      els.bracketStatus.textContent = `不匹配 (${badSet.size})`;
      els.bracketStatus.className = "bracket-status bad";
    }
  }

  function updateDetectedPills(code) {
    const pills = [];
    if (/\\ce\{|\\pu\{/.test(code)) pills.push({ text: "mhchem", cls: "" });
    if (/\\chemfig|\\schemestart/.test(code)) pills.push({ text: "chemfig", cls: "chemfig" });
    if (/\\begin\{tikzpicture\}|\\tikz/.test(code)) pills.push({ text: "TikZ", cls: "" });
    if (/\\chemmove|\\polymerdelim|remember picture/.test(code)) pills.push({ text: "双遍定位", cls: "warn" });
    if (/[\u4e00-\u9fff]/.test(code)) pills.push({ text: "中文 fontspec", cls: "" });

    els.detectedPills.innerHTML = "";
    pills.forEach((p) => {
      const span = document.createElement("span");
      span.className = `pkg-pill ${p.cls}`.trim();
      span.textContent = p.text;
      els.detectedPills.appendChild(span);
    });
  }

  function onCodeChanged({ triggerRender = true, immediate = false } = {}) {
    const code = els.codeEditor.value;
    localStorage.setItem(STORAGE_KEYS.code, code);
    if (!triggerRender || !code.trim()) {
      state.errorLine = null;
    }
    updateLineNumbers();
    updateCursorPos();
    checkBrackets(code);
    updateDetectedPills(code);
    if (triggerRender) {
      scheduleRender(immediate);
    }
  }

  // -------------------- Compilation & Preview Pan/Zoom --------------------
  function getRenderPayload() {
    return {
      code: els.codeEditor.value,
      atom_sep: els.optAtomSep.value.trim() || null,
      bond_offset: els.optBondOffset.value.trim() || null,
      double_bond_sep: els.optDoubleSep.value.trim() || null,
      font_size: els.optFontSize.value || "normalsize",
      custom_preamble: els.optPreamble.value.trim(),
    };
  }

  function scheduleRender(immediate = false) {
    if (state.renderTimer) {
      clearTimeout(state.renderTimer);
      state.renderTimer = null;
    }
    const code = els.codeEditor.value.trim();
    if (!code) {
      if (state.renderController) {
        state.renderController.abort();
        state.renderController = null;
      }
      state.errorLine = null;
      updateLineNumbers();
      renderCodeHighlight();
      els.renderBadge.textContent = "等待输入";
      els.renderBadge.className = "render-badge idle";
      els.dimBadge.textContent = "";
      els.svgHolder.innerHTML = "";
      els.errorCard.classList.add("hidden");
      return;
    }

    els.renderBadge.textContent = immediate ? "正在编译…" : "等待输入…";
    els.renderBadge.className = "render-badge loading";

    const delay = immediate ? 0 : 340;
    state.renderTimer = setTimeout(() => {
      executeRender();
    }, delay);
  }

  async function executeRender() {
    const payload = getRenderPayload();
    if (!payload.code.trim()) return;

    if (state.renderController) {
      state.renderController.abort();
    }
    const controller = new AbortController();
    state.renderController = controller;
    const seq = ++state.renderSeq;

    els.renderBadge.textContent = "编译中…";
    els.renderBadge.className = "render-badge loading";

    try {
      const resp = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await resp.json();
      if (seq !== state.renderSeq) return;

      if (!resp.ok || !data.ok) {
        state.errorLine = data.error_line || null;
        updateLineNumbers();
        renderCodeHighlight();
        els.renderBadge.textContent = state.errorLine ? `第 ${state.errorLine} 行出错` : "编译出错";
        els.renderBadge.className = "render-badge err";
        els.errorMsg.textContent = data.error || "未知编译错误";
        els.errorMsg.style.cursor = state.errorLine ? "pointer" : "default";
        els.errorMsg.title = state.errorLine ? `点击跳转到第 ${state.errorLine} 行` : "";
        els.errorHint.textContent = data.hint ? `提示：${data.hint}` : "";
        els.errorHint.classList.toggle("hidden", !data.hint);
        els.errorRawLog.textContent = data.raw_log || "";
        els.errorCard.classList.remove("hidden");
        return;
      }

      state.errorLine = null;
      updateLineNumbers();
      renderCodeHighlight();
      els.errorCard.classList.add("hidden");
      state.lastSvg = data.svg;
      state.lastWidth = data.width;
      state.lastHeight = data.height;
      state.lastTexSource = data.tex_source || "";

      const scope = window.scopeSvgIds || ((s) => s);
      els.svgHolder.innerHTML = scope(data.svg);
      applyViewTransform();

      const modeTag = data.cached ? "缓存命中" : "已渲染";
      els.renderBadge.textContent = `${modeTag} · ${data.elapsed_ms} ms`;
      els.renderBadge.className = "render-badge ok";
      els.dimBadge.textContent = `${Math.round(data.width)} × ${Math.round(data.height)} pt`;

      recordHistory(payload.code);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      els.renderBadge.textContent = "请求失败";
      els.renderBadge.className = "render-badge err";
      els.errorMsg.textContent = `无法连接编译服务：${err}`;
      els.errorHint.classList.add("hidden");
      els.errorCard.classList.remove("hidden");
    }
  }

  function applyViewTransform() {
    els.svgViewport.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function applyZoom(scale) {
    state.zoom = Math.max(0.4, Math.min(4.0, scale));
    applyViewTransform();
  }

  function resetPanAndFit() {
    state.panX = 0;
    state.panY = 0;
    const svg = els.svgHolder.querySelector("svg");
    if (!svg) {
      applyZoom(1.25);
      return;
    }
    const stageRect = els.previewStage.getBoundingClientRect();
    const w = parseFloat(svg.getAttribute("width")) || state.lastWidth || 200;
    const h = parseFloat(svg.getAttribute("height")) || state.lastHeight || 100;
    const availW = Math.max(120, stageRect.width - 48);
    const availH = Math.max(90, stageRect.height - 48);
    const fit = Math.min(availW / w, availH / h, 2.2);
    applyZoom(Math.max(0.6, fit));
  }

  function initPreviewPan() {
    let panning = false;
    let startX = 0;
    let startY = 0;
    let origPanX = 0;
    let origPanY = 0;

    els.previewStage.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("#errorCard, .preview-hud")) return;
      panning = true;
      startX = e.clientX;
      startY = e.clientY;
      origPanX = state.panX;
      origPanY = state.panY;
      els.previewStage.classList.add("panning");
    });

    window.addEventListener("mousemove", (e) => {
      if (!panning) return;
      state.panX = origPanX + (e.clientX - startX);
      state.panY = origPanY + (e.clientY - startY);
      applyViewTransform();
    });

    window.addEventListener("mouseup", () => {
      if (!panning) return;
      panning = false;
      els.previewStage.classList.remove("panning");
    });

    els.previewStage.addEventListener("dblclick", (e) => {
      if (e.target.closest("#errorCard, .preview-hud")) return;
      resetPanAndFit();
    });
  }

  // -------------------- Export & Clipboard --------------------
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function fetchExportBlob(endpoint, bodyObj) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    });
    if (!resp.ok) {
      let msg = "导出失败";
      try {
        const err = await resp.json();
        msg = err.error || msg;
      } catch {}
      throw new Error(msg);
    }
    return await resp.blob();
  }

  function initExports() {
    $("copyLatexBtn").addEventListener("click", async () => {
      const code = els.codeEditor.value.trim();
      if (!code) return toast("代码为空", true);
      await navigator.clipboard.writeText(code);
      toast("已复制 LaTeX 源码");
    });

    $("copyMdBtn").addEventListener("click", async () => {
      const code = els.codeEditor.value.trim();
      if (!code) return toast("代码为空", true);
      let md = code;
      if (!md.startsWith("$") && !md.startsWith("\\[")) {
        md = `$$\n${md}\n$$`;
      } else if (md.startsWith("\\[") && md.endsWith("\\]")) {
        md = `$$\n${md.slice(2, -2).trim()}\n$$`;
      }
      await navigator.clipboard.writeText(md);
      toast("已复制 Markdown 公式块");
    });

    $("copySvgBtn").addEventListener("click", async () => {
      if (!state.lastSvg) return toast("暂无可复制的 SVG", true);
      await navigator.clipboard.writeText(state.lastSvg);
      toast("已复制矢量 SVG 源码");
    });

    $("copyPngBtn").addEventListener("click", async () => {
      if (!els.codeEditor.value.trim()) return toast("请先输入代码", true);
      try {
        const body = {
          ...getRenderPayload(),
          scale: parseFloat($("pngScaleSelect").value || "3"),
          transparent: $("pngTransparentChk").checked,
        };
        const blob = await fetchExportBlob("/api/export/png", body);
        if (window.ClipboardItem && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          toast("高清 PNG 已复制到剪贴板，可直接粘贴到 Word/PPT");
        } else {
          triggerDownload(blob, "chem-formula.png");
          toast("当前环境不支持图片剪贴板，已改为下载 PNG");
        }
      } catch (err) {
        toast(`复制 PNG 失败：${err.message}`, true);
      }
    });

    $("dlSvgBtn").addEventListener("click", () => {
      if (!state.lastSvg) return toast("暂无可下载的 SVG", true);
      triggerDownload(
        new Blob([state.lastSvg], { type: "image/svg+xml;charset=utf-8" }),
        "chem-formula.svg"
      );
      toast("已开始下载 SVG");
    });

    $("dlPngBtn").addEventListener("click", async () => {
      try {
        const body = {
          ...getRenderPayload(),
          scale: parseFloat($("pngScaleSelect").value || "3"),
          transparent: $("pngTransparentChk").checked,
        };
        const blob = await fetchExportBlob("/api/export/png", body);
        triggerDownload(blob, "chem-formula.png");
        toast("已开始下载高清 PNG");
      } catch (err) {
        toast(`导出 PNG 失败：${err.message}`, true);
      }
    });

    $("dlPdfBtn").addEventListener("click", async () => {
      try {
        const blob = await fetchExportBlob("/api/export/pdf", getRenderPayload());
        triggerDownload(blob, "chem-formula.pdf");
        toast("已开始下载裁切 PDF");
      } catch (err) {
        toast(`导出 PDF 失败：${err.message}`, true);
      }
    });

    $("dlTexBtn").addEventListener("click", async () => {
      try {
        const blob = await fetchExportBlob("/api/export/tex", getRenderPayload());
        triggerDownload(blob, "chem-formula.tex");
        toast("已开始下载完整 .tex 文档");
      } catch (err) {
        toast(`导出 .tex 失败：${err.message}`, true);
      }
    });
  }

  // -------------------- Symbol Ribbon --------------------
  // -------------------- Symbol Panel & Quick Strip --------------------
  const QUICK_STRIP_PRESETS = [
    { label: "—", sub: "单键", short: "—", title: "chemfig 单键 (-)", snippet: "-", container: "chemfig" },
    { label: "=", sub: "双键", short: "=", title: "chemfig 双键 (=)", snippet: "=", container: "chemfig" },
    { label: "≡", sub: "三键", short: "≡", title: "chemfig 三键 (~)", snippet: "~", container: "chemfig" },
    { label: "▶", sub: "实楔", short: "▶", title: "实楔形键 (>)", snippet: ">", container: "chemfig" },
    { label: "┆", sub: "虚楔", short: "┆", title: "虚楔形键 (<:)", snippet: "<:", container: "chemfig" },
    { label: "[:30]", sub: "+30°", short: "[:30]", title: "键线常用 +30°", snippet: "[:30]", standalone: "-[:30]", container: "chemfig" },
    { label: "[:-30]", sub: "-30°", short: "[:-30]", title: "键线常用 -30°", snippet: "[:-30]", standalone: "-[:-30]", container: "chemfig" },
    { label: "◎", sub: "苯环", short: "◎ 苯环", title: "内切圆圈苯环 (**6)", snippet: "**6(------)", container: "chemfig" },
    { label: "\\arrow", sub: "箭头", short: "\\arrow", title: "反应条件箭头", snippet: "\\arrow{->[条件][]}", select: "条件", container: "scheme" },
  ];

  function renderCodeQuickStrip() {
    if (!els.codeQuickStrip) return;
    els.codeQuickStrip.innerHTML = "";
    const itemsWrap = document.createElement("div");
    itemsWrap.className = "qstrip-items";
    QUICK_STRIP_PRESETS.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "qstrip-btn";
      btn.textContent = item.short || item.label;
      btn.title = `${item.title}\n插入：${item.snippet}`;
      btn.addEventListener("click", () => insertRibbonItem(item));
      itemsWrap.appendChild(btn);
    });
    els.codeQuickStrip.appendChild(itemsWrap);

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "qstrip-btn qstrip-more";
    moreBtn.id = "openSymbolsFromStripBtn";
    moreBtn.textContent = "全部符号 ▸";
    moreBtn.title = "在左侧面板打开完整化学符号与命令库";
    moreBtn.addEventListener("click", () => setSidePanel("symbols", { open: true }));
    els.codeQuickStrip.appendChild(moreBtn);
  }

  function renderRibbon() {
    const tabs = state.catalog.ribbon_tabs || [];
    const q = (state.symQuery || "").trim().toLowerCase();
    els.ribbonTabs.innerHTML = "";
    els.ribbonTabs.classList.toggle("hidden", Boolean(q));

    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ribbon-tab${tab.id === state.activeRibbonTab ? " active" : ""}`;
      btn.textContent = tab.name;
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => {
        state.activeRibbonTab = tab.id;
        renderRibbon();
      });
      els.ribbonTabs.appendChild(btn);
    });

    els.ribbonBody.innerHTML = "";
    const containerHintMap = {
      chemfig: "（在 \\chemfig{} 外点击会自动包裹）",
      ce: "（在 \\ce{} 外点击会自动包裹）",
      scheme: "（在 \\schemestart 外点击会自动包裹）",
      math: "（在公式环境外点击会自动包裹）",
      tikz: "（在 tikzpicture 外点击会自动包裹）",
      none: "",
    };

    const groupsToRender = [];
    if (q) {
      tabs.forEach((t) => {
        (t.groups || []).forEach((grp) => {
          const matched = (grp.items || []).filter((it) => {
            const hay = `${it.label || ""} ${it.sub || ""} ${it.title || ""} ${it.snippet || ""}`.toLowerCase();
            return hay.includes(q);
          });
          if (matched.length > 0) {
            groupsToRender.push({ title: `${t.name} · ${grp.title}`, items: matched });
          }
        });
      });
    } else {
      const current = tabs.find((t) => t.id === state.activeRibbonTab) || tabs[0];
      if (current) {
        (current.groups || []).forEach((grp) => groupsToRender.push(grp));
      }
    }

    if (groupsToRender.length === 0) {
      const empty = document.createElement("div");
      empty.className = "lib-empty";
      empty.textContent = "未找到匹配的化学符号或命令";
      els.ribbonBody.appendChild(empty);
      return;
    }

    groupsToRender.forEach((grp) => {
      const box = document.createElement("div");
      box.className = "ribbon-group";
      const title = document.createElement("div");
      title.className = "ribbon-group-title";
      title.textContent = grp.title;
      box.appendChild(title);

      const itemsRow = document.createElement("div");
      itemsRow.className = "ribbon-items";
      grp.items.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sym-btn";
        const cHint = containerHintMap[item.container || "none"] || "";
        btn.title = `${item.title}${cHint}\n插入：${item.snippet}`;
        const main = document.createElement("span");
        main.className = "sym-main";
        main.textContent = item.label;
        const sub = document.createElement("span");
        sub.className = "sym-sub";
        sub.textContent = item.sub || "";
        btn.appendChild(main);
        if (item.sub) btn.appendChild(sub);
        btn.addEventListener("click", () => insertRibbonItem(item));
        itemsRow.appendChild(btn);
      });
      box.appendChild(itemsRow);
      els.ribbonBody.appendChild(box);
    });
  }

  // -------------------- Dual Gallery (Templates + Molecules + Favorites) --------------------
  function isFavorite(id) {
    return state.favorites.some((f) => f.id === id);
  }

  function toggleFavoriteItem(item) {
    const idx = state.favorites.findIndex((f) => f.id === item.id);
    if (idx !== -1) {
      state.favorites.splice(idx, 1);
      toast(`已取消收藏：${item.name}`);
    } else {
      state.favorites.unshift({
        id: item.id,
        name: item.name,
        subtitle: item.subtitle || "已收藏片段",
        packages: item.packages || [],
        keywords: item.keywords || "",
        code: item.code,
        svg: (state.catalog.previews || {})[item.id] || item.svg || "",
      });
      toast(`已收藏：${item.name}`);
    }
    saveJsonStorage(STORAGE_KEYS.favorites, state.favorites);
    updateFavCounts();
    renderLibrary();
    renderFavoritesList();
  }

  function saveCurrentAsFavorite() {
    const code = els.codeEditor.value.trim();
    if (!code) return toast("代码为空，无法收藏", true);
    const shortName = code.replace(/\s+/g, " ").slice(0, 26);
    const id = `custom_${Date.now()}`;
    state.favorites.unshift({
      id,
      name: `自定义：${shortName}`,
      subtitle: new Date().toLocaleTimeString(),
      packages: [],
      keywords: code,
      code,
      svg: state.lastSvg || "",
    });
    saveJsonStorage(STORAGE_KEYS.favorites, state.favorites);
    updateFavCounts();
    renderLibrary();
    renderFavoritesList();
    toast("已将当前代码保存到“我的收藏”");
  }

  function updateFavCounts() {
    const n = state.favorites.length;
    if (els.favTabCount) els.favTabCount.textContent = String(n);
    if (els.favCountBadge) {
      els.favCountBadge.textContent = String(n);
      els.favCountBadge.classList.toggle("hidden", n === 0);
    }
  }

  let hoverTimer = null;
  function hideLibHoverPreview() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    els.libHoverPreview?.classList.add("hidden");
  }

  function showLibHoverPreview(cardEl, item) {
    if (!els.libHoverPreview || !cardEl) return;
    const svg = (state.catalog.previews || {})[item.id] || item.svg || "";
    if (!svg && !item.code) return;
    const scope = window.scopeSvgIds || ((s) => s);
    els.libHoverPreview.innerHTML = `
      ${svg ? `<div class="lib-hover-preview-svg">${scope(svg)}</div>` : ""}
      <div class="lib-hover-preview-title">${escapeHtml(item.name || "")}</div>
      ${item.subtitle ? `<div class="lib-hover-preview-sub">${escapeHtml(item.subtitle)}</div>` : ""}
      <pre class="lib-hover-preview-code">${escapeHtml(item.code || "")}</pre>
    `;
    els.libHoverPreview.classList.remove("hidden");

    const rect = cardEl.getBoundingClientRect();
    const popW = 300;
    const popH = Math.min(340, els.libHoverPreview.offsetHeight || 240);
    let left = rect.right + 10;
    if (left + popW > window.innerWidth - 12) {
      left = Math.max(12, rect.left - popW - 10);
    }
    let top = rect.top;
    if (top + popH > window.innerHeight - 12) {
      top = Math.max(52, window.innerHeight - popH - 12);
    }
    els.libHoverPreview.style.left = `${left}px`;
    els.libHoverPreview.style.top = `${top}px`;
  }

  function attachCardHover(card, item) {
    card.addEventListener("mouseenter", () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showLibHoverPreview(card, item), 180);
    });
    card.addEventListener("mouseleave", hideLibHoverPreview);
    card.addEventListener("dragstart", hideLibHoverPreview);
    card.addEventListener("mousedown", hideLibHoverPreview);
  }

  function renderLibrary() {
    const cats =
      state.libMode === "molecules"
        ? state.catalog.molecule_categories
        : state.catalog.formula_categories;

    if (!cats.some((c) => c.id === state.libCategory)) {
      state.libCategory = "all";
    }

    els.libCategories.innerHTML = "";
    cats.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `cat-pill${cat.id === state.libCategory ? " active" : ""}`;
      btn.textContent = cat.name;
      btn.addEventListener("click", () => {
        state.libCategory = cat.id;
        renderLibrary();
      });
      els.libCategories.appendChild(btn);
    });

    const sourceList =
      state.libMode === "molecules"
        ? state.catalog.molecule_library
        : state.catalog.formula_templates;

    const q = state.libQuery.trim().toLowerCase();
    const filtered = sourceList.filter((item) => {
      if (state.libCategory !== "all" && item.category !== state.libCategory) {
        return false;
      }
      if (!q) return true;
      const hay = `${item.name} ${item.subtitle || ""} ${item.keywords || ""} ${item.code}`.toLowerCase();
      return hay.includes(q);
    });

    els.libGrid.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "lib-empty";
      empty.textContent = "没有匹配的化学模板或分子结构，试试换个关键词。";
      els.libGrid.appendChild(empty);
      return;
    }

    const previews = state.catalog.previews || {};
    const frag = document.createDocumentFragment();
    filtered.forEach((item) => {
      const card = document.createElement("article");
      card.className = "lib-card";
      card.draggable = true;
      card.title = state.editorMode === "composer"
        ? `点击或拖动到左侧拼装画布\n${item.code}`
        : `点击载入到编辑器\n${item.code}`;

      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/x-chemlatex-lib",
          JSON.stringify({
            id: item.id,
            name: item.name,
            code: item.code,
            packages: item.packages || [],
            svg: (state.catalog.previews || {})[item.id] || item.svg || "",
          })
        );
      });

      const faved = isFavorite(item.id);
      const actions = document.createElement("div");
      actions.className = `lib-card-actions${faved ? " has-fav" : ""}`;

      const insertBtn = document.createElement("button");
      insertBtn.type = "button";
      insertBtn.className = "card-mini-btn";
      insertBtn.textContent = "+";
      insertBtn.title = state.editorMode === "composer" ? "添加到拼装画布" : "插入到光标位置（不覆盖已有代码）";
      insertBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.editorMode === "composer" && state.composer) {
          state.composer.addBlockFromLibrary(item);
          toast(`已加入拼装画布：${item.name}`);
        } else {
          insertAtCursor(item.code);
          toast(`已插入：${item.name}`);
        }
      });

      const favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = `card-mini-btn fav${faved ? " active" : ""}`;
      favBtn.textContent = faved ? "★" : "☆";
      favBtn.title = faved ? "取消收藏" : "加入收藏";
      favBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFavoriteItem(item);
      });

      actions.appendChild(insertBtn);
      actions.appendChild(favBtn);
      card.appendChild(actions);

      const thumb = document.createElement("div");
      thumb.className = "lib-card-thumb";
      const svg = previews[item.id] || item.svg || "";
      if (svg) {
        const scope = window.scopeSvgIds || ((s) => s);
        thumb.innerHTML = scope(svg);
      } else {
        const pre = document.createElement("code");
        pre.textContent = item.code.slice(0, 60);
        thumb.appendChild(pre);
      }
      card.appendChild(thumb);

      const title = document.createElement("div");
      title.className = "lib-card-title";
      title.textContent = item.name;
      card.appendChild(title);

      const sub = document.createElement("div");
      sub.className = "lib-card-sub";
      sub.textContent = item.subtitle || "";
      card.appendChild(sub);

      const badges = document.createElement("div");
      badges.className = "lib-card-badges";
      (item.packages || []).forEach((pkg) => {
        const b = document.createElement("span");
        b.className = `pkg-pill${pkg === "chemfig" ? " chemfig" : ""}`;
        b.textContent = pkg;
        badges.appendChild(b);
      });
      card.appendChild(badges);

      card.addEventListener("click", () => {
        if (state.editorMode === "composer" && state.composer) {
          state.composer.addBlockFromLibrary(item);
          toast(`已加入拼装画布：${item.name}`);
        } else {
          setEditorCode(item.code, { render: true, immediate: true, recordUndo: true });
          toast(`已载入：${item.name}`);
        }
      });

      attachCardHover(card, item);
      frag.appendChild(card);
    });
    els.libGrid.appendChild(frag);
  }

  function renderFavoritesList() {
    if (!els.favoritesList) return;
    els.favoritesList.innerHTML = "";
    if (state.favorites.length === 0) {
      const p = document.createElement("div");
      p.className = "lib-empty";
      p.textContent = "暂无收藏。点击模板卡片右上角 ☆ 或工具栏“收藏”即可保存。";
      els.favoritesList.appendChild(p);
      return;
    }
    const previews = state.catalog.previews || {};
    const scope = window.scopeSvgIds || ((s) => s);
    state.favorites.forEach((item) => {
      const card = document.createElement("div");
      card.className = "fav-card";

      const actions = document.createElement("div");
      actions.className = "lib-card-actions has-fav";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "card-mini-btn";
      addBtn.textContent = "+";
      addBtn.title = state.editorMode === "composer" ? "作为积木加入画布" : "插入到光标位置";
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.editorMode === "composer" && state.composer) {
          state.composer.addBlockFromLibrary(item);
          toast(`已加入拼装画布：${item.name}`);
        } else {
          insertAtCursor(item.code);
          toast(`已插入：${item.name}`);
        }
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "card-mini-btn fav active";
      delBtn.textContent = "★";
      delBtn.title = "取消收藏";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFavoriteItem(item);
      });

      actions.append(addBtn, delBtn);
      card.appendChild(actions);

      const svg = previews[item.id] || item.svg || "";
      if (svg) {
        const thumb = document.createElement("div");
        thumb.className = "fav-card-thumb";
        thumb.innerHTML = scope(svg);
        card.appendChild(thumb);
      }

      const title = document.createElement("div");
      title.className = "lib-card-title";
      title.textContent = item.name || "已收藏片段";
      card.appendChild(title);

      const sub = document.createElement("div");
      sub.className = "lib-card-sub";
      sub.textContent = item.subtitle || "";
      card.appendChild(sub);

      card.addEventListener("click", () => {
        if (state.editorMode === "composer" && state.composer) {
          state.composer.addBlockFromLibrary(item);
          toast(`已加入拼装画布：${item.name}`);
        } else {
          setEditorCode(item.code, { render: true, immediate: true, recordUndo: true });
          toast(`已载入：${item.name}`);
        }
      });
      attachCardHover(card, item);
      els.favoritesList.appendChild(card);
    });
  }

  // -------------------- History --------------------
  function recordHistory(code) {
    const trimmed = code.trim();
    if (!trimmed) return;
    const existingIdx = state.history.findIndex((h) => h.code === trimmed);
    if (existingIdx !== -1) {
      state.history.splice(existingIdx, 1);
    }
    state.history.unshift({
      code: trimmed,
      time: new Date().toLocaleTimeString(),
    });
    if (state.history.length > 30) state.history.length = 30;
    saveJsonStorage(STORAGE_KEYS.history, state.history);
    if (state.sidePanelOpen && state.sidePanelTab === "history") {
      renderHistoryList();
    }
  }

  function renderHistoryList() {
    if (!els.drawerList) return;
    els.drawerList.innerHTML = "";
    if (state.history.length === 0) {
      const p = document.createElement("div");
      p.className = "lib-empty";
      p.textContent = "暂无最近编辑记录";
      els.drawerList.appendChild(p);
      return;
    }
    state.history.forEach((item) => {
      const div = document.createElement("div");
      div.className = "drawer-item";
      const top = document.createElement("div");
      top.className = "drawer-item-top";
      top.innerHTML = `<span>编辑记录</span><span class="mono-num">${escapeHtml(item.time || "")}</span>`;
      const pre = document.createElement("pre");
      pre.textContent = item.code;
      div.appendChild(top);
      div.appendChild(pre);
      div.addEventListener("click", () => {
        setEditorCode(item.code, { render: true, immediate: true, recordUndo: true });
        if (state.editorMode === "composer" && state.composer) {
          state.composer.syncFromLatex(item.code);
        }
        toast("已恢复历史记录");
      });
      els.drawerList.appendChild(div);
    });
  }

  // -------------------- Modals, Command Palette & OCR --------------------
  function openModal(modalEl) {
    hideLibHoverPreview();
    modalEl.classList.remove("hidden");
  }

  function closeModal(modalEl) {
    modalEl.classList.add("hidden");
  }

  function openCmdPalette() {
    if (!els.cmdPaletteModal) return;
    openModal(els.cmdPaletteModal);
    els.cmdSearchInput.value = "";
    renderCmdResults("");
    els.cmdSearchInput.focus();
  }

  function buildCommandCatalog() {
    const cmds = [
      {
        kind: "命令",
        title: "打开 2D 分子结构画板",
        sub: "手绘苯环、官能团、楔形键",
        keywords: "sketch 2d draw molecule 画板 分子",
        run: () => $("openSketchBtn")?.click(),
      },
      {
        kind: "命令",
        title: "打开手写图片 / 笔迹 OCR 识图",
        sub: "上传截图或粘贴图片转 chemfig",
        keywords: "ocr image paste 识图 图片 手写",
        run: () => openModal(els.ocrModal),
      },
      {
        kind: "命令",
        title: state.editorMode === "composer" ? "切换到 LaTeX 源码模式" : "切换到拖拽拼装画布",
        sub: "双向实时同步",
        keywords: "mode switch code composer 源码 拼装",
        run: () => {
          const target = state.editorMode === "composer" ? "code" : "composer";
          els.editorModeSwitch.querySelector(`[data-mode="${target}"]`)?.click();
        },
      },
      {
        kind: "命令",
        title: "切换浅色 / 深色主题",
        sub: "Lab Glass & Ink",
        keywords: "theme dark light 主题 暗色 浅色",
        run: () => els.themeToggleBtn?.click(),
      },
      {
        kind: "命令",
        title: state.sidePanelOpen ? "收起左侧面板" : "展开左侧面板",
        sub: "Ctrl+B",
        keywords: "sidebar panel toggle 侧栏 折叠",
        run: () => setSidePanel(state.sidePanelTab, { open: !state.sidePanelOpen }),
      },
      {
        kind: "命令",
        title: "打开语法速查与避坑指南",
        sub: "chemfig 8 方位时钟图",
        keywords: "guide help 语法 速查 帮助",
        run: () => openModal(els.guideModal),
      },
      {
        kind: "命令",
        title: "载入示例：丙烯水合反应流",
        sub: "有机反应框图",
        keywords: "preset hydration 示例 丙烯水合",
        run: () => {
          if (state.editorMode !== "composer") {
            els.editorModeSwitch.querySelector('[data-mode="composer"]')?.click();
          }
          state.composer?.loadPreset("hydration");
        },
      },
      {
        kind: "命令",
        title: "载入示例：对羟基苯甲酸 · 氢键",
        sub: "自由画布虚线连接",
        keywords: "preset hbond 示例 氢键",
        run: () => {
          if (state.editorMode !== "composer") {
            els.editorModeSwitch.querySelector('[data-mode="composer"]')?.click();
          }
          state.composer?.loadPreset("hbond");
        },
      },
    ];

    (state.catalog.formula_templates || []).forEach((item) => {
      cmds.push({
        kind: "公式模板",
        title: item.name,
        sub: item.subtitle || item.code,
        keywords: `${item.name} ${item.subtitle || ""} ${item.keywords || ""} ${item.code}`,
        run: () => {
          if (state.editorMode === "composer" && state.composer) {
            state.composer.addBlockFromLibrary(item);
            toast(`已加入拼装画布：${item.name}`);
          } else {
            setEditorCode(item.code, { render: true, immediate: true, recordUndo: true });
            toast(`已载入：${item.name}`);
          }
        },
      });
    });

    (state.catalog.molecule_library || []).forEach((item) => {
      cmds.push({
        kind: "分子结构",
        title: item.name,
        sub: item.subtitle || item.code,
        keywords: `${item.name} ${item.subtitle || ""} ${item.keywords || ""} ${item.code}`,
        run: () => {
          if (state.editorMode === "composer" && state.composer) {
            state.composer.addBlockFromLibrary(item);
            toast(`已加入拼装画布：${item.name}`);
          } else {
            setEditorCode(item.code, { render: true, immediate: true, recordUndo: true });
            toast(`已载入：${item.name}`);
          }
        },
      });
    });

    (state.catalog.ribbon_tabs || []).forEach((tab) => {
      (tab.groups || []).forEach((grp) => {
        (grp.items || []).forEach((item) => {
          cmds.push({
            kind: "符号",
            title: `${item.label} ${item.sub || ""}`.trim(),
            sub: item.snippet || "",
            keywords: `${tab.name} ${grp.title} ${item.label} ${item.sub || ""} ${item.title || ""} ${item.snippet || ""}`,
            run: () => insertRibbonItem(item),
          });
        });
      });
    });

    return cmds;
  }

  function renderCmdResults(query) {
    if (!els.cmdResults) return;
    const q = query.trim().toLowerCase();
    const all = buildCommandCatalog();
    const list = q
      ? all.filter((it) => it.keywords.toLowerCase().includes(q)).slice(0, 28)
      : all.slice(0, 14);

    state.cmdItems = list;
    state.cmdIndex = 0;
    els.cmdResults.innerHTML = "";

    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "lib-empty";
      empty.textContent = "没有匹配的结果，试试搜索 苯酚、能斯特、SN2、画板";
      els.cmdResults.appendChild(empty);
      return;
    }

    list.forEach((it, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `cmd-item${idx === 0 ? " active" : ""}`;
      btn.innerHTML = `
        <div class="cmd-item-main">
          <span class="cmd-tag">${escapeHtml(it.kind)}</span>
          <span class="cmd-title">${escapeHtml(it.title)}</span>
        </div>
        <span class="cmd-sub">${escapeHtml(it.sub)}</span>
      `;
      btn.addEventListener("click", () => {
        closeModal(els.cmdPaletteModal);
        it.run();
      });
      els.cmdResults.appendChild(btn);
    });
  }

  function moveCmdSelection(delta) {
    if (!state.cmdItems.length) return;
    state.cmdIndex = (state.cmdIndex + delta + state.cmdItems.length) % state.cmdItems.length;
    const items = els.cmdResults.querySelectorAll(".cmd-item");
    items.forEach((el, i) => el.classList.toggle("active", i === state.cmdIndex));
    items[state.cmdIndex]?.scrollIntoView({ block: "nearest" });
  }

  async function renderOcrMiniPreview(code) {
    if (!code || !code.trim()) {
      els.ocrRenderMini.innerHTML = "";
      return;
    }
    try {
      const resp = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        const scope = window.scopeSvgIds || ((s) => s);
        els.ocrRenderMini.innerHTML = scope(data.svg);
      } else {
        els.ocrRenderMini.innerHTML = `<span class="sk-empty-hint">预览失败</span>`;
      }
    } catch {
      els.ocrRenderMini.innerHTML = "";
    }
  }

  function getOcrOptions() {
    return {
      target: els.ocrTargetSelect.value || "chemfig",
      preprocess: els.ocrPreprocessSelect.value || "auto",
      thicken: parseInt(els.ocrThickenSelect.value || "1", 10),
      rotate: parseFloat(els.ocrRotateInput.value || "0") || 0,
      show_carbon: els.ocrShowCChk.checked,
      show_methyl: els.ocrShowMeChk.checked,
      snap_angles: els.ocrSnapChk.checked,
      circle_aromatic: els.ocrCircleChk.checked,
    };
  }

  async function runImageOcr(file) {
    if (!file) return;
    state.lastOcrFile = file;
    state.lastOcrId = null;
    els.ocrError.classList.add("hidden");
    els.ocrPreviewRow.classList.remove("hidden");
    els.ocrOutput.classList.add("hidden");
    els.ocrActions.classList.add("hidden");
    els.ocrRenderMini.innerHTML = '<span class="sk-empty-hint">识别中…</span>';
    els.ocrStatusText.textContent = "正在预处理并调用识别引擎，请稍候…";
    if (!file.name.toLowerCase().endsWith(".json")) {
      els.ocrThumb.src = URL.createObjectURL(file);
    }

    const opts = getOcrOptions();
    const fd = new FormData();
    fd.append("file", file);
    fd.append("target", opts.target);
    fd.append("preprocess", opts.preprocess);
    fd.append("thicken", String(opts.thicken));
    fd.append("rotate", String(opts.rotate));
    fd.append("show_carbon", String(opts.show_carbon));
    fd.append("show_methyl", String(opts.show_methyl));
    fd.append("snap_angles", String(opts.snap_angles));
    fd.append("circle_aromatic", String(opts.circle_aromatic));

    try {
      const resp = await fetch("/api/image-to-latex", {
        method: "POST",
        body: fd,
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        els.ocrStatusText.textContent = "识别未成功";
        els.ocrError.textContent = data.error || "识别失败";
        els.ocrError.classList.remove("hidden");
        els.ocrRenderMini.innerHTML = "";
        return;
      }
      state.lastOcrId = data.ocr_id || null;
      if (data.preview_data_url) {
        els.ocrThumb.src = data.preview_data_url;
      }
      els.ocrStatusText.textContent = `识别完成（${data.target}），调整下方参数可实时重排：`;
      els.ocrOutput.value = data.code;
      els.ocrOutput.classList.remove("hidden");
      els.ocrActions.classList.remove("hidden");
      renderOcrMiniPreview(data.code);
    } catch (err) {
      els.ocrStatusText.textContent = "请求出错";
      els.ocrError.textContent = `识图服务异常：${err}`;
      els.ocrError.classList.remove("hidden");
    }
  }

  async function reformatCachedOcr() {
    if (!state.lastOcrId) {
      if (state.lastOcrFile) return runImageOcr(state.lastOcrFile);
      return;
    }
    const opts = getOcrOptions();
    try {
      const resp = await fetch("/api/ocr-reformat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ocr_id: state.lastOcrId,
          target: opts.target,
          rotate: opts.rotate,
          show_carbon: opts.show_carbon,
          show_methyl: opts.show_methyl,
          snap_angles: opts.snap_angles,
          circle_aromatic: opts.circle_aromatic,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        els.ocrError.textContent = data.error || "重排失败";
        els.ocrError.classList.remove("hidden");
        return;
      }
      els.ocrError.classList.add("hidden");
      els.ocrOutput.value = data.code;
      renderOcrMiniPreview(data.code);
    } catch (err) {
      els.ocrError.textContent = `重排请求失败：${err}`;
      els.ocrError.classList.remove("hidden");
    }
  }

  // -------------------- Event Binding --------------------
  function bindEvents() {
    els.themeToggleBtn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "light";
      applyTheme(cur === "dark" ? "light" : "dark", { syncPreview: true });
    });

    // Activity Rail & Side Panel
    document.querySelectorAll(".rail-btn[data-rail]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rail = btn.dataset.rail;
        if (state.sidePanelOpen && state.sidePanelTab === rail) {
          setSidePanel(rail, { open: false });
        } else {
          setSidePanel(rail, { open: true });
        }
      });
    });
    els.railCollapseBtn?.addEventListener("click", () => {
      setSidePanel(state.sidePanelTab, { open: !state.sidePanelOpen });
    });
    els.sidePanelCloseBtn?.addEventListener("click", () => {
      setSidePanel(state.sidePanelTab, { open: false });
    });
    els.panelSaveFavBtn?.addEventListener("click", saveCurrentAsFavorite);
    els.symSearchInput?.addEventListener("input", () => {
      state.symQuery = els.symSearchInput.value;
      renderRibbon();
    });

    // Split Dropdowns
    function closeAllDropdowns() {
      document.querySelectorAll(".dropdown-wrap.open").forEach((w) => w.classList.remove("open"));
    }
    document.addEventListener("click", (e) => {
      const trig = e.target.closest(".dropdown-trigger");
      if (trig) {
        e.stopPropagation();
        const wrap = trig.closest(".dropdown-wrap");
        const wasOpen = wrap?.classList.contains("open");
        closeAllDropdowns();
        if (wrap && !wasOpen) wrap.classList.add("open");
        return;
      }
      if (e.target.closest(".dropdown-keep-open")) return;
      if (e.target.closest(".dropdown-item")) {
        closeAllDropdowns();
        return;
      }
      if (!e.target.closest(".dropdown-wrap")) {
        closeAllDropdowns();
      }
    });

    // Word wrap & CodeStage ResizeObserver
    els.wordWrapBtn?.addEventListener("click", () => {
      applyWordWrap(!state.wordWrap);
    });
    if (els.codeStage && window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (state.wordWrap) syncLineNumberHeights();
      });
      ro.observe(els.codeStage);
    }

    // Editor typing & smart pairs / undo
    let beforeInputSnap = null;
    els.codeEditor.addEventListener("beforeinput", () => {
      beforeInputSnap = makeSnapshot();
    });

    els.codeEditor.addEventListener("input", () => {
      if (beforeInputSnap) {
        scheduleTypingUndo(beforeInputSnap);
        beforeInputSnap = null;
      }
      onCodeChanged({ triggerRender: true });
      updateAutocomplete();
    });

    els.codeEditor.addEventListener("scroll", () => {
      els.lineNumbers.scrollTop = els.codeEditor.scrollTop;
      els.codeHighlight.scrollTop = els.codeEditor.scrollTop;
      els.codeHighlight.scrollLeft = els.codeEditor.scrollLeft;
    });
    els.codeEditor.addEventListener("click", () => {
      updateCursorPos();
      hideAutocomplete();
    });
    els.codeEditor.addEventListener("keyup", (e) => {
      const acOpen = !els.acPopup.classList.contains("hidden");
      if (acOpen && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;
      updateCursorPos();
    });
    els.codeEditor.addEventListener("blur", () => {
      setTimeout(hideAutocomplete, 140);
    });

    const AUTO_PAIRS = { "{": "}", "(": ")", "[": "]", "$": "$" };
    const CLOSERS = new Set(["}", ")", "]"]);

    els.codeEditor.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      // Autocomplete navigation
      if (!els.acPopup.classList.contains("hidden")) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          return moveAutocompleteSelection(1);
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          return moveAutocompleteSelection(-1);
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          return acceptAutocomplete();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          return hideAutocomplete();
        }
      }

      // Unified Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) performRedo();
        else performUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        performRedo();
        return;
      }

      // Alt+Up / Alt+Down angle or length nudge
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const tok = findEditableTokenAtCursor(
          els.codeEditor.value,
          els.codeEditor.selectionStart ?? 0
        );
        if (tok) {
          e.preventDefault();
          const step =
            tok.kind === "length"
              ? e.shiftKey ? 0.05 : 0.1
              : e.shiftKey ? 1 : 15;
          applyNudge(e.key === "ArrowUp" ? step : -step);
          return;
        }
      }

      if (e.key === "Tab") {
        e.preventDefault();
        insertAtCursor("  ");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        scheduleRender(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        $("dlSvgBtn").click();
        return;
      }

      // Auto-close brackets & smart skip / backspace
      const ta = els.codeEditor;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      const val = ta.value;

      if (!e.ctrlKey && !e.metaKey && !e.altKey && AUTO_PAIRS[e.key]) {
        const opener = e.key;
        const closer = AUTO_PAIRS[opener];
        if (opener === "$" && start > 0 && val[start - 1] === "\\") return;
        if (opener === "$" && start === end && val[start] === "$") {
          e.preventDefault();
          ta.setSelectionRange(start + 1, start + 1);
          updateCursorPos();
          return;
        }
        e.preventDefault();
        pushUndoSnapshot();
        const selected = val.slice(start, end);
        ta.value = val.slice(0, start) + opener + selected + closer + val.slice(end);
        ta.setSelectionRange(start + 1, start + 1 + selected.length);
        onCodeChanged({ triggerRender: true });
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && CLOSERS.has(e.key) && start === end && val[start] === e.key) {
        e.preventDefault();
        ta.setSelectionRange(start + 1, start + 1);
        updateCursorPos();
        return;
      }

      if (e.key === "Backspace" && start === end && start > 0) {
        const left = val[start - 1];
        const right = val[start];
        if (AUTO_PAIRS[left] === right && !(start > 1 && val[start - 2] === "\\")) {
          e.preventDefault();
          pushUndoSnapshot();
          ta.value = val.slice(0, start - 1) + val.slice(start + 1);
          ta.setSelectionRange(start - 1, start - 1);
          onCodeChanged({ triggerRender: true });
          return;
        }
      }
    });

    // Nudge bar buttons
    els.nudgeBar.querySelectorAll(".nudge-btn").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // Keep focus & selection in editor
        const delta = parseFloat(btn.dataset.delta || "0");
        if (delta) applyNudge(delta);
      });
    });

    $("wrapCeBtn").addEventListener("click", () => wrapSelection("\\ce{", "}", "H2O"));
    $("wrapChemfigBtn").addEventListener("click", () =>
      wrapSelection("\\chemfig{", "}", "CH_3-COOH")
    );
    $("wrapSchemeBtn").addEventListener("click", () =>
      wrapSelection("\\schemestart\n  ", "\n\\schemestop", "\\chemfig{A} \\arrow{->} \\chemfig{B}")
    );

    $("formatCodeBtn").addEventListener("click", () => {
      const formatted = formatChemfigCode(els.codeEditor.value);
      if (formatted !== els.codeEditor.value) {
        setEditorCode(formatted, { render: true, recordUndo: true });
        toast("已格式化代码（保留 TeX 换行 %）");
      }
    });
    $("minifyCodeBtn").addEventListener("click", () => {
      const minified = minifyChemfigCode(els.codeEditor.value);
      if (minified !== els.codeEditor.value) {
        setEditorCode(minified, { render: true, recordUndo: true });
        toast("已合并为单行");
      }
    });
    $("toggleAromaticBtn").addEventListener("click", () => {
      const toggled = toggleAromaticStyle(els.codeEditor.value);
      if (!toggled) return toast("未检测到 *6(...) 或 **6(...) 苯环", true);
      setEditorCode(toggled, { render: true, recordUndo: true });
      toast("已切换苯环写法");
    });

    $("undoBtn").addEventListener("click", performUndo);
    $("redoBtn").addEventListener("click", performRedo);

    $("saveFavBtn").addEventListener("click", saveCurrentAsFavorite);
    $("clearCodeBtn").addEventListener("click", () => {
      setEditorCode("", { render: true, recordUndo: true });
      els.codeEditor.focus();
    });

    els.compileNowBtn.addEventListener("click", () => scheduleRender(true));
    els.errorMsg.addEventListener("click", () => {
      if (state.errorLine) jumpToLine(state.errorLine);
    });

    // Layout options
    els.layoutToggleBtn.addEventListener("click", () => {
      const hidden = els.layoutBar.classList.toggle("hidden");
      els.layoutToggleBtn.classList.toggle("active", !hidden);
    });
    els.togglePreambleBtn.addEventListener("click", () => {
      els.preambleBar.classList.toggle("hidden");
    });
    [els.optAtomSep, els.optBondOffset, els.optDoubleSep, els.optFontSize, els.optPreamble].forEach(
      (el) => {
        el.addEventListener("change", () => scheduleRender(true));
      }
    );
    els.resetOptsBtn.addEventListener("click", () => {
      els.optAtomSep.value = "";
      els.optBondOffset.value = "";
      els.optDoubleSep.value = "";
      els.optFontSize.value = "normalsize";
      els.optPreamble.value = "";
      scheduleRender(true);
    });

    // Preview controls
    document.querySelectorAll(".bg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        setPreviewBg(btn.dataset.bg, { persist: true });
      });
    });

    $("zoomOutBtn").addEventListener("click", () => applyZoom(state.zoom - 0.15));
    $("zoomInBtn").addEventListener("click", () => applyZoom(state.zoom + 0.15));
    $("zoomFitBtn").addEventListener("click", resetPanAndFit);
    els.previewStage.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          applyZoom(state.zoom + (e.deltaY < 0 ? 0.14 : -0.14));
        }
      },
      { passive: false }
    );

    els.dismissErrorBtn.addEventListener("click", () => els.errorCard.classList.add("hidden"));
    els.toggleLastValidBtn.addEventListener("click", () => els.errorCard.classList.add("hidden"));

    // Library tabs & search inside Side Panel
    document.querySelectorAll(".lib-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".lib-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        state.libMode = tab.dataset.lib;
        state.libCategory = "all";
        renderLibrary();
      });
    });
    els.libSearchInput.addEventListener("input", () => {
      state.libQuery = els.libSearchInput.value;
      renderLibrary();
    });
    els.libGrid?.addEventListener("scroll", hideLibHoverPreview);
    els.favoritesList?.addEventListener("scroll", hideLibHoverPreview);

    // Mode Switch (Composer <-> LaTeX Code)
    function switchEditorMode(mode) {
      const nextMode = mode === "code" ? "code" : "composer";
      const prevMode = state.editorMode;
      state.editorMode = nextMode;
      localStorage.setItem(STORAGE_KEYS.editorMode, state.editorMode);
      els.editorModeSwitch.querySelectorAll(".mode-tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.mode === state.editorMode);
      });
      const isCode = state.editorMode === "code";
      els.composerView.classList.toggle("hidden", isCode);
      els.codeView.classList.toggle("hidden", !isCode);
      if (isCode) {
        if (prevMode === "composer" && state.composer && state.composer.hasBlocks()) {
          const gen = state.composer.getGeneratedLatex();
          if (gen && els.codeEditor.value.trim() !== gen) {
            setEditorCode(gen, { render: false, recordUndo: false });
          }
        }
        updateLineNumbers();
        renderCodeHighlight();
        requestAnimationFrame(syncLineNumberHeights);
      } else if (state.composer) {
        const res = state.composer.syncFromLatex(els.codeEditor.value);
        if (res?.synced && res.fallbackRaw) {
          toast("已将当前自定义 LaTeX 源码同步到拼装画布");
        }
      }
      renderLibrary();
    }

    els.editorModeSwitch.querySelectorAll(".mode-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchEditorMode(tab.dataset.mode));
    });

    function ensureSketcher() {
      if (!state.sketcher && window.ChemSketcher) {
        state.sketcher = window.ChemSketcher.init({
          modalEl: els.sketchModal,
          toast,
          onInsert: (code) => {
            insertAtCursor(code);
            closeModal(els.sketchModal);
          },
          onLoad: (code) => {
            setEditorCode(code, { render: true, immediate: true, recordUndo: true });
            closeModal(els.sketchModal);
          },
        });
      }
      return state.sketcher;
    }

    // Modals & Command Palette
    $("openSketchBtn").addEventListener("click", () => {
      const sk = ensureSketcher();
      if (state.editorMode === "composer" && state.composer && sk) {
        sk.openForBlock({
          blockId: null,
          sketchData: null,
          onApplyBlock: ({ blockId, code, sketchData }) => {
            state.composer.upsertSketchBlock(blockId, { name: "手绘分子", code, sketchData });
            closeModal(els.sketchModal);
            toast("已将手绘分子放入拼装画布");
          },
        });
      } else {
        sk?.openStandalone();
      }
      openModal(els.sketchModal);
    });
    $("openOcrBtn")?.addEventListener("click", () => openModal(els.ocrModal));
    $("openGuideBtn").addEventListener("click", () => openModal(els.guideModal));
    els.openCmdPaletteBtn?.addEventListener("click", openCmdPalette);

    els.cmdSearchInput?.addEventListener("input", () => {
      renderCmdResults(els.cmdSearchInput.value);
    });
    els.cmdSearchInput?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveCmdSelection(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveCmdSelection(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = state.cmdItems[state.cmdIndex];
        if (item) {
          closeModal(els.cmdPaletteModal);
          item.run();
        }
      }
    });

    // Global keyboard shortcuts (Ctrl+K, Ctrl+B, Escape)
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (els.cmdPaletteModal.classList.contains("hidden")) {
          openCmdPalette();
        } else {
          closeModal(els.cmdPaletteModal);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        if (!["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
          e.preventDefault();
          setSidePanel(state.sidePanelTab, { open: !state.sidePanelOpen });
          return;
        }
      }
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (!els.cmdPaletteModal.classList.contains("hidden")) {
          closeModal(els.cmdPaletteModal);
          return;
        }
        if (document.querySelector(".dropdown-wrap.open")) {
          closeAllDropdowns();
          return;
        }
        if (!els.guideModal.classList.contains("hidden")) {
          closeModal(els.guideModal);
          return;
        }
        if (!els.ocrModal.classList.contains("hidden")) {
          closeModal(els.ocrModal);
          return;
        }
        if (!els.sketchModal.classList.contains("hidden")) {
          closeModal(els.sketchModal);
        }
      }
    });

    document.querySelectorAll(".modal-close").forEach((btn) => {
      btn.addEventListener("click", () => closeModal($(btn.dataset.close)));
    });
    document.querySelectorAll(".modal-backdrop").forEach((bg) => {
      bg.addEventListener("click", (e) => {
        if (e.target === bg) closeModal(bg);
      });
    });

    // OCR modal actions + global image paste when not typing
    els.ocrDropZone.addEventListener("click", () => els.ocrFileInput.click());
    els.ocrFileInput.addEventListener("change", () => {
      if (els.ocrFileInput.files[0]) runImageOcr(els.ocrFileInput.files[0]);
    });
    els.ocrDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      els.ocrDropZone.classList.add("dragover");
    });
    els.ocrDropZone.addEventListener("dragleave", () => {
      els.ocrDropZone.classList.remove("dragover");
    });
    els.ocrDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      els.ocrDropZone.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) runImageOcr(file);
    });
    window.addEventListener("paste", (e) => {
      const ocrClosed = els.ocrModal.classList.contains("hidden");
      const activeTag = document.activeElement?.tagName;
      if (ocrClosed && ["INPUT", "TEXTAREA"].includes(activeTag)) return;
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            if (ocrClosed) openModal(els.ocrModal);
            runImageOcr(file);
            break;
          }
        }
      }
    });
    [els.ocrPreprocessSelect, els.ocrThickenSelect].forEach((el) => {
      el.addEventListener("change", () => {
        if (state.lastOcrFile) runImageOcr(state.lastOcrFile);
      });
    });
    [
      els.ocrTargetSelect,
      els.ocrRotateInput,
      els.ocrSnapChk,
      els.ocrCircleChk,
      els.ocrShowCChk,
      els.ocrShowMeChk,
    ].forEach((el) => {
      el.addEventListener("change", () => {
        if (state.lastOcrId || state.lastOcrFile) reformatCachedOcr();
      });
    });
    els.ocrOutput.addEventListener("input", () => {
      renderOcrMiniPreview(els.ocrOutput.value);
    });
    $("ocrInsertBtn").addEventListener("click", () => {
      insertAtCursor(els.ocrOutput.value.trim());
      closeModal(els.ocrModal);
    });
    $("ocrLoadBtn").addEventListener("click", () => {
      setEditorCode(els.ocrOutput.value.trim(), { render: true, immediate: true, recordUndo: true });
      if (state.editorMode === "composer" && state.composer) {
        state.composer.syncFromLatex(els.ocrOutput.value.trim());
      }
      closeModal(els.ocrModal);
    });

    $("clearHistoryBtn").addEventListener("click", () => {
      state.history = [];
      saveJsonStorage(STORAGE_KEYS.history, []);
      renderHistoryList();
      toast("已清空历史记录");
    });
  }

  async function bootstrap() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.theme) || "light";
    applyTheme(savedTheme, { syncPreview: false });
    const savedBg = localStorage.getItem(STORAGE_KEYS.previewBg);
    if (savedBg) setPreviewBg(savedBg, { persist: false });

    state.history = loadJsonStorage(STORAGE_KEYS.history, []);
    state.favorites = loadJsonStorage(STORAGE_KEYS.favorites, []);
    updateFavCounts();

    initSideResizer();
    initSplitResizer();
    initPreviewPan();
    bindEvents();

    const savedWrap = localStorage.getItem(STORAGE_KEYS.wordWrap);
    applyWordWrap(savedWrap !== "0", { persist: false });

    const savedTab = localStorage.getItem(STORAGE_KEYS.sidePanelTab) || "library";
    const savedOpenRaw = localStorage.getItem(STORAGE_KEYS.sidePanelOpen);
    const defaultOpen = window.innerWidth > 860;
    const isPanelOpen = savedOpenRaw === null ? defaultOpen : savedOpenRaw === "1";
    setSidePanel(savedTab, { open: isPanelOpen, persist: false });

    initExports();
    renderCodeQuickStrip();

    try {
      const resp = await fetch("/api/catalog");
      state.catalog = await resp.json();
      const fLen = (state.catalog.formula_templates || []).length;
      const mLen = (state.catalog.molecule_library || []).length;
      els.formulaCount.textContent = String(fLen);
      els.moleculeCount.textContent = String(mLen);
      els.libTotalBadge.textContent = String(fLen + mLen);
      renderRibbon();
      renderLibrary();
      renderFavoritesList();
      renderHistoryList();
    } catch (err) {
      toast(`加载模板库失败：${err}`, true);
    }

    const savedMode = localStorage.getItem(STORAGE_KEYS.editorMode) || "composer";
    state.editorMode = savedMode === "code" ? "code" : "composer";

    if (window.ChemComposer) {
      state.composer = window.ChemComposer.init({
        containerEl: els.composerView,
        autoSync: false,
        toast,
        getPreviewSvg: (id) => (state.catalog.previews || {})[id] || "",
        renderSnippetSvg: async (snippet) => {
          const resp = await fetch("/api/render", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: snippet }),
          });
          const data = await resp.json();
          return resp.ok && data.ok ? data.svg : "";
        },
        onCodeGenerated: (latex, { immediate = false } = {}) => {
          setEditorCode(latex, { render: true, immediate, recordUndo: true });
        },
        onOpenSketch: ({ blockId, sketchData, code, name }) => {
          if (!state.sketcher && window.ChemSketcher) {
            state.sketcher = window.ChemSketcher.init({
              modalEl: els.sketchModal,
              toast,
              onInsert: (c) => {
                insertAtCursor(c);
                closeModal(els.sketchModal);
              },
              onLoad: (c) => {
                setEditorCode(c, { render: true, immediate: true, recordUndo: true });
                closeModal(els.sketchModal);
              },
            });
          }
          state.sketcher?.openForBlock({
            blockId,
            sketchData,
            code,
            name,
            onApplyBlock: ({ blockId: bid, name: bname, code: nextCode, sketchData: sd }) => {
              state.composer?.upsertSketchBlock(bid, {
                name: bid ? (bname || undefined) : "手绘分子",
                code: nextCode,
                sketchData: sd,
              });
              closeModal(els.sketchModal);
              toast("已更新拼装画布中的分子积木");
            },
          });
          openModal(els.sketchModal);
        },
        onSwitchToCode: () => {
          els.editorModeSwitch.querySelector('[data-mode="code"]')?.click();
        },
      });
    }

    const isCodeInit = state.editorMode === "code";
    els.editorModeSwitch.querySelectorAll(".mode-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.mode === state.editorMode);
    });
    els.composerView.classList.toggle("hidden", isCodeInit);
    els.codeView.classList.toggle("hidden", !isCodeInit);

    const savedCode = localStorage.getItem(STORAGE_KEYS.code);
    if (isCodeInit && savedCode && savedCode.trim()) {
      els.codeEditor.value = savedCode;
      onCodeChanged({ triggerRender: true, immediate: true });
      requestAnimationFrame(syncLineNumberHeights);
    } else if (state.composer && state.composer.hasBlocks()) {
      state.composer.syncNow({ immediate: true });
    } else {
      els.codeEditor.value = savedCode && savedCode.trim() ? savedCode : DEFAULT_CODE;
      onCodeChanged({ triggerRender: true, immediate: true });
    }
  }

  bootstrap();
})();
