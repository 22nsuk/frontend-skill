"""Build or verify the Mixdog ZIP using the staged frontend-skill files."""

import argparse
import json
import re
from pathlib import Path
from subprocess import check_output, run
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo

try:
    import yaml
except ModuleNotFoundError:
    raise SystemExit(
        "Install the packaging prerequisite: python -m pip install -r scripts/requirements-package-mixdog.txt"
    ) from None


SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[1]
SOURCE = ROOT / "skills" / "frontend-skill"
OUTPUT = ROOT / "packages" / "frontend-skill-mixdog.zip"
TRIGGER = "Design/review pages, UIs, charts, reports. Skip backend-only"
# Mixdog reads frontmatter with this pattern and parses it as YAML that rejects duplicate keys.
FRONTMATTER = re.compile(r"\A\ufeff?---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)
DESCRIPTION_LIMIT = 1024
# A crowded Mixdog listing has this limit in UTF-16 code units.
LISTING_LIMIT = 60
# Mixdog trims with the JavaScript whitespace set before validating text.
MIXDOG_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


class UniqueKeyLoader(yaml.SafeLoader):
    # PyYAML keeps the last of duplicate keys; Mixdog's parser rejects the document.
    def construct_mapping(self, node, deep=False):
        keys = []
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=True)
            if key in keys:
                raise yaml.constructor.ConstructorError(
                    None, None, f"found duplicate key {key!r}", key_node.start_mark
                )
            keys.append(key)
        return super().construct_mapping(node, deep)


def load_frontmatter(document: bytes) -> tuple[yaml.MappingNode, dict]:
    match = FRONTMATTER.match(document.decode("utf-8"))
    if not match:
        raise SystemExit("SKILL.md must start with YAML frontmatter closed by a --- line")
    loader = UniqueKeyLoader(match[1])
    try:
        root = loader.get_single_node()
        # The trigger is added as another line of the root block mapping.
        if not isinstance(root, yaml.MappingNode) or root.flow_style:
            raise SystemExit("SKILL.md frontmatter must be a YAML block mapping")
        return root, loader.construct_document(root)
    except yaml.YAMLError as error:
        raise SystemExit(f"Mixdog cannot parse the SKILL.md frontmatter: {error}") from None
    finally:
        loader.dispose()


def mixdog_manifest(document: bytes) -> bytes:
    root, fields = load_frontmatter(document)
    if "when_to_use" in fields:
        raise SystemExit(
            f"Remove when_to_use from {SOURCE.relative_to(ROOT).as_posix()}/SKILL.md; "
            f"the Mixdog package sets it from TRIGGER in {SCRIPT.relative_to(ROOT).as_posix()}"
        )
    opening, newline, rest = document.partition(b"\n")
    line_ending = b"\r\n" if opening.endswith(b"\r") else b"\n"
    indent = b" " * root.start_mark.column
    trigger = json.dumps(TRIGGER, ensure_ascii=False).encode("utf-8")
    return opening + newline + indent + b"when_to_use: " + trigger + line_ending + rest


def mixdog_text_length(value: str) -> int:
    return len(value.strip(MIXDOG_WHITESPACE).encode("utf-16-le", errors="surrogatepass")) // 2


def check_manifest(document: bytes) -> None:
    _, fields = load_frontmatter(document)
    if fields.get("name") != SOURCE.name:
        raise SystemExit(f"SKILL.md name must match the packaged folder: {SOURCE.name}")
    description = fields.get("description")
    if (
        not isinstance(description, str)
        or not 0 < mixdog_text_length(description) <= DESCRIPTION_LIMIT
        or {"<", ">"} & set(description)
    ):
        raise SystemExit(
            f"SKILL.md description must be a nonempty string of at most {DESCRIPTION_LIMIT} "
            "UTF-16 code units without angle brackets"
        )
    trigger = fields.get("when_to_use")
    if (
        not isinstance(trigger, str)
        or not 0 < mixdog_text_length(trigger) <= LISTING_LIMIT
        or {"<", ">"} & set(trigger)
    ):
        raise SystemExit(f"TRIGGER must have 1-{LISTING_LIMIT} UTF-16 code units and no angle brackets")


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
                    check_manifest(data)
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
