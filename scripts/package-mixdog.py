"""Build the Mixdog installation ZIP from the standard frontend-skill folder."""

import json
from pathlib import Path
from subprocess import check_output
from tempfile import NamedTemporaryFile
from zipfile import ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "skills" / "frontend-skill"
OUTPUT = ROOT / "packages" / "frontend-skill-mixdog.zip"
TRIGGER = "Design, review or adjust UI layout, spacing or type on pages, charts and reports; not backend work."


def mixdog_manifest(document: bytes) -> bytes:
    opening, newline, rest = document.partition(b"\n")
    if opening.rstrip(b"\r") != b"---" or not newline:
        raise ValueError("SKILL.md must start with YAML frontmatter")
    line_ending = b"\r\n" if opening.endswith(b"\r") else b"\n"
    trigger = json.dumps(TRIGGER, ensure_ascii=False).encode("utf-8")
    return opening + newline + b"when_to_use: " + trigger + line_ending + rest


def build() -> None:
    tracked = check_output(["git", "ls-files", "-z", "--", "."], cwd=SOURCE)
    files = tracked.decode("utf-8").split("\0")[:-1]
    if "SKILL.md" not in files:
        raise ValueError("The standard SKILL.md must be tracked by Git")
    adapted = mixdog_manifest((SOURCE / "SKILL.md").read_bytes())
    OUTPUT.parent.mkdir(exist_ok=True)
    with NamedTemporaryFile(dir=OUTPUT.parent, suffix=".zip", delete=False) as temp:
        staged = Path(temp.name)
    try:
        with ZipFile(staged, "w") as archive:
            # Git order and fixed ZIP metadata keep builds identical across checkouts.
            for name in files:
                entry = ZipInfo(f"{SOURCE.name}/{name}")
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                data = adapted if name == "SKILL.md" else (SOURCE / name).read_bytes()
                archive.writestr(entry, data)
        staged.replace(OUTPUT)
    finally:
        staged.unlink(missing_ok=True)
    print(OUTPUT.relative_to(ROOT).as_posix())


if __name__ == "__main__":
    build()
