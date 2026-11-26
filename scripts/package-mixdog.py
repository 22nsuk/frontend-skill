"""Build or verify the Mixdog ZIP using the staged frontend-skill files."""

import argparse
import json
from pathlib import Path
from subprocess import check_output, run
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo


SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[1]
SOURCE = ROOT / "skills" / "frontend-skill"
OUTPUT = ROOT / "packages" / "frontend-skill-mixdog.zip"
TRIGGER = "Design or review pages, UIs, charts or reports; not backend."


def mixdog_manifest(document: bytes) -> bytes:
    opening, newline, rest = document.partition(b"\n")
    if opening.rstrip(b"\r") != b"---" or not newline:
        raise ValueError("SKILL.md must start with YAML frontmatter")
    line_ending = b"\r\n" if opening.endswith(b"\r") else b"\n"
    trigger = json.dumps(TRIGGER, ensure_ascii=False).encode("utf-8")
    return opening + newline + b"when_to_use: " + trigger + line_ending + rest


def check_staged_zip(tree: str, rebuilt: Path) -> None:
    archive_path = OUTPUT.relative_to(ROOT).as_posix()
    staged = run(["git", "cat-file", "blob", f"{tree}:{archive_path}"], cwd=ROOT, capture_output=True)
    if staged.returncode:
        raise SystemExit(f"Missing staged ZIP: git add -- {archive_path}")
    if staged.stdout != rebuilt.read_bytes():
        raise SystemExit(
            "Staged ZIP differs from staged sources. "
            f"Run python scripts/package-mixdog.py, then git add -- {archive_path}"
        )


def build(*, check_only: bool = False) -> None:
    tree = check_output(["git", "write-tree"], cwd=ROOT).decode().strip()
    script_path = SCRIPT.relative_to(ROOT).as_posix()
    staged_script = run(
        ["git", "cat-file", "blob", f"{tree}:{script_path}"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    if staged_script.returncode or staged_script.stdout != SCRIPT.read_text(encoding="utf-8"):
        raise SystemExit(f"Stage the packaging script before building: git add -- {script_path}")

    skill_tree = f"{tree}:{SOURCE.relative_to(ROOT).as_posix()}"
    tracked = check_output(["git", "ls-tree", "-r", "-z", skill_tree], cwd=ROOT)
    files = {}
    for record in tracked.decode("utf-8").split("\0")[:-1]:
        header, name = record.split("\t", 1)
        mode, _, oid = header.split()
        if mode not in {"100644", "100755"}:
            raise ValueError(f"Expected a regular skill file: {name}")
        files[name] = oid
    if "SKILL.md" not in files:
        raise ValueError("The standard SKILL.md must be in the Git index")
    if not check_only:
        OUTPUT.parent.mkdir(exist_ok=True)
    # Build beside the destination for atomic replacement, or outside the checkout for a check.
    with TemporaryDirectory(dir=None if check_only else OUTPUT.parent) as tmp:
        rebuilt = Path(tmp) / OUTPUT.name
        with ZipFile(rebuilt, "w") as archive:
            # Git order and fixed ZIP metadata keep builds identical across checkouts.
            for name, oid in files.items():
                entry = ZipInfo(f"{SOURCE.name}/{name}")
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                data = check_output(["git", "cat-file", "blob", oid], cwd=ROOT)
                if name == "SKILL.md":
                    data = mixdog_manifest(data)
                archive.writestr(entry, data)
        if check_only:
            check_staged_zip(tree, rebuilt)
            print("Staged ZIP matches staged sources.")
            return
        rebuilt.replace(OUTPUT)
    print(OUTPUT.relative_to(ROOT).as_posix())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify the staged ZIP without replacing it.")
    build(check_only=parser.parse_args().check)
