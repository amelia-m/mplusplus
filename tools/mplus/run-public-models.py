"""Run downloaded public Mplus models with /diagram so each writes a .dgm.

Reads the downloads in docs/reference/public-models/<set>/ and works on copies
in docs/reference/mplus-runs/<run>/<set>/ (both gitignored); never changes the
downloads. Adaptations, all made to the copies:
- an absolute or placeholder FILE path becomes the local data file name;
- an input with no DATA command gets one;
- a .txt holding several inputs is cut at its first line of dashes;
- a Zenodo semicolon CSV with a header becomes a header-less space-separated .dat.

Usage: python -I tools/mplus/run-public-models.py <run name> [set | set:stem ...]
Sources and licences of the sets: dgm/README.md, "Published models".
"""
import pathlib
import re
import shutil
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
SRC = REPO / "docs/reference/public-models"
RUNS = REPO / "docs/reference/mplus-runs"
MPLUS = r"C:\Program Files\Mplus\Mplus.exe"

# set -> (data file in the run folder, [(source input, run name)])
JOBS = {
    "golec-federico-lcs": ("lcsmcn2.dat", [("lcsmcn.inp", "lcsmcn")]),
    "mader-schoen-2023": ("DATA_mplus.dat", [
        ("Mplus 01 Figure 2.inp", "ms_fig2"),
        ("Mplus 02 Figure 3 NATID.inp", "ms_fig3_natid"),
        ("Mplus 03 Figure 3 RWA.inp", "ms_fig3_rwa"),
    ]),
    "federico-ekstrom-2017": ("idnfc.dat", [("idnfc41b.inp", "idnfc41b")]),
    "pcwas-zenodo-14601030": ("pcwas.dat", [("CFA.txt", "pcwas_cfa")]),
    "iwas-zenodo-14575311": ("iwas.dat", [("CFA.txt", "iwas_cfa")]),
}

FILE_RE = re.compile(r"(?im)^(\s*(?:DATA:\s*)?FILE\s*(?:IS|=)\s*)[^;]*;")


def csv_to_dat(src: pathlib.Path, dst: pathlib.Path) -> None:
    lines = src.read_text(encoding="utf-8-sig").splitlines()
    out = []
    for line in lines[1:]:
        fields = line.split(";")
        # An empty field would shift every later column once spaces separate them.
        if any(f == "" for f in fields):
            raise SystemExit(f"empty field in {src.name}: {line[:60]}")
        out.append(" ".join(fields))
    dst.write_text("\n".join(out) + "\n", encoding="ascii")


def adapt(text: str, data: str) -> str:
    text = text.split("\n-----", 1)[0]
    if FILE_RE.search(text):
        return FILE_RE.sub(lambda m: f"{m.group(1)}{data};", text, count=1)
    return re.sub(r"(?im)^(\s*VARIABLE\s*:)", f"DATA: FILE IS {data};\n\\1", text, count=1)


def run_set(run: pathlib.Path, arg: str) -> bool:
    # "set" runs every input of the set; "set:stem" runs one.
    name, _, only = arg.partition(":")
    data, inputs = JOBS[name]
    if only:
        inputs = [i for i in inputs if i[1] == only]
        if not inputs:
            raise SystemExit(f"no input {only!r} in {name}")
    folder = run / name
    folder.mkdir(parents=True, exist_ok=True)
    src_dir = SRC / name
    if (src_dir / data).exists():
        shutil.copyfile(src_dir / data, folder / data)
    else:
        csv_to_dat(src_dir / "Data.csv", folder / data)
    ok = True
    for src, stem in inputs:
        text = (src_dir / src).read_text(encoding="utf-8-sig", errors="replace")
        (folder / f"{stem}.inp").write_text(adapt(text, data), encoding="ascii", errors="replace")
        r = subprocess.run([MPLUS, f"{stem}.inp", "/diagram"], cwd=folder, capture_output=True, timeout=3600)
        out = folder / f"{stem}.out"
        dgm = folder / f"{stem}.dgm"
        errors = len(re.findall(r"\*\*\* ERROR", out.read_text(errors="replace"))) if out.exists() else None
        print(f"{name}/{stem}: exit {r.returncode} out:{out.exists()} dgm:{dgm.exists()} errors:{errors}", flush=True)
        ok = ok and r.returncode == 0 and dgm.exists() and errors == 0
    return ok


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    run = RUNS / sys.argv[1]
    results = [run_set(run, a) for a in sys.argv[2:] or list(JOBS)]
    sys.exit(0 if all(results) else 1)
