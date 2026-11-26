"""Native chemfig code generation, angle snapping, and MolBlock/sketch conversion."""

from __future__ import annotations

import math
import re
import statistics
from typing import Any

import mol2chemfigPy3
from rdkit import Chem
from rdkit.Chem import AllChem

_SUBSCRIPT_DIGITS = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
_STEREO_BONDS = {">", "<:", "<", ">:"}
_BOND_SYMBOL_MAP = {
    "single": "-",
    "double": "=",
    "triple": "~",
    "wedge": ">",
    "dash": "<:",
    "dotted": "-",
}


def _read_brace_arg(text: str, pos: int) -> tuple[str, int] | None:
    if pos >= len(text) or text[pos] != "{":
        return None
    depth = 0
    start = pos + 1
    idx = pos
    while idx < len(text):
        ch = text[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:idx], idx + 1
        idx += 1
    return None


def _replace_macro_n_args(text: str, macro: str, nargs: int, fn: Any) -> str:
    out: list[str] = []
    i = 0
    n = len(text)
    mlen = len(macro)
    while i < n:
        if text.startswith(macro, i) and (i + mlen == n or not text[i + mlen].isalpha()):
            cur = i + mlen
            args: list[str] = []
            ok = True
            for _ in range(nargs):
                while cur < n and text[cur].isspace():
                    cur += 1
                parsed = _read_brace_arg(text, cur)
                if parsed is None:
                    ok = False
                    break
                arg_val, cur = parsed
                args.append(arg_val)
            if ok:
                out.append(fn(*args))
                i = cur
                continue
        out.append(text[i])
        i += 1
    return "".join(out)


def sanitize_mol2chemfig(raw: str) -> str:
    """Convert mol2chemfigPy3 output into pure native chemfig syntax (no mol2chemfig.sty needed)."""
    text = raw.replace("%\r\n", "").replace("%\n", "").replace("\r\n", "").replace("\n", "")
    text = text.replace(r"\mcfplus", "+").replace(r"\mcfminus", "-")
    for _ in range(5):
        prev = text
        text = _replace_macro_n_args(text, r"\mcfright", 2, lambda a, b: f"{a}{b}")
        text = _replace_macro_n_args(text, r"\mcfleft", 2, lambda a, b: f"{a}{b}")
        text = _replace_macro_n_args(text, r"\mcfabove", 2, lambda a, b: rf"\chemabove{{{a}}}{{{b}}}")
        text = _replace_macro_n_args(text, r"\mcfbelow", 2, lambda a, b: rf"\chembelow{{{a}}}{{{b}}}")
        text = _replace_macro_n_args(
            text, r"\mcfaboveright", 3, lambda a, b, c: rf"\chemabove{{{a}}}{{{b}}}{c}"
        )
        text = _replace_macro_n_args(
            text, r"\mcfbelowright", 3, lambda a, b, c: rf"\chembelow{{{a}}}{{{b}}}{c}"
        )
        text = _replace_macro_n_args(text, r"\mcfatomno", 1, lambda a: a)
        if text == prev:
            break
    text = text.replace(",,,,mcfwavy", "").replace(",mcfwavy", "").replace("mcfwavy", "")
    return text.strip()


def _normalize_angle(deg: float) -> float:
    val = ((deg + 180.0) % 360.0) - 180.0
    if abs(val + 180.0) < 1e-6:
        return 180.0
    if abs(val) < 1e-6:
        return 0.0
    return val


def _format_angle(deg: float) -> str:
    """Keep fractional angles in generated chemfig while avoiding float noise."""
    value = round(_normalize_angle(float(deg)), 2)
    if abs(value) < 0.005:
        value = 0.0
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _snap_angle(deg: float, step: float = 15.0, tol: float = 4.5) -> int:
    norm = _normalize_angle(deg)
    nearest = round(norm / step) * step
    if abs(norm - nearest) <= tol:
        snapped = _normalize_angle(nearest)
        return int(round(snapped))
    return int(round(norm))


def snap_chemfig_angles(code: str, step: float = 15.0, tol: float = 4.5) -> str:
    """Normalize and snap [:angle] specs inside chemfig code to clean multiples of 15 deg."""

    def _repl(match: re.Match[str]) -> str:
        raw_num = match.group(1)
        try:
            val = float(raw_num)
        except ValueError:
            return match.group(0)
        snapped = _snap_angle(val, step=step, tol=tol)
        return f"[:{snapped}"

    return re.sub(r"\[:([+-]?\d+(?:\.\d+)?)", _repl, code)


def _format_length(ratio: float, *, uniform_bonds: bool = True) -> str:
    lo, hi = (0.55, 1.55) if uniform_bonds else (0.82, 1.18)
    if lo <= ratio <= hi:
        return ""
    text = f"{ratio:.2f}".rstrip("0").rstrip(".")
    return text if text and text != "1" else ""


def _format_atom_label(label: str, charge: str, *, show_carbon: bool) -> str:
    text = (label or "").strip().translate(_SUBSCRIPT_DIGITS)
    if not text:
        text = "C" if (show_carbon or charge) else ""
    else:
        if "′" in text:
            text = text.replace("′", r"^{\prime}")
        # Convert plain numbers after letters (e.g., CH3 -> CH_3) if not already TeX-formatted
        if "_" not in text and "\\" not in text and "^" not in text:
            text = re.sub(r"(?<=[A-Za-z\)])(\d+)", r"_{\1}", text)
            text = re.sub(r"_\{(\d)\}", r"_\1", text)

    chg = (charge or "").strip()
    if chg:
        chg_map = {
            "+": "+",
            "-": "-",
            "2+": "2+",
            "2-": "2-",
            "⊕": r"\oplus",
            "⊖": r"\ominus",
            "·": r"\bullet",
            "•": r"\bullet",
        }
        tex_chg = chg_map.get(chg, chg)
        text = f"{text}^{{{tex_chg}}}"
    return text


def _format_bond_token(
    bond_type: str,
    angle_deg: int | float,
    len_ratio: float,
    *,
    is_dotted: bool = False,
    uniform_bonds: bool = True,
) -> str:
    sym = _BOND_SYMBOL_MAP.get(bond_type, "-")
    angle = _format_angle(angle_deg)
    len_str = _format_length(len_ratio, uniform_bonds=uniform_bonds)
    if is_dotted or bond_type == "dotted":
        lpart = len_str or "1"
        return f"-[:{angle},{lpart},,,dotted]"
    if len_str:
        return f"{sym}[:{angle},{len_str}]"
    return f"{sym}[:{angle}]"


def _ring_closure_hook(tag: str, btype: str) -> str:
    if btype == "single":
        return f"?[{tag}]"
    if btype == "dotted":
        return f"?[{tag},{{-}},dotted]"
    sym = _BOND_SYMBOL_MAP.get(btype, "-")
    return f"?[{tag},{{{sym}}}]"


def _compute_base_length(
    pos_map: dict[str, tuple[float, float]],
    bonds: list[dict[str, Any]],
) -> float:
    lengths: list[float] = []
    for b in bonds:
        a1 = pos_map.get(str(b["a"]))
        a2 = pos_map.get(str(b["b"]))
        if a1 and a2:
            d = math.hypot(a2[0] - a1[0], a2[1] - a1[1])
            if d > 1e-4:
                lengths.append(d)
    if not lengths:
        return 56.0
    return statistics.median(lengths)


def _order_cycle_ccw(
    atom_ids: list[str],
    adj: dict[str, list[tuple[str, dict[str, Any]]]],
    pos_map: dict[str, tuple[float, float]],
) -> list[str] | None:
    """Order 3..7 ring vertices sequentially around the cycle, counter-clockwise in math coords."""
    ring_set = set(atom_ids)
    n = len(ring_set)
    if n < 3 or n > 7 or n != len(atom_ids):
        return None
    ring_adj: dict[str, list[str]] = {aid: [] for aid in ring_set}
    for aid in ring_set:
        for nbr, _ in adj.get(aid, []):
            if nbr in ring_set:
                ring_adj[aid].append(nbr)
    if any(len(nbrs) != 2 for nbrs in ring_adj.values()):
        return None

    ordered = [atom_ids[0]]
    prev: str | None = None
    cur = atom_ids[0]
    for _ in range(n - 1):
        nxt_choices = [nb for nb in ring_adj[cur] if nb != prev]
        if not nxt_choices:
            return None
        nxt = nxt_choices[0]
        ordered.append(nxt)
        prev, cur = cur, nxt
    if len(set(ordered)) != n or ordered[0] not in ring_adj[ordered[-1]]:
        return None

    # Signed area in math coords (>0 means counter-clockwise)
    area2 = 0.0
    for i in range(n):
        x1, y1 = pos_map[ordered[i]]
        x2, y2 = pos_map[ordered[(i + 1) % n]]
        area2 += x1 * y2 - x2 * y1
    if area2 < 0:
        ordered = [ordered[0]] + list(reversed(ordered[1:]))
    return ordered


def _is_regular_cycle(
    ordered: list[str],
    pos_map: dict[str, tuple[float, float]],
) -> bool:
    """Check whether ordered polygon vertices form a reasonably regular n-gon."""
    n = len(ordered)
    if n < 3 or n > 7:
        return False
    lens: list[float] = []
    angs: list[float] = []
    for i in range(n):
        x1, y1 = pos_map[ordered[i]]
        x2, y2 = pos_map[ordered[(i + 1) % n]]
        d = math.hypot(x2 - x1, y2 - y1)
        if d <= 1e-4:
            return False
        lens.append(d)
        angs.append(math.degrees(math.atan2(y2 - y1, x2 - x1)))
    if max(lens) / min(lens) > 1.28:
        return False
    expected_turn = 360.0 / n
    for i in range(n):
        turn = (angs[(i + 1) % n] - angs[i]) % 360.0
        if abs(turn - expected_turn) > 18.0:
            return False
    return True


def _find_simple_isolated_cycles(
    comp: list[str],
    adj: dict[str, list[tuple[str, dict[str, Any]]]],
    pos_map: dict[str, tuple[float, float]],
) -> list[list[str]]:
    """Find chordless simple cycles of length 3..7 within one connected component."""
    comp_set = set(comp)
    seen_sets: set[frozenset[str]] = set()
    found: list[list[str]] = []

    def dfs(start: str, cur: str, path: list[str], path_set: set[str]) -> None:
        for nbr, _ in adj[cur]:
            if nbr not in comp_set:
                continue
            if nbr == start and len(path) >= 3:
                key = frozenset(path)
                if key not in seen_sets:
                    seen_sets.add(key)
                    ordered = _order_cycle_ccw(path, adj, pos_map)
                    if ordered is not None:
                        found.append(ordered)
                continue
            if nbr in path_set or len(path) >= 7:
                continue
            if nbr < start:
                continue
            path.append(nbr)
            path_set.add(nbr)
            dfs(start, nbr, path, path_set)
            path_set.remove(nbr)
            path.pop()

    for aid in sorted(comp):
        dfs(aid, aid, [aid], {aid})
    return found


def _connected_components(
    atom_ids: list[str],
    adj: dict[str, list[tuple[str, dict[str, Any]]]],
) -> list[list[str]]:
    seen: set[str] = set()
    comps: list[list[str]] = []
    for aid in atom_ids:
        if aid in seen:
            continue
        stack = [aid]
        comp: list[str] = []
        seen.add(aid)
        while stack:
            u = stack.pop()
            comp.append(u)
            for v, _ in adj[u]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        comps.append(comp)
    return comps


def _wrap_chemfig_pretty(inner: str) -> str:
    """Wrap chemfig content across lines with % at branch boundaries for readability."""
    if len(inner) < 58:
        return rf"\chemfig{{{inner}}}"
    lines: list[str] = []
    cur: list[str] = []
    depth = 0
    for ch in inner:
        cur.append(ch)
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if depth == 0 and ch in "-=~>" and len(cur) > 36:
            lines.append("  " + "".join(cur) + "%")
            cur = []
    if cur:
        lines.append("  " + "".join(cur))
    if len(lines) <= 1:
        return rf"\chemfig{{{inner}}}"
    return "\\chemfig{%\n" + "\n".join(lines) + "\n}"


def sketch_to_chemfig(
    atoms: list[dict[str, Any]],
    bonds: list[dict[str, Any]],
    rings: list[dict[str, Any]] | None = None,
    *,
    rotate: float = 0.0,
    snap_angles: bool = True,
    show_carbon: bool = False,
    pretty: bool = False,
    uniform_bonds: bool = True,
) -> str:
    """Convert a 2D molecular sketch graph into pure native chemfig LaTeX code."""
    if not atoms:
        raise ValueError("画板为空，请先绘制化学结构。")

    atom_map: dict[str, dict[str, Any]] = {}
    pos_map: dict[str, tuple[float, float]] = {}
    for a in atoms:
        aid = str(a["id"])
        atom_map[aid] = a
        # Convert screen coordinates (+y down) to math coordinates (+y up)
        pos_map[aid] = (float(a["x"]), -float(a["y"]))

    if rotate:
        cx = sum(p[0] for p in pos_map.values()) / len(pos_map)
        cy = sum(p[1] for p in pos_map.values()) / len(pos_map)
        rad = math.radians(float(rotate))
        cos_a, sin_a = math.cos(rad), math.sin(rad)
        pos_map = {
            aid: (
                (x - cx) * cos_a - (y - cy) * sin_a + cx,
                (x - cx) * sin_a + (y - cy) * cos_a + cy,
            )
            for aid, (x, y) in pos_map.items()
        }

    adj: dict[str, list[tuple[str, dict[str, Any]]]] = {aid: [] for aid in atom_map}
    bond_lookup: dict[tuple[str, str], dict[str, Any]] = {}
    for b in bonds:
        u, v = str(b["a"]), str(b["b"])
        if u not in atom_map or v not in atom_map or u == v:
            continue
        adj[u].append((v, b))
        adj[v].append((u, b))
        key = (min(u, v), max(u, v))
        bond_lookup[key] = b

    base_len = _compute_base_length(pos_map, bonds)

    def edge_token(u: str, v: str, b: dict[str, Any]) -> tuple[str, str]:
        x1, y1 = pos_map[u]
        x2, y2 = pos_map[v]
        dx, dy = x2 - x1, y2 - y1
        raw_deg = math.degrees(math.atan2(dy, dx))
        ang = _snap_angle(raw_deg) if snap_angles else _normalize_angle(raw_deg)
        ratio = math.hypot(dx, dy) / base_len if base_len > 1e-4 else 1.0
        btype = str(b.get("type", "single"))
        # Preserve wedge/dash visual direction when traversing opposite to stored (a -> b)
        if u != str(b["a"]):
            if btype == "wedge":
                btype = "dash"
            elif btype == "dash":
                btype = "wedge"
        sym = _BOND_SYMBOL_MAP.get(btype, "-")
        tok = _format_bond_token(
            btype,
            ang,
            ratio,
            is_dotted=(btype == "dotted"),
            uniform_bonds=uniform_bonds,
        )
        return tok, sym

    def atom_text(aid: str) -> str:
        a = atom_map[aid]
        return _format_atom_label(
            str(a.get("label", "")),
            str(a.get("charge", "")),
            show_carbon=show_carbon,
        )

    # Identify valid isolated 6-membered circle-aromatic rings
    circle_rings: list[list[str]] = []
    if rings:
        for r in rings:
            if not r.get("aromatic_circle"):
                continue
            r_atoms = [str(x) for x in r.get("atoms", [])]
            if len(r_atoms) == 6 and all(aid in atom_map for aid in r_atoms):
                ordered = _order_cycle_ccw(r_atoms, adj, pos_map)
                if ordered is not None:
                    circle_rings.append(ordered)

    def emit_dfs(
        start_id: str,
        *,
        pre_visited: set[str] | None = None,
        forbidden_edges: set[tuple[str, str]] | None = None,
    ) -> str:
        visited: set[str] = set(pre_visited or ())
        visited.add(start_id)
        ring_tags: dict[tuple[str, str], str] = {}
        tag_counter = 0

        def next_tag() -> str:
            nonlocal tag_counter
            tag_counter += 1
            if tag_counter <= 26:
                return chr(ord("a") + tag_counter - 1)
            return f"r{tag_counter}"

        # First pass to build deterministic spanning tree & back-edges
        tree_children: dict[str, list[tuple[str, dict[str, Any]]]] = {aid: [] for aid in atom_map}
        back_edges_from: dict[str, list[tuple[str, dict[str, Any], str]]] = {aid: [] for aid in atom_map}
        closure_hooks: dict[str, list[str]] = {aid: [] for aid in atom_map}
        tree_seen = set(visited)

        def dfs_tree(u: str) -> None:
            nbrs = sorted(
                adj[u],
                key=lambda item: (
                    1 if item[1].get("type", "single") == "single" else 0,
                    _normalize_angle(
                        math.degrees(
                            math.atan2(
                                pos_map[item[0]][1] - pos_map[u][1],
                                pos_map[item[0]][0] - pos_map[u][0],
                            )
                        )
                    ),
                ),
            )
            for v, b in nbrs:
                ekey = (min(u, v), max(u, v))
                if forbidden_edges and ekey in forbidden_edges:
                    continue
                if v not in tree_seen:
                    tree_seen.add(v)
                    tree_children[u].append((v, b))
                    dfs_tree(v)
                elif ekey not in ring_tags and v != u:
                    is_tree = any(ch == v for ch, _ in tree_children[u]) or any(
                        ch == u for ch, _ in tree_children[v]
                    )
                    if not is_tree:
                        tag = next_tag()
                        ring_tags[ekey] = tag
                        back_edges_from[u].append((v, b, tag))
                        closure_hooks[v].append(tag)

        dfs_tree(start_id)

        def render_node(u: str, incoming_from_parent: bool = True) -> str:
            parts: list[str] = []
            lbl = atom_text(u)
            if lbl:
                parts.append(lbl)
            for tag in closure_hooks[u]:
                parts.append(f"?[{tag}]")

            for v, b, tag in back_edges_from[u]:
                btype = str(b.get("type", "single"))
                if u != str(b["a"]):
                    if btype == "wedge":
                        btype = "dash"
                    elif btype == "dash":
                        btype = "wedge"
                parts.append(_ring_closure_hook(tag, btype))

            children = tree_children[u]
            for idx, (v, b) in enumerate(children):
                tok, sym = edge_token(u, v, b)
                child_str = render_node(v, True)
                is_last = idx == len(children) - 1
                if not is_last:
                    parts.append(f"({tok}{child_str})")
                else:
                    if lbl == "" and incoming_from_parent and sym in _STEREO_BONDS:
                        parts.append(f"({tok}{child_str})")
                    else:
                        parts.append(f"{tok}{child_str}")

            return "".join(parts)

        return render_node(start_id, incoming_from_parent=(start_id in (pre_visited or ())))

    def _is_isolated_cycle(ring_verts: list[str]) -> bool:
        rn = len(ring_verts)
        r_set = set(ring_verts)
        edge_set = {
            (min(ring_verts[i], ring_verts[(i + 1) % rn]), max(ring_verts[i], ring_verts[(i + 1) % rn]))
            for i in range(rn)
        }
        has_internal_chord = any(
            nbr in r_set and (min(vk, nbr), max(vk, nbr)) not in edge_set
            for vk in ring_verts
            for nbr, _ in adj[vk]
        )
        if has_internal_chord:
            return False
        seen_ext: set[str] = set()
        for vk in ring_verts:
            for nbr, _ in adj[vk]:
                if nbr in r_set or nbr in seen_ext:
                    continue
                stack = [nbr]
                seen_ext.add(nbr)
                while stack:
                    cur_n = stack.pop()
                    for nn, _ in adj[cur_n]:
                        if nn in r_set and nn != vk:
                            return False
                        if nn not in r_set and nn not in seen_ext:
                            seen_ext.add(nn)
                            stack.append(nn)
        return True

    def _has_planar_ring_bonds(ring_verts: list[str]) -> bool:
        rn = len(ring_verts)
        for i in range(rn):
            ekey = (min(ring_verts[i], ring_verts[(i + 1) % rn]), max(ring_verts[i], ring_verts[(i + 1) % rn]))
            b = bond_lookup.get(ekey)
            if not b or str(b.get("type", "single")) not in ("single", "double", "triple"):
                return False
        return True

    # Build components sorted left-to-right
    comps = _connected_components(list(atom_map.keys()), adj)
    comps.sort(key=lambda c: min(pos_map[aid][0] for aid in c))

    chemfig_blocks: list[str] = []
    for comp in comps:
        comp_set = set(comp)
        comp_circle_rings = [r for r in circle_rings if set(r).issubset(comp_set)]
        chosen_ring: list[str] | None = None
        chosen_is_circle = False

        # 1) Prefer isolated explicit circle aromatic 6-rings (**6)
        for r in comp_circle_rings:
            if _is_isolated_cycle(r):
                chosen_ring = r
                chosen_is_circle = True
                break

        # 2) Otherwise prefer an isolated regular 3..7-membered ring (*n)
        if chosen_ring is None:
            candidates = [
                r
                for r in _find_simple_isolated_cycles(comp, adj, pos_map)
                if _is_isolated_cycle(r) and _has_planar_ring_bonds(r) and _is_regular_cycle(r, pos_map)
            ]
            if candidates:
                def _ring_score(r: list[str]) -> tuple[int, int]:
                    rn = len(r)
                    btypes = [
                        str(bond_lookup[(min(r[i], r[(i + 1) % rn]), max(r[i], r[(i + 1) % rn]))].get("type", "single"))
                        for i in range(rn)
                    ]
                    is_kekule6 = 1 if (rn == 6 and btypes.count("double") == 3) else 0
                    return (is_kekule6, rn)

                chosen_ring = max(candidates, key=_ring_score)

        if chosen_ring is not None:
            rn = len(chosen_ring)
            base_offset = 360.0 / rn - 90.0

            # Pick cyclic starting vertex minimizing rotation prefix angle |theta|
            best_shift = 0
            best_theta = 0.0
            best_score = (999.0, 999.0, 0.0)
            for k in range(rn):
                v_start = chosen_ring[k]
                v_next = chosen_ring[(k + 1) % rn]
                p0, p1 = pos_map[v_start], pos_map[v_next]
                raw_edge_deg = math.degrees(math.atan2(p1[1] - p0[1], p1[0] - p0[0]))
                theta_raw = _normalize_angle(raw_edge_deg - base_offset)
                theta_k = _snap_angle(theta_raw) if snap_angles else theta_raw
                score = (abs(float(theta_k)), abs(theta_raw), pos_map[v_start][0])
                if score < best_score:
                    best_score = score
                    best_shift = k
                    best_theta = theta_k

            chosen_ring = chosen_ring[best_shift:] + chosen_ring[:best_shift]
            theta = best_theta
            ring_set = set(chosen_ring)
            ring_edges = {
                (min(chosen_ring[i], chosen_ring[(i + 1) % rn]), max(chosen_ring[i], chosen_ring[(i + 1) % rn]))
                for i in range(rn)
            }

            ring_len_ratios = [
                math.hypot(
                    pos_map[chosen_ring[(i + 1) % rn]][0] - pos_map[chosen_ring[i]][0],
                    pos_map[chosen_ring[(i + 1) % rn]][1] - pos_map[chosen_ring[i]][1],
                )
                / base_len
                for i in range(rn)
            ]
            avg_ratio = sum(ring_len_ratios) / rn if ring_len_ratios else 1.0
            len_str = _format_length(avg_ratio, uniform_bonds=uniform_bonds)

            pre_visited = set(ring_set)
            vertex_chunks: list[str] = []
            for vk in chosen_ring:
                v_str = atom_text(vk)
                # External branches from vk (not in ring_edges)
                ext_nbrs = [
                    (nbr, b)
                    for nbr, b in adj[vk]
                    if (min(vk, nbr), max(vk, nbr)) not in ring_edges and nbr not in ring_set
                ]
                ext_nbrs.sort(
                    key=lambda item: _normalize_angle(
                        math.degrees(
                            math.atan2(
                                pos_map[item[0]][1] - pos_map[vk][1],
                                pos_map[item[0]][0] - pos_map[vk][0],
                            )
                        )
                    )
                )
                for nbr, b in ext_nbrs:
                    if nbr in pre_visited:
                        continue
                    tok, _ = edge_token(vk, nbr, b)
                    stem_edge = (min(vk, nbr), max(vk, nbr))
                    branch_body = emit_dfs(
                        nbr,
                        pre_visited=pre_visited,
                        forbidden_edges=ring_edges | {stem_edge},
                    )
                    # Mark visited nodes from branch
                    stack = [nbr]
                    pre_visited.add(nbr)
                    while stack:
                        cur_n = stack.pop()
                        for nn, _ in adj[cur_n]:
                            if nn not in pre_visited and (min(cur_n, nn), max(cur_n, nn)) not in ring_edges:
                                pre_visited.add(nn)
                                stack.append(nn)
                    v_str += f"({tok}{branch_body})"
                vertex_chunks.append(v_str)

            # Emit ALL n perimeter bonds: v0 b0 v1 b1 ... v_{n-1} b_{n-1}
            bond_syms: list[str] = []
            for i in range(rn):
                if chosen_is_circle:
                    bond_syms.append("-")
                else:
                    ekey = (min(chosen_ring[i], chosen_ring[(i + 1) % rn]), max(chosen_ring[i], chosen_ring[(i + 1) % rn]))
                    btype = str(bond_lookup[ekey].get("type", "single"))
                    bond_syms.append(_BOND_SYMBOL_MAP.get(btype, "-"))

            ring_body = "".join(f"{vertex_chunks[i]}{bond_syms[i]}" for i in range(rn))
            ring_prefix = "**6" if chosen_is_circle else f"*{rn}"
            theta_text = _format_angle(theta)
            prefix_opt = f"[:{theta_text},{len_str}]" if len_str else (f"[:{theta_text}]" if theta != 0 else "")
            inner = f"{prefix_opt}{ring_prefix}({ring_body})"
        else:
            # Start from leftmost degree-1 atom if available, otherwise leftmost atom
            endpoints = [aid for aid in comp if len(adj[aid]) <= 1]
            start_candidates = endpoints if endpoints else comp
            start_id = min(start_candidates, key=lambda aid: (pos_map[aid][0], -pos_map[aid][1]))
            inner = emit_dfs(start_id)

        chemfig_blocks.append(_wrap_chemfig_pretty(inner) if pretty else rf"\chemfig{{{inner}}}")

    return r"\qquad ".join(chemfig_blocks)


def _rdkit_mol_to_graph(mol: Chem.Mol) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Extract atoms, bonds, and isolated 6-membered aromatic rings from an RDKit Mol."""
    if mol.GetNumConformers() == 0:
        AllChem.Compute2DCoords(mol)
    conf = mol.GetConformer()

    atoms_out: list[dict[str, Any]] = []
    for atom in mol.GetAtoms():
        idx = atom.GetIdx()
        pos = conf.GetAtomPosition(idx)
        sym = atom.GetSymbol()
        iso = atom.GetIsotope()
        chg = atom.GetFormalCharge()
        hs = atom.GetTotalNumHs()

        if sym == "C" and iso == 0 and chg == 0:
            label = ""
        else:
            label = sym
            if iso:
                label = f"^{{{iso}}}{label}"
            if hs and sym not in {"H", "C"}:
                label += f"H_{hs}" if hs == 1 else f"H_{{{hs}}}"
                if hs == 1:
                    label = f"{sym}H"

        chg_str = ""
        if chg > 0:
            chg_str = "+" if chg == 1 else f"{chg}+"
        elif chg < 0:
            chg_str = "-" if chg == -1 else f"{abs(chg)}-"

        atoms_out.append(
            {
                "id": str(idx),
                "x": float(pos.x) * 40.0,
                "y": -float(pos.y) * 40.0,
                "label": label,
                "charge": chg_str,
            }
        )

    bonds_out: list[dict[str, Any]] = []
    for bond in mol.GetBonds():
        btype = bond.GetBondType()
        bdir = bond.GetBondDir()
        if bdir == Chem.BondDir.BEGINWEDGE:
            t_str = "wedge"
        elif bdir == Chem.BondDir.BEGINDASH:
            t_str = "dash"
        elif btype == Chem.BondType.DOUBLE:
            t_str = "double"
        elif btype == Chem.BondType.TRIPLE:
            t_str = "triple"
        else:
            t_str = "single"
        bonds_out.append(
            {
                "a": str(bond.GetBeginAtomIdx()),
                "b": str(bond.GetEndAtomIdx()),
                "type": t_str,
            }
        )

    rings_out: list[dict[str, Any]] = []
    ring_info = mol.GetRingInfo()
    atom_rings = ring_info.AtomRings()
    bond_rings = ring_info.BondRings()
    aromatic_bond_counts: dict[int, int] = {}
    for br in bond_rings:
        for bi in br:
            aromatic_bond_counts[bi] = aromatic_bond_counts.get(bi, 0) + 1

    for ar, br in zip(atom_rings, bond_rings):
        if len(ar) == 6 and all(mol.GetAtomWithIdx(ai).GetIsAromatic() for ai in ar):
            # Only convert isolated benzene-type rings to **6 so fused rings stay Kekule
            if all(aromatic_bond_counts.get(bi, 0) == 1 for bi in br):
                rings_out.append({"atoms": [str(ai) for ai in ar], "aromatic_circle": True})

    return atoms_out, bonds_out, rings_out


def molblock_to_chemfig_clean(
    molblock: str,
    *,
    rotate: float = 0.0,
    show_carbon: bool = False,
    show_methyl: bool = False,
    snap_angles: bool = True,
    circle_aromatic: bool = False,
) -> str:
    """Convert an RDKit/MolVec MolBlock to native chemfig (never emitting mol2chemfig.sty macros)."""
    mol = Chem.MolFromMolBlock(molblock, sanitize=True, removeHs=False)
    if mol is None:
        mol = Chem.MolFromMolBlock(molblock, sanitize=False, removeHs=False)
    if mol is None or mol.GetNumAtoms() == 0:
        raise ValueError("图片未识别出有效的化学分子结构。")

    if circle_aromatic:
        atoms_g, bonds_g, rings_g = _rdkit_mol_to_graph(mol)
        if rings_g:
            return sketch_to_chemfig(
                atoms_g,
                bonds_g,
                rings_g,
                rotate=rotate,
                snap_angles=snap_angles,
                show_carbon=show_carbon,
                pretty=False,
            )

    try:
        Chem.Kekulize(mol, clearAromaticFlags=True)
    except Exception:
        pass
    if mol.GetNumConformers() == 0:
        AllChem.Compute2DCoords(mol)
    clean_block = Chem.MolToMolBlock(mol)
    raw = mol2chemfigPy3.mol2chemfig(
        clean_block,
        aromatic=False,
        rotate=float(rotate),
        show_carbon=bool(show_carbon),
        show_methyl=bool(show_methyl),
        inline=True,
    )
    if not raw:
        raise ValueError("mol2chemfig 未生成有效代码。")
    code = sanitize_mol2chemfig(raw)
    if snap_angles:
        code = snap_chemfig_angles(code)
    return code


# ---------------------------------------------------------------------------
# Reverse Parser: native chemfig -> 2D Sketch Graph ({atoms, bonds, rings})
# ---------------------------------------------------------------------------

_REVERSE_BOND_SYMS = (">:", "<:", "=^", "=_", "-", "=", "~", ">", "<")


def _extract_chemfig_bodies(code: str) -> list[str]:
    """Extract inner bodies of all \\chemfig[...]{...} calls; fallback to raw text if none."""
    text = re.sub(r"(?<!\\)%[^\n]*", "", code or "")
    bodies: list[str] = []
    idx = 0
    n = len(text)
    while idx < n:
        m = re.search(r"\\chemfig\b", text[idx:])
        if not m:
            break
        pos = idx + m.end()
        while pos < n and text[pos].isspace():
            pos += 1
        # Optional [style][style] args before {body}
        for _ in range(2):
            if pos < n and text[pos] == "[":
                depth = 1
                pos += 1
                while pos < n and depth > 0:
                    if text[pos] == "[":
                        depth += 1
                    elif text[pos] == "]":
                        depth -= 1
                    pos += 1
                while pos < n and text[pos].isspace():
                    pos += 1
        if pos < n and text[pos] == "{":
            depth = 1
            start = pos + 1
            pos += 1
            while pos < n and depth > 0:
                if text[pos] == "{" and (pos == 0 or text[pos - 1] != "\\"):
                    depth += 1
                elif text[pos] == "}" and (pos == 0 or text[pos - 1] != "\\"):
                    depth -= 1
                pos += 1
            bodies.append(text[start : pos - 1])
            idx = pos
        else:
            idx = pos
    if bodies:
        return bodies
    stripped = text.strip()
    if stripped and not stripped.startswith("\\begin") and not stripped.startswith("\\ce"):
        return [stripped]
    return []


def _clean_parsed_atom_label(raw: str) -> tuple[str, str]:
    """Convert chemfig atom text (e.g. CH_3, O^{\\ominus}, @{a}C) into (label, charge)."""
    s = raw.strip()
    if not s:
        return "", ""
    # Strip chemfig anchor markers @{name}
    s = re.sub(r"@\{[^}]*\}", "", s)
    # Unwrap \charge{...}{atom}
    s = re.sub(r"\\charge\{[^}]*\}\{([^}]*)\}", r"\1", s)
    # Unwrap \lewis{...}{atom}
    s = re.sub(r"\\lewis\{[^}]*\}\{([^}]*)\}", r"\1", s)
    # Unwrap \text{...} / \mathrm{...}
    s = re.sub(r"\\(?:text|mathrm|textbf)\{([^}]*)\}", r"\1", s)
    s = s.replace(r"^{\prime}", "′").replace(r"\prime", "′")
    s = s.strip()

    charge = ""
    # Extract trailing superscript charge
    chg_patterns = [
        (r"\^\{\\oplus\}$", "⊕"),
        (r"\^\{\\ominus\}$", "⊖"),
        (r"\^\{\\bullet\}$", "·"),
        (r"\^\{([0-9]*[+-])\}$", None),
        (r"\^([+-])$", None),
    ]
    for pat, fixed in chg_patterns:
        m = re.search(pat, s)
        if m:
            charge = fixed if fixed is not None else m.group(1)
            s = s[: m.start()].strip()
            break

    # Normalize subscripts: CH_{3} / CH_3 -> CH3
    s = re.sub(r"_\{([0-9]+)\}", r"\1", s)
    s = re.sub(r"_([0-9])", r"\1", s)
    # Strip redundant outer braces
    while len(s) >= 2 and s[0] == "{" and s[-1] == "}":
        s = s[1:-1].strip()
    # Replace TeX whitespace commands
    s = s.replace("~", "").replace(r"\,", "").strip()
    return s, charge


def _parse_bond_bracket(spec: str, default_angle: float) -> tuple[float, float, str | None]:
    """Parse chemfig bond [...] spec -> (angle_deg, len_factor, special_kind)."""
    parts = [p.strip() for p in spec.split(",")]
    ang_str = parts[0] if len(parts) > 0 else ""
    len_str = parts[1] if len(parts) > 1 else ""
    tikz_str = ",".join(parts[4:]) if len(parts) > 4 else ""

    angle = default_angle
    if ang_str:
        try:
            if ang_str.startswith("::"):
                angle = default_angle + float(ang_str[2:])
            elif ang_str.startswith(":"):
                angle = float(ang_str[1:])
            else:
                angle = float(ang_str) * 45.0
        except ValueError:
            angle = default_angle

    length = 1.0
    if len_str:
        try:
            val = float(len_str)
            if 0.15 <= val <= 5.0:
                length = val
        except ValueError:
            pass

    special: str | None = None
    if "draw=none" in tikz_str or "opacity=0" in tikz_str:
        special = "none"
    elif "dotted" in tikz_str or "dashed" in tikz_str:
        special = "dotted"
    return angle, length, special


def _map_chemfig_bond_sym(sym: str) -> tuple[str, bool]:
    """Map chemfig bond symbol -> (sketch_bond_type, reverse_endpoints)."""
    if sym in ("=", "=^", "=_"):
        return "double", False
    if sym == "~":
        return "triple", False
    if sym == ">":
        return "wedge", False
    if sym == "<":
        return "wedge", True
    if sym == "<:":
        return "dash", False
    if sym == ">:":
        return "dash", True
    return "single", False


def chemfig_to_sketch(
    code: str,
    *,
    bond_len: float = 54.0,
    center_x: float = 300.0,
    center_y: float = 200.0,
) -> dict[str, Any]:
    """Parse native chemfig LaTeX into a 2D sketcher graph {atoms, bonds, rings}."""
    bodies = _extract_chemfig_bodies(code)
    if not bodies:
        raise ValueError("未检测到可解析的 \\chemfig{} 分子结构代码。")

    atoms: list[dict[str, Any]] = []
    bonds: list[dict[str, Any]] = []
    rings: list[dict[str, Any]] = []
    id_seq = 0

    def next_id(prefix: str) -> str:
        nonlocal id_seq
        id_seq += 1
        return f"{prefix}{id_seq}"

    def find_near(x: float, y: float, tol: float = 8.0) -> dict[str, Any] | None:
        best: dict[str, Any] | None = None
        best_d = tol
        for a in atoms:
            d = math.hypot(a["x"] - x, a["y"] - y)
            if d <= best_d:
                best_d = d
                best = a
        return best

    def get_or_create_atom(x: float, y: float, label: str = "", charge: str = "", merge: bool = True) -> dict[str, Any]:
        if merge:
            existing = find_near(x, y, 8.0)
            if existing is not None:
                if label and not existing["label"]:
                    existing["label"] = label
                if charge and not existing["charge"]:
                    existing["charge"] = charge
                return existing
        a = {"id": next_id("a"), "x": float(x), "y": float(y), "label": label, "charge": charge}
        atoms.append(a)
        return a

    def add_bond(a_id: str, b_id: str, btype: str) -> None:
        if a_id == b_id:
            return
        for ex in bonds:
            if (ex["a"] == a_id and ex["b"] == b_id) or (ex["a"] == b_id and ex["b"] == a_id):
                if ex["type"] == "single" and btype != "single":
                    ex["type"] = btype
                return
        bonds.append({"id": next_id("b"), "a": a_id, "b": b_id, "type": btype})

    def read_balanced(s: str, pos: int, open_ch: str, close_ch: str) -> tuple[str, int]:
        depth = 1
        start = pos + 1
        pos += 1
        n = len(s)
        while pos < n and depth > 0:
            ch = s[pos]
            if ch == open_ch and (pos == 0 or s[pos - 1] != "\\"):
                depth += 1
            elif ch == close_ch and (pos == 0 or s[pos - 1] != "\\"):
                depth -= 1
            pos += 1
        return s[start : pos - 1], pos

    def match_bond_sym(s: str, pos: int) -> str | None:
        for sym in _REVERSE_BOND_SYMS:
            if s.startswith(sym, pos):
                return sym
        return None

    def parse_body(body: str, origin_x: float, origin_y: float) -> None:
        s = re.sub(r"\s+", " ", body).strip()
        hooks: dict[str, list[tuple[str, str]]] = {}

        def record_hook(atom_id: str, spec: str) -> None:
            parts = [p.strip() for p in spec.split(",")]
            tag = parts[0] if parts else "a"
            btype = "single"
            if len(parts) >= 3 and "dotted" in parts[2]:
                btype = "dotted"
            elif len(parts) >= 2:
                raw_b = parts[1].strip("{}")
                if raw_b:
                    btype, _ = _map_chemfig_bond_sym(raw_b)
            prev_list = hooks.setdefault(tag, [])
            if prev_list:
                prev_atom, prev_bt = prev_list[0]
                use_bt = btype if btype != "single" else prev_bt
                add_bond(prev_atom, atom_id, use_bt)
            prev_list.append((atom_id, btype))

        def parse_seq(
            seq: str,
            start_atom: dict[str, Any] | None,
            init_angle: float,
            prev_atom_for_fuse: dict[str, Any] | None = None,
        ) -> dict[str, Any] | None:
            pos = 0
            n = len(seq)
            cur_atom = start_atom
            prev_atom = prev_atom_for_fuse
            cur_angle = init_angle
            pending_opt: tuple[float, float] | None = None

            def ensure_cur() -> dict[str, Any]:
                nonlocal cur_atom
                if cur_atom is None:
                    cur_atom = get_or_create_atom(origin_x, origin_y, "", "", merge=False)
                return cur_atom

            while pos < n:
                ch = seq[pos]
                if ch.isspace():
                    pos += 1
                    continue

                # Leading optional [angle,len] before *n(...) or sequence
                if ch == "[":
                    spec, pos = read_balanced(seq, pos, "[", "]")
                    ang, lfac, _ = _parse_bond_bracket(spec, cur_angle)
                    cur_angle = ang
                    pending_opt = (ang, lfac)
                    continue

                # Ring closure hook ?[tag,...] or bare ?
                if ch == "?":
                    atom = ensure_cur()
                    pos += 1
                    if pos < n and seq[pos] == "[":
                        spec, pos = read_balanced(seq, pos, "[", "]")
                        record_hook(atom["id"], spec)
                    else:
                        record_hook(atom["id"], "_default")
                    continue

                # Branch (...)
                if ch == "(":
                    branch_str, pos = read_balanced(seq, pos, "(", ")")
                    atom = ensure_cur()
                    parse_seq(branch_str, atom, cur_angle, prev_atom)
                    continue

                # Native polygon ring **n(...) or *n(...)
                if ch == "*":
                    is_circle = seq.startswith("**", pos)
                    pos += 2 if is_circle else 1
                    if pos < n and seq[pos].isdigit():
                        rn = int(seq[pos])
                        pos += 1
                        while pos < n and seq[pos].isspace():
                            pos += 1
                        if pos < n and seq[pos] == "(":
                            ring_body, pos = read_balanced(seq, pos, "(", ")")
                            ring_theta, ring_lfac = pending_opt if pending_opt else (cur_angle, 1.0)
                            pending_opt = None
                            edge_len = bond_len * ring_lfac
                            cur_atom = parse_ring(
                                rn,
                                is_circle,
                                ring_body,
                                cur_atom,
                                prev_atom,
                                ring_theta,
                                edge_len,
                            )
                            continue

                # Bond symbol
                bsym = match_bond_sym(seq, pos)
                if bsym is not None:
                    pos += len(bsym)
                    spec = ""
                    if pos < n and seq[pos] == "[":
                        spec, pos = read_balanced(seq, pos, "[", "]")
                    ang, lfac, special = _parse_bond_bracket(spec, cur_angle)
                    btype, rev = _map_chemfig_bond_sym(bsym)
                    if special == "dotted":
                        btype = "dotted"
                    src = ensure_cur()
                    rad = math.radians(ang)
                    nx = src["x"] + bond_len * lfac * math.cos(rad)
                    ny = src["y"] - bond_len * lfac * math.sin(rad)
                    dst = get_or_create_atom(nx, ny, "", "", merge=(special != "none"))
                    if special != "none":
                        if rev:
                            add_bond(dst["id"], src["id"], btype)
                        else:
                            add_bond(src["id"], dst["id"], btype)
                    prev_atom = src
                    cur_atom = dst
                    pending_opt = None
                    continue

                # Atom label chunk (until next bond / branch / ring / hook)
                buf: list[str] = []
                brace_depth = 0
                while pos < n:
                    c = seq[pos]
                    if c == "{" and (pos == 0 or seq[pos - 1] != "\\"):
                        brace_depth += 1
                        buf.append(c)
                        pos += 1
                        continue
                    if c == "}" and (pos == 0 or seq[pos - 1] != "\\") and brace_depth > 0:
                        brace_depth -= 1
                        buf.append(c)
                        pos += 1
                        continue
                    if brace_depth == 0:
                        if c in "()?*":
                            break
                        if c == "[" and not buf:
                            break
                        if match_bond_sym(seq, pos) is not None:
                            # Allow literal +/- inside ^ or charge already inside braces; break on real bond
                            break
                    buf.append(c)
                    pos += 1

                raw_lbl = "".join(buf).strip()
                if raw_lbl:
                    lbl, chg = _clean_parsed_atom_label(raw_lbl)
                    atom = ensure_cur()
                    if lbl:
                        atom["label"] = lbl
                    if chg:
                        atom["charge"] = chg
                else:
                    pos += 1

            return cur_atom

        def parse_ring(
            rn: int,
            is_circle: bool,
            ring_body: str,
            anchor_atom: dict[str, Any] | None,
            prev_atom: dict[str, Any] | None,
            ring_theta: float,
            edge_len: float,
        ) -> dict[str, Any]:
            # Split ring_body into vertex chunks + perimeter bonds + nested fused rings
            # A ring body has sequence: V0 [B0 V1 [B1 ...]] up to rn bonds
            v_labels: list[str] = [""] * rn
            v_branches: list[list[str]] = [[] for _ in range(rn)]
            v_hooks: list[list[str]] = [[] for _ in range(rn)]
            nested_rings: list[tuple[int, int, bool, str]] = []
            b_types: list[str] = ["single"] * rn
            b_present: list[bool] = [False] * rn

            idx = 0
            m = len(ring_body)
            vi = 0
            while idx < m and vi < rn:
                ch = ring_body[idx]
                if ch.isspace():
                    idx += 1
                    continue
                if ch == "(":
                    br, idx = read_balanced(ring_body, idx, "(", ")")
                    v_branches[vi].append(br)
                    continue
                if ch == "?":
                    idx += 1
                    if idx < m and ring_body[idx] == "[":
                        hspec, idx = read_balanced(ring_body, idx, "[", "]")
                        v_hooks[vi].append(hspec)
                    else:
                        v_hooks[vi].append("_default")
                    continue
                if ch == "*":
                    sub_circle = ring_body.startswith("**", idx)
                    idx += 2 if sub_circle else 1
                    if idx < m and ring_body[idx].isdigit():
                        sub_n = int(ring_body[idx])
                        idx += 1
                        while idx < m and ring_body[idx].isspace():
                            idx += 1
                        if idx < m and ring_body[idx] == "(":
                            sub_body, idx = read_balanced(ring_body, idx, "(", ")")
                            nested_rings.append((vi, sub_n, sub_circle, sub_body))
                            continue
                bsym = match_bond_sym(ring_body, idx)
                if bsym is not None:
                    idx += len(bsym)
                    spec = ""
                    if idx < m and ring_body[idx] == "[":
                        spec, idx = read_balanced(ring_body, idx, "[", "]")
                    bt, _ = _map_chemfig_bond_sym(bsym)
                    if spec:
                        _, _, sp = _parse_bond_bracket(spec, 0.0)
                        if sp == "dotted":
                            bt = "dotted"
                    b_types[vi] = bt
                    b_present[vi] = True
                    vi += 1
                    continue

                # Atom label for vertex vi
                buf: list[str] = []
                bdepth = 0
                while idx < m:
                    c = ring_body[idx]
                    if c == "{" and (idx == 0 or ring_body[idx - 1] != "\\"):
                        bdepth += 1
                    elif c == "}" and (idx == 0 or ring_body[idx - 1] != "\\") and bdepth > 0:
                        bdepth -= 1
                    elif bdepth == 0 and (c in "()?*" or match_bond_sym(ring_body, idx) is not None):
                        break
                    buf.append(c)
                    idx += 1
                lbl_chunk = "".join(buf).strip()
                if lbl_chunk:
                    v_labels[vi] = (v_labels[vi] + lbl_chunk).strip()
                else:
                    idx += 1

            # Determine polygon vertex positions
            ring_atoms: list[dict[str, Any]] = []
            if anchor_atom is not None and prev_atom is not None and anchor_atom["id"] != prev_atom["id"]:
                # Fused ring sharing edge (prev_atom -> anchor_atom): build outward on opposite side
                ax, ay = prev_atom["x"], prev_atom["y"]
                bx, by = anchor_atom["x"], anchor_atom["y"]
                dx, dy = bx - ax, by - ay
                elen = math.hypot(dx, dy) or edge_len
                # Edge angle in math coords (+y up)
                e_math = math.degrees(math.atan2(-(by - ay), bx - ax))
                # Step CCW around new polygon starting from anchor_atom -> next vertices -> prev_atom
                # Wait: chemfig fuses on the RIGHT side of prev->anchor when walking CCW,
                # so interior turn is -(360/rn) from anchor->prev or +(360/rn) depending on winding.
                turn = 360.0 / rn
                cur_x, cur_y = bx, by
                cur_dir = e_math - (180.0 - (180.0 - turn))  # e_math - turn (outward CW relative to parent CCW)
                ring_atoms.append(anchor_atom)
                for k in range(1, rn - 1):
                    rad = math.radians(cur_dir)
                    cur_x += elen * math.cos(rad)
                    cur_y -= elen * math.sin(rad)
                    ring_atoms.append(get_or_create_atom(cur_x, cur_y, "", "", merge=True))
                    cur_dir -= turn
                ring_atoms.append(prev_atom)
            else:
                base_offset = 360.0 / rn - 90.0
                start_x = anchor_atom["x"] if anchor_atom is not None else origin_x
                start_y = anchor_atom["y"] if anchor_atom is not None else origin_y
                v0 = anchor_atom if anchor_atom is not None else get_or_create_atom(start_x, start_y, "", "", merge=False)
                ring_atoms.append(v0)
                cur_x, cur_y = v0["x"], v0["y"]
                for k in range(rn - 1):
                    ang_deg = ring_theta + base_offset + k * (360.0 / rn)
                    rad = math.radians(ang_deg)
                    cur_x += edge_len * math.cos(rad)
                    cur_y -= edge_len * math.sin(rad)
                    ring_atoms.append(get_or_create_atom(cur_x, cur_y, "", "", merge=True))

            # Apply vertex labels, hooks, and perimeter bonds
            for k in range(rn):
                if v_labels[k]:
                    lbl, chg = _clean_parsed_atom_label(v_labels[k])
                    if lbl:
                        ring_atoms[k]["label"] = lbl
                    if chg:
                        ring_atoms[k]["charge"] = chg
                for hspec in v_hooks[k]:
                    record_hook(ring_atoms[k]["id"], hspec)

            for k in range(rn):
                if b_present[k] or k < vi or is_circle:
                    bt = "single" if is_circle else b_types[k]
                    add_bond(ring_atoms[k]["id"], ring_atoms[(k + 1) % rn]["id"], bt)

            if is_circle and rn == 6:
                rings.append({"id": next_id("r"), "atoms": [a["id"] for a in ring_atoms], "aromatic_circle": True})

            # Parse external branches on each ring vertex
            for k in range(rn):
                for br in v_branches[k]:
                    parse_seq(br, ring_atoms[k], ring_theta, ring_atoms[(k - 1) % rn])

            # Parse nested fused rings (e.g., *6(=-*6(-=-=-)=-=-))
            for fuse_vi, sub_n, sub_circle, sub_body in nested_rings:
                p_v = ring_atoms[(fuse_vi - 1) % rn]
                c_v = ring_atoms[fuse_vi]
                parse_ring(sub_n, sub_circle, sub_body, c_v, p_v, ring_theta, edge_len)

            return ring_atoms[0]

        parse_seq(s, None, 0.0, None)

    offset_x = 0.0
    for body in bodies:
        before_n = len(atoms)
        parse_body(body, offset_x, 0.0)
        if len(atoms) > before_n:
            max_x = max(a["x"] for a in atoms[before_n:])
            offset_x = max_x + bond_len * 2.2

    if not atoms:
        raise ValueError("未能从该 chemfig 代码解析出原子节点。")

    # Fit & center on 600x400 SVG canvas
    min_x = min(a["x"] for a in atoms)
    max_x = max(a["x"] for a in atoms)
    min_y = min(a["y"] for a in atoms)
    max_y = max(a["y"] for a in atoms)
    span_x = max_x - min_x
    span_y = max_y - min_y
    scale = 1.0
    if span_x > 500.0 or span_y > 310.0:
        scale = min(500.0 / max(span_x, 1.0), 310.0 / max(span_y, 1.0))

    mid_x = (min_x + max_x) / 2.0
    mid_y = (min_y + max_y) / 2.0
    for a in atoms:
        a["x"] = round(center_x + (a["x"] - mid_x) * scale, 2)
        a["y"] = round(center_y + (a["y"] - mid_y) * scale, 2)

    return {"atoms": atoms, "bonds": bonds, "rings": rings}
