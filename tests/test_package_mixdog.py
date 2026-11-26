import subprocess
import sys
import unittest
from pathlib import Path
from shutil import copy2
from tempfile import TemporaryDirectory
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]


class ShippedMixdogPackageTest(unittest.TestCase):
    def test_shipped_zip_matches_staged_sources(self):
        archive_path = Path("packages/frontend-skill-mixdog.zip")
        shipped = ROOT / archive_path
        self.assertTrue(shipped.is_file(), f"Missing shipped package: {archive_path}")
        expected = shipped.read_bytes()

        with TemporaryDirectory() as tmp:
            checkout = Path(tmp)
            # Rebuild a copy of the index without changing this checkout's index or ZIP.
            subprocess.run(
                ["git", "checkout-index", "--all", f"--prefix={checkout.as_posix()}/"],
                cwd=ROOT, check=True,
            )
            subprocess.run(["git", "init", "-q"], cwd=checkout, check=True)
            subprocess.run(
                ["git", "add", "--force", "--", ".gitattributes", "scripts", "skills"],
                cwd=checkout, check=True,
            )
            script = checkout / "scripts/package-mixdog.py"
            # Preserve the generator's refusal to run unstaged script changes.
            copy2(ROOT / "scripts/package-mixdog.py", script)
            rebuilt = subprocess.run(
                [sys.executable, str(script)], cwd=checkout,
                capture_output=True, text=True,
            )
            self.assertEqual(rebuilt.returncode, 0, rebuilt.stdout + rebuilt.stderr)
            self.assertEqual(
                expected, (checkout / archive_path).read_bytes(),
                "Shipped ZIP differs from staged sources; run python scripts/package-mixdog.py",
            )


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
        self.archive = self.root / "packages/frontend-skill-mixdog.zip"

    def build(self, *, check=True):
        return subprocess.run(
            [sys.executable, str(self.script)], cwd=self.root,
            check=check, capture_output=True, text=True,
        )

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
