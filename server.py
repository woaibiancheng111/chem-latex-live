"""FastAPI server for ChemLaTeX Live (mhchem + chemfig + TikZ + 2D Sketcher)."""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import math
import shutil
import socket
import subprocess
import tempfile
import threading
import uuid
import webbrowser
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np
import pymupdf
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageDraw, ImageFilter
from pydantic import BaseModel, Field
from rdkit import Chem

from chem_latex_live import catalog, chemfig_gen, compiler

PACKAGE_DIR = Path(__file__).resolve().parent
STATIC_DIR = PACKAGE_DIR / "static"
PREVIEWS_JSON = STATIC_DIR / "template_previews.json"
WORKSPACE_ROOT = PACKAGE_DIR.parent
MOLVEC_JAR = WORKSPACE_ROOT / "tools" / "molvec-0.9.8-jar-with-dependencies.jar"

_EXECUTOR = ThreadPoolExecutor(max_workers=2)
_OCR_CACHE_LOCK = threading.Lock()
_OCR_CACHE: OrderedDict[str, str] = OrderedDict()
_OCR_CACHE_MAX = 32

app = FastAPI(title="ChemLaTeX Live", version="1.1.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.middleware("http")
async def _no_cache_static(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


class RenderRequest(BaseModel):
    code: str = ""
    atom_sep: str | None = None
    bond_offset: str | None = None
    double_bond_sep: str | None = None
    font_size: str = "normalsize"
    custom_preamble: str = ""


class PngExportRequest(RenderRequest):
    scale: float = Field(default=3.0, ge=1.0, le=8.0)
    transparent: bool = False


class OcrReformatRequest(BaseModel):
    ocr_id: str
    target: str = "chemfig"
    rotate: float = 0.0
    show_carbon: bool = False
    show_methyl: bool = False
    snap_angles: bool = True
    circle_aromatic: bool = False


class SketchRequest(BaseModel):
    atoms: list[dict[str, Any]] = Field(default_factory=list)
    bonds: list[dict[str, Any]] = Field(default_factory=list)
    rings: list[dict[str, Any]] = Field(default_factory=list)
    rotate: float = 0.0
    snap_angles: bool = True
    show_carbon: bool = False
    pretty: bool = False
    uniform_bonds: bool = True


class ChemfigParseRequest(BaseModel):
    code: str = ""


def _cache_ocr_molblock(molblock: str) -> str:
    ocr_id = uuid.uuid4().hex[:12]
    with _OCR_CACHE_LOCK:
        _OCR_CACHE[ocr_id] = molblock
        _OCR_CACHE.move_to_end(ocr_id)
        while len(_OCR_CACHE) > _OCR_CACHE_MAX:
            _OCR_CACHE.popitem(last=False)
    return ocr_id


def _get_cached_ocr_molblock(ocr_id: str) -> str | None:
    with _OCR_CACHE_LOCK:
        val = _OCR_CACHE.get(ocr_id)
        if val is not None:
            _OCR_CACHE.move_to_end(ocr_id)
        return val


def _num_str(value: float) -> str:
    text = f"{float(value):.3f}".rstrip("0").rstrip(".")
    return text if text not in {"", "-0"} else "0"


def _tikz_segment(p1: tuple[float, float], p2: tuple[float, float], offset: float = 0.0) -> str:
    x1, y1 = p1
    x2, y2 = p2
    if offset:
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy) or 1.0
        ox, oy = -dy / length * offset, dx / length * offset
        x1, y1, x2, y2 = x1 + ox, y1 + oy, x2 + ox, y2 + oy
    return f"({_num_str(x1)},{_num_str(y1)}) -- ({_num_str(x2)},{_num_str(y2)})"


def _atom_tex(atom: Chem.Atom) -> str:
    symbol = atom.GetSymbol()
    if symbol == "C" and atom.GetIsotope() == 0 and atom.GetFormalCharge() == 0:
        return ""
    label = rf"\mathrm{{{symbol}}}"
    isotope = atom.GetIsotope()
    if isotope:
        label = rf"^{{{isotope}}}" + label
    hydrogens = atom.GetTotalNumHs()
    if hydrogens and symbol not in {"H", "C"}:
        label += rf"\mathrm{{H}}_{{{hydrogens}}}" if hydrogens > 1 else r"\mathrm{H}"
    charge = atom.GetFormalCharge()
    if charge:
        sign = "+" if charge > 0 else "-"
        amount = abs(charge)
        label += rf"^{{{sign if amount == 1 else f'{amount}{sign}'}}}"
    return label


def _molblock_to_tikz(molblock: str) -> str:
    mol = Chem.MolFromMolBlock(molblock, sanitize=True, removeHs=False)
    if mol is None:
        mol = Chem.MolFromMolBlock(molblock, sanitize=False, removeHs=False)
    if mol is None or mol.GetNumAtoms() == 0:
        raise ValueError("图片没有识别出可绘制的化学结构。")
    try:
        Chem.Kekulize(mol, clearAromaticFlags=True)
    except Exception:
        pass
    conformer = mol.GetConformer()
    points = [
        (conformer.GetAtomPosition(i).x, conformer.GetAtomPosition(i).y)
        for i in range(mol.GetNumAtoms())
    ]
    min_x, max_x = min(x for x, _ in points), max(x for x, _ in points)
    min_y, max_y = min(y for _, y in points), max(y for _, y in points)
    width, height = max_x - min_x or 1.0, max_y - min_y or 1.0
    scale = min(1.25, 12.0 / width, 8.0 / height)
    mapped = [((x - min_x) * scale, (max_y - y) * scale) for x, y in points]

    lines = [
        r"\begin{tikzpicture}[x=1cm,y=1cm,line cap=round,line join=round]",
        r"  % 由图片识别自动生成，请核对原子标签与键级。",
    ]
    for bond in mol.GetBonds():
        p1, p2 = mapped[bond.GetBeginAtomIdx()], mapped[bond.GetEndAtomIdx()]
        btype = bond.GetBondType()
        if btype == Chem.BondType.DOUBLE:
            lines.append(f"  \\draw[double distance=1.8pt] {_tikz_segment(p1, p2)};")
        elif btype == Chem.BondType.TRIPLE:
            lines.append(f"  \\draw {_tikz_segment(p1, p2)};")
            lines.append(f"  \\draw {_tikz_segment(p1, p2, 0.035)};")
            lines.append(f"  \\draw {_tikz_segment(p1, p2, -0.035)};")
        else:
            lines.append(f"  \\draw {_tikz_segment(p1, p2)};")
    for atom, point in zip(mol.GetAtoms(), mapped):
        label = _atom_tex(atom)
        if label:
            lines.append(
                f"  \\node[inner sep=1pt,fill=white] at ({_num_str(point[0])},{_num_str(point[1])}) {{$ {label} $}};"
            )
    lines.append(r"\end{tikzpicture}")
    return "\n".join(lines)


def _flatten_to_rgb_white(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(bg, rgba).convert("RGB")
    return img.convert("RGB")


def _preprocess_for_molvec(
    img: Image.Image,
    *,
    mode: str = "auto",
    thicken: int = 1,
) -> Image.Image:
    """Clean uneven paper background, normalize stroke contrast, and pad for MolVec OCR."""
    rgb = _flatten_to_rgb_white(img)
    if mode != "auto":
        return rgb

    gray_img = rgb.convert("L")
    w, h = gray_img.size
    radius = max(12, min(48, min(w, h) // 16))
    bg_img = gray_img.filter(ImageFilter.BoxBlur(radius))

    gray_arr = np.asarray(gray_img, dtype=np.int16)
    bg_arr = np.asarray(bg_img, dtype=np.int16)
    diff = bg_arr - gray_arr  # positive where ink is darker than local paper

    # Adaptive threshold: ignore faint paper noise while keeping light pencil/pen strokes
    positive = diff[diff > 6]
    if positive.size > 0:
        p85 = float(np.percentile(positive, 85))
        thresh = max(16.0, min(45.0, p85 * 0.38))
    else:
        thresh = 20.0

    binary = np.where(diff > thresh, 0, 255).astype(np.uint8)
    out = Image.fromarray(binary, mode="L")

    # Slightly thicken thin handwritten lines (black ink = 0, so MinFilter dilates ink)
    steps = max(0, min(2, int(thicken)))
    for _ in range(steps):
        out = out.filter(ImageFilter.MinFilter(3))

    # Tight crop around ink and add generous white border
    arr = np.asarray(out)
    ys, xs = np.where(arr < 250)
    if ys.size > 0 and xs.size > 0:
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        out = out.crop((x0, y0, x1, y1))

    cw, ch = out.size
    pad = max(24, int(round(max(cw, ch) * 0.08)))
    padded = Image.new("L", (cw + 2 * pad, ch + 2 * pad), 255)
    padded.paste(out, (pad, pad))

    # Scale to MolVec sweet spot [600..1500] px on longest edge
    pw, ph = padded.size
    longest = max(pw, ph)
    if longest < 600:
        scale = 600.0 / longest
        padded = padded.resize((int(round(pw * scale)), int(round(ph * scale))), Image.Resampling.LANCZOS)
    elif longest > 1500:
        scale = 1500.0 / longest
        padded = padded.resize((int(round(pw * scale)), int(round(ph * scale))), Image.Resampling.LANCZOS)

    return padded.convert("RGB")


def _image_to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _parse_strokes_json(raw_bytes: bytes) -> list[list[tuple[float, float]]]:
    payload = json.loads(raw_bytes.decode("utf-8-sig"))
    if isinstance(payload, dict):
        strokes = payload.get("strokes", [])
    elif isinstance(payload, list):
        strokes = payload
    else:
        raise ValueError("轨迹 JSON 必须是对象或数组。")

    output: list[list[tuple[float, float]]] = []
    for stroke in strokes:
        points = stroke.get("points", stroke.get("canvas_points", [])) if isinstance(stroke, dict) else stroke
        clean: list[tuple[float, float]] = []
        for point in points:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                x, y = float(point[0]), float(point[1])
                if math.isfinite(x) and math.isfinite(y):
                    clean.append((x, y))
        if clean:
            output.append(clean)
    if not output:
        raise ValueError("轨迹 JSON 中没有可绘制的坐标点。")
    return output


def _simplify_points(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        start, end = pending.pop()
        x1, y1 = points[start]
        x2, y2 = points[end]
        dx, dy = x2 - x1, y2 - y1
        len_sq = dx * dx + dy * dy
        best_dist, best_idx = tolerance, None
        for idx in range(start + 1, end):
            x, y = points[idx]
            if len_sq:
                ratio = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / len_sq))
                px, py = x1 + ratio * dx, y1 + ratio * dy
            else:
                px, py = x1, y1
            dist = math.hypot(x - px, y - py)
            if dist > best_dist:
                best_dist, best_idx = dist, idx
        if best_idx is not None:
            keep.add(best_idx)
            pending.extend(((start, best_idx), (best_idx, end)))
    return [pt for idx, pt in enumerate(points) if idx in keep]


def _strokes_to_tikz(strokes: list[list[tuple[float, float]]]) -> str:
    all_pts = [pt for s in strokes for pt in s]
    min_x = min(x for x, _ in all_pts)
    max_x = max(x for x, _ in all_pts)
    min_y = min(y for _, y in all_pts)
    max_y = max(y for _, y in all_pts)
    width = max_x - min_x or 1.0
    height = max_y - min_y or 1.0
    scale = min(12.0 / width, 8.0 / height)

    lines = [
        r"\begin{tikzpicture}[x=1cm,y=1cm,line cap=round,line join=round]",
        r"  % 由笔迹轨迹 JSON 自动生成，坐标已归一化为厘米。",
    ]
    for stroke in strokes:
        simplified = _simplify_points(stroke, max(width, height) * 0.001)
        mapped = [((x - min_x) * scale, (max_y - y) * scale) for x, y in simplified]
        if len(mapped) == 1:
            lines.append(f"  \\fill ({_num_str(mapped[0][0])},{_num_str(mapped[0][1])}) circle (0.03);")
        else:
            coords = " -- ".join(f"({_num_str(x)},{_num_str(y)})" for x, y in mapped)
            lines.append(f"  \\draw[line width=.55pt] {coords};")
    lines.append(r"\end{tikzpicture}")
    return "\n".join(lines)


def _strokes_to_pil_image(strokes: list[list[tuple[float, float]]]) -> Image.Image:
    all_pts = [pt for s in strokes for pt in s]
    min_x = min(x for x, _ in all_pts)
    max_x = max(x for x, _ in all_pts)
    min_y = min(y for _, y in all_pts)
    max_y = max(y for _, y in all_pts)
    width = max_x - min_x or 1.0
    height = max_y - min_y or 1.0
    target_size = 760.0
    scale = min(target_size / width, target_size / height)
    pad = 40
    img_w = max(120, int(round(width * scale)) + 2 * pad)
    img_h = max(120, int(round(height * scale)) + 2 * pad)

    img = Image.new("RGB", (img_w, img_h), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    for stroke in strokes:
        pts = [((x - min_x) * scale + pad, (y - min_y) * scale + pad) for x, y in stroke]
        if len(pts) == 1:
            x, y = pts[0]
            draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(0, 0, 0))
        else:
            draw.line(pts, fill=(0, 0, 0), width=3, joint="curve")
    return img


def _run_molvec_on_pil(img: Image.Image) -> str:
    if not MOLVEC_JAR.is_file():
        raise RuntimeError(f"缺少 MolVec 识别引擎：{MOLVEC_JAR}")
    java_bin = shutil.which("java")
    if not java_bin:
        raise RuntimeError("系统未找到 Java 运行环境，无法调用 MolVec 识图。")

    with tempfile.TemporaryDirectory() as folder_str:
        img_path = Path(folder_str) / "input.png"
        img.save(img_path, format="PNG")
        proc = subprocess.run(
            [java_bin, "-jar", str(MOLVEC_JAR), "-f", str(img_path)],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=90,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if proc.returncode != 0:
            msg = (proc.stderr or proc.stdout).strip()[-1000:]
            raise ValueError(f"MolVec 识图失败：{msg}")
        return proc.stdout


def _format_molblock(
    molblock: str,
    *,
    target: str,
    rotate: float = 0.0,
    show_carbon: bool = False,
    show_methyl: bool = False,
    snap_angles: bool = True,
    circle_aromatic: bool = False,
) -> str:
    if target == "tikz":
        return _molblock_to_tikz(molblock)
    return chemfig_gen.molblock_to_chemfig_clean(
        molblock,
        rotate=rotate,
        show_carbon=show_carbon,
        show_methyl=show_methyl,
        snap_angles=snap_angles,
        circle_aromatic=circle_aromatic,
    )


def _recognize_upload(
    raw_bytes: bytes,
    filename: str,
    *,
    target: str,
    preprocess: str,
    thicken: int,
    rotate: float,
    show_carbon: bool,
    show_methyl: bool,
    snap_angles: bool,
    circle_aromatic: bool,
) -> dict[str, Any]:
    suffix = Path(filename or "upload.png").suffix.lower() or ".png"

    if suffix == ".json":
        strokes = _parse_strokes_json(raw_bytes)
        if target == "tikz":
            code = _strokes_to_tikz(strokes)
            pil_preview = _strokes_to_pil_image(strokes)
            return {
                "ok": True,
                "ocr_id": None,
                "code": code,
                "target": "tikz",
                "preview_data_url": _image_to_data_url(pil_preview),
            }
        pil_img = _strokes_to_pil_image(strokes)
    elif suffix == ".svg":
        with pymupdf.open(stream=raw_bytes, filetype="svg") as svg_doc:
            pdf_bytes = svg_doc.convert_to_pdf()
        with pymupdf.open(stream=pdf_bytes, filetype="pdf") as pdf_doc:
            pix = pdf_doc[0].get_pixmap(matrix=pymupdf.Matrix(3, 3), alpha=False)
            pil_img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    else:
        pil_img = Image.open(io.BytesIO(raw_bytes))

    processed = _preprocess_for_molvec(pil_img, mode=preprocess, thicken=thicken)
    molblock = _run_molvec_on_pil(processed)
    code = _format_molblock(
        molblock,
        target=target,
        rotate=rotate,
        show_carbon=show_carbon,
        show_methyl=show_methyl,
        snap_angles=snap_angles,
        circle_aromatic=circle_aromatic,
    )
    ocr_id = _cache_ocr_molblock(molblock)
    return {
        "ok": True,
        "ocr_id": ocr_id,
        "code": code,
        "target": target,
        "preview_data_url": _image_to_data_url(processed),
    }


def _load_previews() -> dict[str, str]:
    if not PREVIEWS_JSON.is_file():
        return {}
    try:
        data = json.loads(PREVIEWS_JSON.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {str(k): compiler.namespace_svg_ids(str(v)) for k, v in data.items()}
    except Exception:
        pass
    return {}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/favicon.ico")
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    tectonic_path = ""
    tectonic_ok = False
    try:
        tectonic_path = compiler.find_tectonic()
        tectonic_ok = True
    except Exception as exc:
        tectonic_path = str(exc)

    previews = _load_previews()
    return {
        "ok": tectonic_ok,
        "tectonic": tectonic_ok,
        "tectonic_path": tectonic_path,
        "molvec": MOLVEC_JAR.is_file() and bool(shutil.which("java")),
        "sketcher": True,
        "preview_count": len(previews),
    }


@app.get("/api/catalog")
async def get_catalog() -> dict[str, Any]:
    return {
        "ribbon_tabs": catalog.RIBBON_TABS,
        "formula_categories": catalog.FORMULA_CATEGORIES,
        "formula_templates": catalog.FORMULA_TEMPLATES,
        "molecule_categories": catalog.MOLECULE_CATEGORIES,
        "molecule_library": catalog.MOLECULE_LIBRARY,
        "previews": _load_previews(),
    }


@app.post("/api/render")
async def render_formula(req: RenderRequest) -> JSONResponse:
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            _EXECUTOR,
            lambda: compiler.render_svg(
                req.code,
                atom_sep=req.atom_sep,
                bond_offset=req.bond_offset,
                double_bond_sep=req.double_bond_sep,
                font_size=req.font_size,
                custom_preamble=req.custom_preamble,
            ),
        )
        return JSONResponse(result.to_dict())
    except compiler.CompileError as exc:
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": exc.message,
                "hint": exc.hint,
                "raw_log": exc.raw_log,
                "error_line": exc.error_line,
            },
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": f"服务器内部错误：{exc}",
                "hint": "",
                "raw_log": "",
                "error_line": None,
            },
        )


@app.post("/api/export/png")
async def export_png_endpoint(req: PngExportRequest) -> Response:
    loop = asyncio.get_running_loop()
    try:
        png_bytes = await loop.run_in_executor(
            _EXECUTOR,
            lambda: compiler.export_png(
                req.code,
                scale=req.scale,
                transparent=req.transparent,
                atom_sep=req.atom_sep,
                bond_offset=req.bond_offset,
                double_bond_sep=req.double_bond_sep,
                font_size=req.font_size,
                custom_preamble=req.custom_preamble,
            ),
        )
        return Response(
            content=png_bytes,
            media_type="image/png",
            headers={"Content-Disposition": 'attachment; filename="chem-formula.png"'},
        )
    except compiler.CompileError as exc:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": exc.message, "hint": exc.hint, "error_line": exc.error_line},
        )


@app.post("/api/export/pdf")
async def export_pdf_endpoint(req: RenderRequest) -> Response:
    loop = asyncio.get_running_loop()
    try:
        pdf_bytes = await loop.run_in_executor(
            _EXECUTOR,
            lambda: compiler.export_pdf(
                req.code,
                atom_sep=req.atom_sep,
                bond_offset=req.bond_offset,
                double_bond_sep=req.double_bond_sep,
                font_size=req.font_size,
                custom_preamble=req.custom_preamble,
            ),
        )
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="chem-formula.pdf"'},
        )
    except compiler.CompileError as exc:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": exc.message, "hint": exc.hint, "error_line": exc.error_line},
        )


@app.post("/api/export/tex")
async def export_tex_endpoint(req: RenderRequest) -> Response:
    try:
        tex_source, _ = compiler.build_tex_document(
            req.code,
            atom_sep=req.atom_sep,
            bond_offset=req.bond_offset,
            double_bond_sep=req.double_bond_sep,
            font_size=req.font_size,
            custom_preamble=req.custom_preamble,
        )
        return Response(
            content=tex_source.encode("utf-8"),
            media_type="application/x-tex; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="chem-formula.tex"'},
        )
    except compiler.CompileError as exc:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": exc.message, "hint": exc.hint, "error_line": exc.error_line},
        )


@app.post("/api/image-to-latex")
async def image_to_latex(
    file: UploadFile = File(...),
    target: str = Form("chemfig"),
    preprocess: str = Form("auto"),
    thicken: int = Form(1),
    rotate: float = Form(0.0),
    show_carbon: bool = Form(False),
    show_methyl: bool = Form(False),
    snap_angles: bool = Form(True),
    circle_aromatic: bool = Form(False),
) -> JSONResponse:
    raw_bytes = await file.read()
    if not raw_bytes:
        return JSONResponse(status_code=400, content={"ok": False, "error": "上传的文件为空。"})
    if len(raw_bytes) > 20 * 1024 * 1024:
        return JSONResponse(status_code=400, content={"ok": False, "error": "文件不能超过 20 MB。"})

    fmt = "tikz" if target == "tikz" else "chemfig"
    loop = asyncio.get_running_loop()
    try:
        payload = await loop.run_in_executor(
            _EXECUTOR,
            lambda: _recognize_upload(
                raw_bytes,
                file.filename or "upload.png",
                target=fmt,
                preprocess=preprocess,
                thicken=thicken,
                rotate=rotate,
                show_carbon=show_carbon,
                show_methyl=show_methyl,
                snap_angles=snap_angles,
                circle_aromatic=circle_aromatic,
            ),
        )
        return JSONResponse(payload)
    except Exception as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})


@app.post("/api/ocr-reformat")
async def ocr_reformat(req: OcrReformatRequest) -> JSONResponse:
    molblock = _get_cached_ocr_molblock(req.ocr_id)
    if molblock is None:
        return JSONResponse(
            status_code=404,
            content={"ok": False, "error": "识图缓存已过期，请重新上传图片。"},
        )
    fmt = "tikz" if req.target == "tikz" else "chemfig"
    try:
        code = _format_molblock(
            molblock,
            target=fmt,
            rotate=req.rotate,
            show_carbon=req.show_carbon,
            show_methyl=req.show_methyl,
            snap_angles=req.snap_angles,
            circle_aromatic=req.circle_aromatic,
        )
        return JSONResponse({"ok": True, "code": code, "target": fmt})
    except Exception as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})


@app.post("/api/sketch-to-chemfig")
async def sketch_to_chemfig_endpoint(req: SketchRequest) -> JSONResponse:
    try:
        code = chemfig_gen.sketch_to_chemfig(
            req.atoms,
            req.bonds,
            req.rings,
            rotate=req.rotate,
            snap_angles=req.snap_angles,
            show_carbon=req.show_carbon,
            pretty=req.pretty,
            uniform_bonds=req.uniform_bonds,
        )
        return JSONResponse({"ok": True, "code": code})
    except Exception as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})


@app.post("/api/chemfig-to-sketch")
async def chemfig_to_sketch_endpoint(req: ChemfigParseRequest) -> JSONResponse:
    try:
        graph = chemfig_gen.chemfig_to_sketch(req.code)
        return JSONResponse({"ok": True, **graph})
    except Exception as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})


def _pick_free_port(host: str, preferred: int, span: int = 20) -> int:
    """Return preferred port if bindable, otherwise scan nearby ports."""
    for port in range(preferred, preferred + span):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((host, port))
                return port
            except OSError:
                continue
    return preferred


def main() -> None:
    parser = argparse.ArgumentParser(description="ChemLaTeX Live Web Server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open browser after startup")
    args = parser.parse_args()

    port = _pick_free_port(args.host, args.port)
    if port != args.port:
        print(f"端口 {args.port} 已被占用，自动切换至可用端口 {port}。")

    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    if args.open:
        url = f"http://{args.host}:{port}/"
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    uvicorn.run(app, host=args.host, port=port, log_level="info")


if __name__ == "__main__":
    main()
