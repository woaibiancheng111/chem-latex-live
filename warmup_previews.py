"""Batch pre-render all formula templates and molecule structures to SVG and warm Tectonic cache."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chem_latex_live import catalog, compiler

OUTPUT_PATH = Path(__file__).resolve().parent / "static" / "template_previews.json"


def _compile_group(
    group_name: str,
    items: list[tuple[str, str]],
    *,
    has_cjk: bool,
    reruns: int,
) -> tuple[dict[str, str], list[tuple[str, str]]]:
    if not items:
        return {}, []

    print(f"[{group_name}] 批量编译 {len(items)} 项 (has_cjk={has_cjk}, reruns={reruns})...")
    t0 = time.perf_counter()
    try:
        svgs = compiler.batch_compile_pages(items, has_cjk=has_cjk, reruns=reruns)
        dt = time.perf_counter() - t0
        print(f"[{group_name}] 全部成功，耗时 {dt:.2f}s")
        return svgs, []
    except Exception as batch_err:
        print(f"[{group_name}] 批量失败，回退逐条定位：{batch_err}")
        svgs: dict[str, str] = {}
        failures: list[tuple[str, str]] = []
        for item_id, code in items:
            try:
                res = compiler.render_svg(code)
                svgs[item_id] = res.svg
            except Exception as item_err:
                failures.append((item_id, str(item_err)))
                print(f"  [FAIL] {item_id}: {item_err}")
        return svgs, failures


def main() -> int:
    all_entries = list(catalog.FORMULA_TEMPLATES) + list(catalog.MOLECULE_LIBRARY)

    regular_items: list[tuple[str, str]] = []
    cjk_items: list[tuple[str, str]] = []
    chemmove_ascii_items: list[tuple[str, str]] = []
    chemmove_cjk_items: list[tuple[str, str]] = []

    for entry in all_entries:
        item_id = entry["id"]
        code = entry["code"]
        feat = compiler.detect_features(code)
        if feat["uses_chemmove"]:
            if feat["has_cjk"]:
                chemmove_cjk_items.append((item_id, code))
            else:
                chemmove_ascii_items.append((item_id, code))
        elif feat["has_cjk"]:
            cjk_items.append((item_id, code))
        else:
            regular_items.append((item_id, code))

    previews: dict[str, str] = {}
    all_failures: list[tuple[str, str]] = []

    for name, grp, use_cjk, reruns in [
        ("regular", regular_items, False, 0),
        ("cjk", cjk_items, True, 0),
        ("chemmove_ascii", chemmove_ascii_items, False, 1),
        ("chemmove_cjk", chemmove_cjk_items, True, 1),
    ]:
        svgs, failures = _compile_group(name, grp, has_cjk=use_cjk, reruns=reruns)
        previews.update(svgs)
        all_failures.extend(failures)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(previews, ensure_ascii=False),
        encoding="utf-8",
    )

    size_kb = OUTPUT_PATH.stat().st_size / 1024.0
    print(
        f"\n完成：总条目 {len(all_entries)}，成功 {len(previews)}，失败 {len(all_failures)}，"
        f"写入 {OUTPUT_PATH} ({size_kb:.1f} KB)"
    )
    return 1 if all_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
