import subprocess
import sys
import unittest
from pathlib import Path
from shutil import copy2
from tempfile import TemporaryDirectory
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_PATH = "packages/frontend-skill-mixdog.zip"


class ShippedMixdogPackageTest(unittest.TestCase):
    def test_shipped_zip_matches_staged_sources(self):
        result = subprocess.run(
            [sys.executable, "scripts/package-mixdog.py", "--check"], cwd=ROOT,
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class MixdogPackageTest(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.script = self.root / "scripts/package-mixdog.py"
        self.script.parent.mkdir()
        copy2(ROOT / "scripts/package-mixdog.py", self.script)
        self.skill = self.root / "skills/frontend-skill"
        self.skill.mkdir(parents=True)
        (self.skill / "SKILL.md").write_bytes(b"---\nname: frontend-skill\ndescription: Example\n---\n\nOriginal body.\n")
        (self.skill / "reference.md").write_bytes(b"First line.\nSecond line.\n")
        (self.root / ".gitattributes").write_bytes(b"* text=auto eol=lf\n")
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "--", ".gitattributes", "scripts", "skills"], cwd=self.root, check=True)
        self.archive = self.root / ARCHIVE_PATH

    def build(self, *args, check=True):
        return subprocess.run(
            [sys.executable, str(self.script), *args], cwd=self.root,
            check=check, capture_output=True, text=True,
        )

    def test_check_uses_staged_zip_even_when_worktree_has_a_different_copy(self):
        self.build()
        missing = self.build("--check", check=False)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("Missing staged ZIP", missing.stderr)

        subprocess.run(["git", "add", "--", ARCHIVE_PATH], cwd=self.root, check=True)
        (self.skill / "reference.md").write_bytes(b"Updated reference.\n")
        subprocess.run(["git", "add", "--", "skills/frontend-skill/reference.md"], cwd=self.root, check=True)
        self.build()
        stale = self.build("--check", check=False)
        self.assertNotEqual(stale.returncode, 0)
        self.assertIn("Staged ZIP differs", stale.stderr)

        subprocess.run(["git", "add", "--", ARCHIVE_PATH], cwd=self.root, check=True)
        self.archive.write_bytes(b"Unstaged changes.\n")
        self.build("--check")
        self.assertEqual(self.archive.read_bytes(), b"Unstaged changes.\n")

    def test_ship_index_contents_not_worktree_edits(self):
        self.build()
        original = self.archive.read_bytes()
        resource = self.skill / "reference.md"
        resource.write_bytes(b"First line.\r\nSecond line.\r\n")
        (self.skill / "SKILL.md").write_bytes(b"Unstaged, not ready to ship.\n")
        (self.skill / "draft.md").write_bytes(b"Untracked.\n")
        self.build()
        self.assertEqual(self.archive.read_bytes(), original)

        resource.write_bytes(b"Ready for release.\n")
        subprocess.run(["git", "add", "--", "skills/frontend-skill/reference.md"], cwd=self.root, check=True)
        resource.write_bytes(b"Next edit, not staged.\n")
        self.build()
        with ZipFile(self.archive) as archive:
            self.assertEqual(archive.read("frontend-skill/reference.md"), b"Ready for release.\n")
            self.assertNotIn("frontend-skill/draft.md", archive.namelist())

    def test_generator_change_must_be_staged_before_replacing_zip(self):
        self.build()
        original = self.archive.read_bytes()
        script = self.script.read_bytes()
        self.script.write_bytes(script.replace(b'TRIGGER = "', b'TRIGGER = "Revised: ', 1))

        failed = self.build(check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("git add -- scripts/package-mixdog.py", failed.stderr)
        self.assertEqual(self.archive.read_bytes(), original)

        subprocess.run(["git", "add", "--", "scripts/package-mixdog.py"], cwd=self.root, check=True)
        self.build()
        with ZipFile(self.archive) as archive:
            self.assertIn(b'when_to_use: "Revised: ', archive.read("frontend-skill/SKILL.md"))
