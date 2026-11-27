"""Build or verify the Mixdog ZIP using the staged frontend-skill files."""

from __future__ import annotations

import argparse
import json
import os
from io import BytesIO
from pathlib import Path
from subprocess import PIPE, CalledProcessError, Popen, check_output, run
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[1]
SOURCE = ROOT / "skills" / "frontend-skill"
OUTPUT = ROOT / "packages" / "frontend-skill-mixdog.zip"
TRIGGER = "Design/review pages, UIs, charts, reports. Skip backend-only"
MANIFEST_HELPER = SCRIPT.with_name("mixdog-manifest.mjs")
UPSTREAM = "https://github.com/tribgames/mixdog.git"
UPSTREAM_REVISION = "8382c929c3d7ae5c6692136c67c63be821838bc0"
VALIDATOR = "src/defaults/skills/skill-creator/scripts/validate-skill.mjs"


def mixdog_manifest(document: bytes) -> bytes:
    # Keep arbitrary trigger text (including control characters) out of OS arguments.
    payload = json.dumps(TRIGGER).encode("ascii") + b"\n" + document
    try:
        result = run(
            ["node", MANIFEST_HELPER, SOURCE.name], cwd=ROOT, input=payload, stdout=PIPE,
        )
    except FileNotFoundError:
        raise SystemExit("Packaging requires Node.js and the dependencies installed by npm ci.") from None
    if result.returncode:
        raise SystemExit(result.returncode)
    return result.stdout


def read_staged_blob(batch: Popen, object_name: str) -> bytes | None:
    request = object_name.encode("utf-8")
    batch.stdin.write(request + b"\n")
    batch.stdin.flush()
    header = batch.stdout.readline()
    if header == request + b" missing\n":
        return None
    fields = header.split()
    if len(fields) != 3 or not fields[2].isdigit():
        raise SystemExit(f"Could not read staged Git object: {object_name}")
    _, object_type, size = fields
    # Blob data may contain any byte. Read its declared length and then the separator.
    length = int(size)
    data = batch.stdout.read(length)
    if len(data) != length or batch.stdout.read(1) != b"\n":
        raise SystemExit(f"Incomplete staged Git object: {object_name}")
    return data if object_type == b"blob" else None


def check_staged_generator(batch: Popen, tree: str) -> None:
    for path in (SCRIPT, MANIFEST_HELPER, ROOT / "package.json", ROOT / "package-lock.json"):
        relative = path.relative_to(ROOT).as_posix()
        staged = read_staged_blob(batch, f"{tree}:{relative}")
        if staged is not None and path.is_file():
            # Ignore checkout line-ending conversion in generator inputs.
            staged_text = staged.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
            if staged_text == path.read_text(encoding="utf-8"):
                continue
        raise SystemExit(f"Stage the packaging input before building: git add -- {relative}")


def check_staged_zip(batch: Popen, tree: str, rebuilt: Path) -> bytes:
    archive_path = OUTPUT.relative_to(ROOT).as_posix()
    staged = read_staged_blob(batch, f"{tree}:{archive_path}")
    if staged is None:
        raise SystemExit(f"Missing staged ZIP: git add -- {archive_path}")
    if staged != rebuilt.read_bytes():
        raise SystemExit(
            "Staged ZIP differs from staged sources. "
            f"Run python scripts/package-mixdog.py, then git add -- {archive_path}"
        )
    return staged


def validate_release(staged_zip: bytes) -> None:
    # The upstream ES modules resolve the same locked yaml from our node_modules.
    with TemporaryDirectory(dir=ROOT / "node_modules") as tmp:
        upstream = Path(tmp) / "mixdog"
        extracted = Path(tmp) / "package"
        with ZipFile(BytesIO(staged_zip)) as archive:
            archive.extractall(extracted)
        # A calling Git hook or an alternate index belongs to the project checkout.
        local_names = check_output(["git", "rev-parse", "--local-env-vars"], cwd=ROOT, text=True).splitlines()
        git_env = {key: value for key, value in os.environ.items() if key not in local_names}

        def git(*args: str) -> None:
            run(["git", "-C", upstream, *args], env=git_env, check=True)

        upstream.mkdir()
        try:
            git("init", "-q")
            git("remote", "add", "origin", UPSTREAM)
            git("sparse-checkout", "set", "--no-cone", f"/{VALIDATOR}", "/src/runtime/shared/")
            git("fetch", "-q", "--depth=1", "--filter=blob:none", "origin", UPSTREAM_REVISION)
            git("checkout", "-q", "--detach", UPSTREAM_REVISION)
            run(["node", upstream / VALIDATOR, extracted / SOURCE.name], check=True)
        except CalledProcessError as error:
            raise SystemExit(f"Official Mixdog release check failed (exit {error.returncode}).") from None


def build(*, check_only: bool = False, release: bool = False) -> None:
    check_only = check_only or release
    tree = check_output(["git", "write-tree"], cwd=ROOT).decode().strip()
    with Popen(["git", "cat-file", "--batch"], cwd=ROOT, stdin=PIPE, stdout=PIPE) as batch:
        check_staged_generator(batch, tree)
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
                    data = read_staged_blob(batch, oid)
                    if data is None:
                        raise SystemExit(f"Missing staged skill blob: {name}")
                    if name == "SKILL.md":
                        data = mixdog_manifest(data)
                    archive.writestr(entry, data)
            if check_only:
                staged_zip = check_staged_zip(batch, tree, rebuilt)
            batch.stdin.close()
            if batch.wait():
                raise SystemExit("Could not read staged Git blobs.")
            if not check_only:
                rebuilt.replace(OUTPUT)
    if release:
        validate_release(staged_zip)
    if check_only:
        print("Staged ZIP matches staged sources.")
    else:
        print(OUTPUT.relative_to(ROOT).as_posix())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    checks = parser.add_mutually_exclusive_group()
    checks.add_argument("--check", action="store_true", help="Verify the staged ZIP without replacing it.")
    checks.add_argument("--check-release", action="store_true", help="Verify the staged ZIP and run the pinned official validator.")
    args = parser.parse_args()
    build(check_only=args.check, release=args.check_release)
