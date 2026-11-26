"""LaTeX compilation, tight cropping, caching, and multi-format export engine."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from collections import OrderedDict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import pymupdf
from PIL import Image, ImageChops

_CJK_MAIN_FONT = "Microsoft YaHei" if os.name == "nt" else "Noto Sans CJK SC"

KNOWN_TECTONIC_PATH = Path(
    r"C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt\dependencies\native\tectonic\tectonic.exe"
)

_CJK_RE = re.compile(r"[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]")
_MATH_TOKEN_RE = re.compile(
    r"(\\frac|\\sqrt|\\sum|\\int|\\Delta|\\ln|\\lg|\\partial|\\cdot|\\times|\^|_|=)"
)
_CACHE_FALLBACK_RE = re.compile(
    r"(only-cached|physical font|TFM|cannot download|not in cache|\.pfb|\.sty|Cannot proceed without)",
    re.IGNORECASE,
)

ALLOWED_FONT_SIZES = ("small", "normalsize", "large", "Large")


@dataclass
class RenderResult:
    ok: bool
    svg: str
    width: float
    height: float
    elapsed_ms: int
    cached: bool
    features: dict[str, Any]
    tex_source: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class CompileError(ValueError):
    """Structured LaTeX compilation or rendering error."""

    def __init__(
        self,
        message: str,
        *,
        hint: str = "",
        raw_log: str = "",
        error_line: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.raw_log = raw_log
        self.error_line = error_line


def find_tectonic() -> str:
    """Locate the local Tectonic executable reliably on Windows."""
    for env_key in ("CODEX_TECTONIC_PATH", "TECTONIC_PATH"):
        env_val = os.environ.get(env_key, "").strip()
        if env_val and Path(env_val).is_file():
            return env_val

    which_path = shutil.which("tectonic")
    if which_path and Path(which_path).is_file():
        return which_path

    try:
        if KNOWN_TECTONIC_PATH.is_file():
            return str(KNOWN_TECTONIC_PATH)
    except OSError:
        pass

    try:
        candidates = sorted(
            Path("C:/Program Files/WindowsApps").glob(
                "OpenAI.CodexPrimaryRuntime*/dependencies/native/tectonic/tectonic.exe"
            )
        )
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)
    except OSError:
        pass

    raise RuntimeError(
        "找不到 Tectonic 编译器。请确认已安装 tectonic 或设置环境变量 CODEX_TECTONIC_PATH。"
    )


_MATH_ONLY_MACROS = (
    r"\frac",
    r"\sqrt",
    r"\sum",
    r"\int",
    r"\partial",
    r"\lim",
)


def should_auto_wrap_math(code: str) -> bool:
    """Return True if bare math expression should be wrapped in display math \\[ ... \\]."""
    stripped = code.strip()
    if not stripped:
        return False
    excluded_markers = (
        r"\documentclass",
        r"\chemfig",
        r"\schemestart",
        r"\begin{",
        r"\tikz",
        "$",
        r"\[",
        r"\(",
    )
    if any(marker in stripped for marker in excluded_markers):
        return False
    has_chem_inline = (r"\ce{" in stripped) or (r"\pu{" in stripped)
    if has_chem_inline:
        # Only wrap \ce{...} expressions if they also use math-mode-only commands (e.g. \frac)
        return any(macro in stripped for macro in _MATH_ONLY_MACROS)
    if _CJK_RE.search(stripped) and r"\text{" not in stripped:
        return False
    return bool(_MATH_TOKEN_RE.search(stripped))


def detect_features(code: str) -> dict[str, Any]:
    """Detect packages, multipass flags, CJK text, and auto-math behavior."""
    stripped = code.strip()
    is_full_doc = r"\documentclass" in stripped
    uses_mhchem = (r"\ce{" in stripped) or (r"\pu{" in stripped)
    uses_chemfig = (r"\chemfig" in stripped) or (r"\schemestart" in stripped)
    uses_tikz = (r"\begin{tikzpicture}" in stripped) or (r"\tikz" in stripped)
    uses_chemmove = (
        (r"\chemmove" in stripped)
        or (r"\polymerdelim" in stripped)
        or ("remember picture" in stripped)
        or ("overlay" in stripped)
    )
    has_cjk = bool(_CJK_RE.search(stripped))
    auto_math_wrapped = should_auto_wrap_math(stripped)
    return {
        "is_full_doc": is_full_doc,
        "uses_mhchem": uses_mhchem,
        "uses_chemfig": uses_chemfig,
        "uses_tikz": uses_tikz,
        "uses_chemmove": uses_chemmove,
        "has_cjk": has_cjk,
        "auto_math_wrapped": auto_math_wrapped,
    }


def _normalize_dim(val: Any, default_unit: str = "pt") -> str | None:
    if val is None:
        return None
    text = str(val).strip()
    if not text:
        return None
    if re.fullmatch(r"[+-]?(\d+(\.\d+)?|\.\d+)", text):
        return f"{text}{default_unit}"
    if re.fullmatch(r"[+-]?(\d+(\.\d+)?|\.\d+)\s*(pt|em|ex|mm|cm|in|bp|pc)", text):
        return re.sub(r"\s+", "", text)
    raise CompileError(
        f"无效的长度参数：{text}",
        hint="请输入带单位或不带单位的数字，例如 2em、2.5pt 或 1.8。",
    )


def build_tex_document(
    code: str,
    *,
    atom_sep: str | None = None,
    bond_offset: str | None = None,
    double_bond_sep: str | None = None,
    font_size: str = "normalsize",
    custom_preamble: str = "",
) -> tuple[str, dict[str, Any]]:
    """Wrap user LaTeX code snippet into a compilable article document."""
    stripped = (code or "").strip()
    if not stripped:
        raise CompileError("请输入 LaTeX 化学代码或公式。")

    features = detect_features(stripped)
    if features["is_full_doc"]:
        features["body_start_line"] = 1
        return stripped, features

    size_cmd = font_size if font_size in ALLOWED_FONT_SIZES else "normalsize"

    lines = [
        r"\documentclass{article}",
        r"\usepackage{chemfig}",
        r"\usepackage[version=4]{mhchem}",
        r"\usepackage{amsmath}",
        r"\usepackage{amssymb}",
        r"\usepackage{tikz}",
        r"\usetikzlibrary{arrows.meta,positioning,calc}",
    ]
    if features["has_cjk"]:
        lines.extend(
            [
                r"\usepackage{fontspec}",
                rf"\setmainfont{{{_CJK_MAIN_FONT}}}",
            ]
        )

    lines.extend(
        [
            r"\special{papersize=48cm,36cm}",
            r"\textwidth=44cm \textheight=32cm",
            r"\oddsidemargin=-1.5cm \topmargin=-1.5cm",
            r"\pagestyle{empty}",
        ]
    )

    chemfig_opts: list[str] = []
    norm_atom_sep = _normalize_dim(atom_sep, "em")
    norm_bond_offset = _normalize_dim(bond_offset, "pt")
    norm_double_sep = _normalize_dim(double_bond_sep, "pt")
    if norm_atom_sep:
        chemfig_opts.append(f"atom sep={norm_atom_sep}")
    if norm_bond_offset:
        chemfig_opts.append(f"bond offset={norm_bond_offset}")
    if norm_double_sep:
        chemfig_opts.append(f"double bond sep={norm_double_sep}")
    if chemfig_opts:
        lines.append(rf"\setchemfig{{{', '.join(chemfig_opts)}}}")

    extra = (custom_preamble or "").strip()
    if extra:
        lines.append(extra)

    body = rf"\[ {stripped} \]" if features["auto_math_wrapped"] else stripped
    lines.extend(
        [
            r"\begin{document}",
            rf"\{size_cmd}",
        ]
    )
    features["body_start_line"] = len(lines) + 1
    lines.extend(
        [
            body,
            r"\end{document}",
            "",
        ]
    )
    return "\n".join(lines), features


def _parse_latex_error(
    raw_log: str,
    code: str,
    *,
    body_start_line: int = 1,
    is_full_doc: bool = False,
) -> CompileError:
    """Turn raw Tectonic / XeTeX output into helpful Chinese diagnostics."""
    log_text = (raw_log or "").strip()
    lines = log_text.splitlines()

    error_lines: list[str] = []
    raw_line: int | None = None
    for idx, line in enumerate(lines):
        stripped_line = line.strip()
        if "Fontconfig error:" in stripped_line:
            continue
        is_tex_err = stripped_line.startswith("!") or stripped_line.lower().startswith("error:")
        if is_tex_err:
            error_lines.append(line)
            for nxt in lines[idx + 1 : idx + 4]:
                if nxt.strip() and "Fontconfig error:" not in nxt:
                    error_lines.append(nxt)
                m = re.match(r"l\.(\d+)\s*(.*)", nxt.strip())
                if m and raw_line is None:
                    raw_line = int(m.group(1))

    if raw_line is None:
        for line in lines:
            m = re.match(r"l\.(\d+)\s*(.*)", line.strip())
            if m:
                raw_line = int(m.group(1))
                break

    user_line: int | None = None
    if raw_line is not None:
        if is_full_doc:
            user_line = raw_line
        elif raw_line >= body_start_line:
            code_line_count = max(1, len(code.splitlines()))
            user_line = max(1, min(code_line_count, raw_line - body_start_line + 1))

    summary = "\n".join(error_lines[:8]).strip() or "\n".join(lines[-10:]).strip()
    msg = "LaTeX 编译失败"
    if user_line is not None:
        msg += f"（第 {user_line} 行附近）"
    elif raw_line is not None:
        msg += f"（导言区第 {raw_line} 行附近）"
    if summary:
        first_err = summary.splitlines()[0]
        msg += f"：{first_err}"

    hints: list[str] = []
    if code.count("{") != code.count("}"):
        hints.append(
            f"检测到花括号不配对（左括号 {code.count('{')} 个，右括号 {code.count('}')} 个），请补全缺失的花括号。"
        )
    if code.count("(") != code.count(")"):
        hints.append(
            f"检测到圆括号不配对（左括号 {code.count('(')} 个，右括号 {code.count(')')} 个），请检查 chemfig 支链括号。"
        )
    if re.search(r"[-=><~](?:\[[^\]]*\])?(?:<:|>:|[<>=-~])\[", code):
        hints.append(
            "注意 chemfig 防踩坑规则：从折线隐式碳顶点切换键型时需加括号，例如写成 -[:135](<:[2]OH) 而非 -[:135]<:[2]OH。"
        )
    if "Undefined control sequence" in log_text:
        hints.append(
            "存在未定义的 LaTeX 命令：请检查命令拼写，或在设置-自定义导言区中添加所需宏包。"
        )
    if "Missing $ inserted" in log_text or "Display math should end" in log_text:
        hints.append(
            "数学模式未正确开启或闭合：请检查 $...$、\\[...\\] 或在 \\arrow 条件中给 \\Delta 等数学符号加上 $...$。"
        )
    if "Package tikz Error" in log_text or "Package pgf Error" in log_text:
        hints.append(
            "TikZ/PGF 绘图语法出错：请检查坐标格式 (x,y)、分号结尾 ; 以及节点名称是否定义。"
        )
    if not hints:
        hints.append("请检查最近编辑的括号、命令反斜杠及 chemfig 键语法。")

    return CompileError(
        msg,
        hint=" ".join(hints),
        raw_log=log_text[-2500:],
        error_line=user_line,
    )


def _run_tectonic(
    tectonic_bin: str,
    folder: Path,
    tex_name: str,
    *,
    only_cached: bool,
    reruns: int,
    timeout: int,
) -> subprocess.CompletedProcess[str]:
    cmd = [tectonic_bin, "--untrusted"]
    if only_cached:
        cmd.append("--only-cached")
    cmd.extend(["--reruns", str(reruns), tex_name])
    return subprocess.run(
        cmd,
        cwd=str(folder),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def compile_to_pdf_bytes(
    tex_source: str,
    *,
    reruns: int = 0,
    source_code: str = "",
    body_start_line: int = 1,
    is_full_doc: bool = False,
) -> tuple[bytes, float]:
    """Compile LaTeX source with Tectonic and return PDF bytes in memory."""
    tectonic_bin = find_tectonic()
    start = time.perf_counter()

    with tempfile.TemporaryDirectory() as folder_str:
        folder = Path(folder_str)
        tex_path = folder / "preview.tex"
        tex_path.write_text(tex_source, encoding="utf-8")

        try:
            proc = _run_tectonic(
                tectonic_bin,
                folder,
                tex_path.name,
                only_cached=True,
                reruns=reruns,
                timeout=25,
            )
            combined_out = f"{proc.stdout or ''}\n{proc.stderr or ''}"
            log_path = folder / "preview.log"
            log_extra = (
                log_path.read_text(encoding="utf-8", errors="replace")
                if log_path.is_file()
                else ""
            )

            if proc.returncode != 0 and _CACHE_FALLBACK_RE.search(combined_out + "\n" + log_extra):
                proc = _run_tectonic(
                    tectonic_bin,
                    folder,
                    tex_path.name,
                    only_cached=False,
                    reruns=reruns,
                    timeout=90,
                )
                combined_out = f"{proc.stdout or ''}\n{proc.stderr or ''}"
                log_extra = (
                    log_path.read_text(encoding="utf-8", errors="replace")
                    if log_path.is_file()
                    else ""
                )
        except subprocess.TimeoutExpired as exc:
            raise CompileError(
                "Tectonic 编译超时，请检查是否存在死循环宏或网络连接卡顿。",
                hint="如包含 \\chemmove 或复杂 TikZ 循环，请简化后重试。",
                raw_log=str(exc),
            ) from exc

        if proc.returncode != 0:
            raise _parse_latex_error(
                combined_out + "\n" + log_extra,
                source_code or tex_source,
                body_start_line=body_start_line,
                is_full_doc=is_full_doc,
            )

        pdf_path = folder / "preview.pdf"
        if not pdf_path.is_file():
            raise CompileError("编译完成但未生成 PDF 文件。", raw_log=combined_out)

        # Read PDF bytes before TemporaryDirectory cleanup so PyMuPDF never holds Windows file locks.
        pdf_bytes = pdf_path.read_bytes()

    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return pdf_bytes, elapsed_ms


def _crop_page_tight(page: pymupdf.Page, *, pad: float = 6.0) -> pymupdf.Rect:
    """Compute tight non-white bounding box on a page and apply cropbox."""
    probe_scale = 2.0
    pix = page.get_pixmap(matrix=pymupdf.Matrix(probe_scale, probe_scale), alpha=False)
    im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    bg = Image.new("RGB", im.size, "white")
    bbox = ImageChops.difference(im, bg).getbbox()
    if not bbox:
        raise CompileError(
            "渲染结果为空白，请检查代码是否输出了可见内容。",
            hint="例如仅写了注释、空括号，或公式未放在正确环境中。",
        )

    inv = 1.0 / probe_scale
    media = page.mediabox
    left = max(media.x0, media.x0 + bbox[0] * inv - pad)
    top = max(media.y0, media.y0 + bbox[1] * inv - pad)
    right = min(media.x1, media.x0 + bbox[2] * inv + pad)
    bottom = min(media.y1, media.y0 + bbox[3] * inv + pad)
    clip = pymupdf.Rect(left, top, right, bottom)
    page.set_cropbox(clip)
    return page.rect


def namespace_svg_ids(svg: str) -> str:
    """Prefix internal SVG IDs so multiple inline SVGs in one DOM never collide on clip_1 / font_*."""
    if not svg or 'id="' not in svg:
        return svg
    ids = set(re.findall(r'\bid="([^"]+)"', svg))
    if not ids:
        return svg
    if all(i.startswith("s_") and len(i) > 11 and i[10] == "_" for i in ids):
        return svg
    prefix = "s_" + hashlib.sha256(svg.encode("utf-8")).hexdigest()[:8] + "_"
    svg = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{prefix}{m.group(1)}"', svg)
    svg = re.sub(r"url\(#([^)]+)\)", lambda m: f"url(#{prefix}{m.group(1)})", svg)
    svg = re.sub(r'(xlink:href|href)="#([^"]+)"', lambda m: f'{m.group(1)}="#{prefix}{m.group(2)}"', svg)
    return svg


def crop_pdf_to_svg(pdf_bytes: bytes, *, pad: float = 6.0) -> tuple[str, float, float]:
    """Crop first page of PDF tightly and export crisp vector SVG."""
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        if len(doc) == 0:
            raise CompileError("PDF 为空页。")
        page = doc[0]
        rect = _crop_page_tight(page, pad=pad)
        svg = namespace_svg_ids(page.get_svg_image(text_as_path=1))
        return svg, float(rect.width), float(rect.height)


def crop_pdf_to_png(
    pdf_bytes: bytes,
    *,
    scale: float = 3.0,
    transparent: bool = False,
    pad: float = 8.0,
) -> bytes:
    """Crop first page of PDF tightly and export high-DPI PNG bytes."""
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        if len(doc) == 0:
            raise CompileError("PDF 为空页。")
        page = doc[0]
        _crop_page_tight(page, pad=pad)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=transparent)
        return pix.tobytes("png")


def crop_pdf_bytes(pdf_bytes: bytes, *, pad: float = 8.0) -> bytes:
    """Crop first page of PDF tightly and return cropped PDF bytes."""
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        if len(doc) == 0:
            raise CompileError("PDF 为空页。")
        _crop_page_tight(doc[0], pad=pad)
        return doc.tobytes()


class _RenderCache:
    """Thread-safe bounded LRU cache for compiled RenderResult objects."""

    def __init__(self, maxsize: int = 256) -> None:
        self._maxsize = maxsize
        self._lock = threading.Lock()
        self._store: OrderedDict[str, RenderResult] = OrderedDict()

    def get(self, key: str) -> RenderResult | None:
        with self._lock:
            item = self._store.get(key)
            if item is None:
                return None
            self._store.move_to_end(key)
            return item

    def put(self, key: str, value: RenderResult) -> None:
        with self._lock:
            self._store[key] = value
            self._store.move_to_end(key)
            while len(self._store) > self._maxsize:
                self._store.popitem(last=False)


_SVG_CACHE = _RenderCache(maxsize=256)
_PDF_CACHE_LOCK = threading.Lock()
_PDF_CACHE: OrderedDict[str, tuple[bytes, dict[str, Any], str]] = OrderedDict()


def _make_cache_key(
    code: str,
    atom_sep: str | None,
    bond_offset: str | None,
    double_bond_sep: str | None,
    font_size: str,
    custom_preamble: str,
) -> str:
    payload = "\x1f".join(
        [
            code.strip(),
            str(atom_sep or ""),
            str(bond_offset or ""),
            str(double_bond_sep or ""),
            font_size or "normalsize",
            custom_preamble.strip(),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _compile_cached_pdf(
    code: str,
    *,
    atom_sep: str | None = None,
    bond_offset: str | None = None,
    double_bond_sep: str | None = None,
    font_size: str = "normalsize",
    custom_preamble: str = "",
) -> tuple[str, bytes, dict[str, Any], str, float, bool]:
    key = _make_cache_key(
        code, atom_sep, bond_offset, double_bond_sep, font_size, custom_preamble
    )
    with _PDF_CACHE_LOCK:
        cached = _PDF_CACHE.get(key)
        if cached is not None:
            _PDF_CACHE.move_to_end(key)
            pdf_bytes, features, tex_source = cached
            return key, pdf_bytes, features, tex_source, 0.0, True

    tex_source, features = build_tex_document(
        code,
        atom_sep=atom_sep,
        bond_offset=bond_offset,
        double_bond_sep=double_bond_sep,
        font_size=font_size,
        custom_preamble=custom_preamble,
    )
    reruns = 1 if features["uses_chemmove"] else 0
    pdf_bytes, elapsed_ms = compile_to_pdf_bytes(
        tex_source,
        reruns=reruns,
        source_code=code,
        body_start_line=features.get("body_start_line", 1),
        is_full_doc=features.get("is_full_doc", False),
    )

    with _PDF_CACHE_LOCK:
        _PDF_CACHE[key] = (pdf_bytes, features, tex_source)
        _PDF_CACHE.move_to_end(key)
        while len(_PDF_CACHE) > 128:
            _PDF_CACHE.popitem(last=False)

    return key, pdf_bytes, features, tex_source, elapsed_ms, False


def render_svg(
    code: str,
    *,
    atom_sep: str | None = None,
    bond_offset: str | None = None,
    double_bond_sep: str | None = None,
    font_size: str = "normalsize",
    custom_preamble: str = "",
) -> RenderResult:
    """Render LaTeX chemistry code to tightly cropped SVG with caching."""
    key = _make_cache_key(
        code, atom_sep, bond_offset, double_bond_sep, font_size, custom_preamble
    )
    cached_res = _SVG_CACHE.get(key)
    if cached_res is not None:
        return RenderResult(
            ok=True,
            svg=cached_res.svg,
            width=cached_res.width,
            height=cached_res.height,
            elapsed_ms=1,
            cached=True,
            features=cached_res.features,
            tex_source=cached_res.tex_source,
        )

    t0 = time.perf_counter()
    _, pdf_bytes, features, tex_source, _, _ = _compile_cached_pdf(
        code,
        atom_sep=atom_sep,
        bond_offset=bond_offset,
        double_bond_sep=double_bond_sep,
        font_size=font_size,
        custom_preamble=custom_preamble,
    )
    svg, width, height = crop_pdf_to_svg(pdf_bytes)
    elapsed_ms = max(1, int(round((time.perf_counter() - t0) * 1000.0)))

    result = RenderResult(
        ok=True,
        svg=svg,
        width=round(width, 2),
        height=round(height, 2),
        elapsed_ms=elapsed_ms,
        cached=False,
        features=features,
        tex_source=tex_source,
    )
    _SVG_CACHE.put(key, result)
    return result


def export_png(
    code: str,
    *,
    scale: float = 3.0,
    transparent: bool = False,
    atom_sep: str | None = None,
    bond_offset: str | None = None,
    double_bond_sep: str | None = None,
    font_size: str = "normalsize",
    custom_preamble: str = "",
) -> bytes:
    """Compile and export tightly cropped PNG bytes."""
    clamped_scale = max(1.0, min(8.0, float(scale)))
    _, pdf_bytes, _, _, _, _ = _compile_cached_pdf(
        code,
        atom_sep=atom_sep,
        bond_offset=bond_offset,
        double_bond_sep=double_bond_sep,
        font_size=font_size,
        custom_preamble=custom_preamble,
    )
    return crop_pdf_to_png(pdf_bytes, scale=clamped_scale, transparent=transparent)


def export_pdf(
    code: str,
    *,
    atom_sep: str | None = None,
    bond_offset: str | None = None,
    double_bond_sep: str | None = None,
    font_size: str = "normalsize",
    custom_preamble: str = "",
) -> bytes:
    """Compile and export tightly cropped single-page PDF bytes."""
    _, pdf_bytes, _, _, _, _ = _compile_cached_pdf(
        code,
        atom_sep=atom_sep,
        bond_offset=bond_offset,
        double_bond_sep=double_bond_sep,
        font_size=font_size,
        custom_preamble=custom_preamble,
    )
    return crop_pdf_bytes(pdf_bytes)


def batch_compile_pages(
    items: list[tuple[str, str]],
    *,
    has_cjk: bool = False,
    reruns: int = 0,
    pad: float = 5.0,
) -> dict[str, str]:
    """Batch-compile multiple snippets in one multi-page TeX run and return {id: svg}."""
    if not items:
        return {}

    lines = [
        r"\documentclass{article}",
        r"\usepackage{chemfig}",
        r"\usepackage[version=4]{mhchem}",
        r"\usepackage{amsmath}",
        r"\usepackage{amssymb}",
        r"\usepackage{tikz}",
        r"\usetikzlibrary{arrows.meta,positioning,calc}",
    ]
    if has_cjk:
        lines.extend(
            [
                r"\usepackage{fontspec}",
                rf"\setmainfont{{{_CJK_MAIN_FONT}}}",
            ]
        )
    lines.extend(
        [
            r"\special{papersize=48cm,36cm}",
            r"\textwidth=44cm \textheight=32cm",
            r"\oddsidemargin=-1.5cm \topmargin=-1.5cm",
            r"\pagestyle{empty}",
            r"\begin{document}",
        ]
    )

    for idx, (_, raw_code) in enumerate(items):
        if idx > 0:
            lines.append(r"\newpage\special{papersize=48cm,36cm}")
        code = raw_code.strip()
        if should_auto_wrap_math(code):
            code = rf"\[ {code} \]"
        lines.append(code)
    lines.append(r"\end{document}")

    tex_source = "\n".join(lines) + "\n"
    pdf_bytes, _ = compile_to_pdf_bytes(tex_source, reruns=reruns)

    svgs: dict[str, str] = {}
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        if len(doc) != len(items):
            raise CompileError(
                f"批量预渲染页数不匹配：期望 {len(items)} 页，实际 {len(doc)} 页。"
            )
        for idx, (item_id, _) in enumerate(items):
            page = doc[idx]
            _crop_page_tight(page, pad=pad)
            svgs[item_id] = namespace_svg_ids(page.get_svg_image(text_as_path=1))
    return svgs
