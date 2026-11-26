import subprocess
import sys
import unittest
from pathlib import Path
from shutil import copy2
from tempfile import TemporaryDirectory
from zipfile import ZipFile


class MixdogPackageTest(unittest.TestCase):
    def test_ship_index_contents_not_worktree_edits(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "scripts/package-mixdog.py"
            script.parent.mkdir()
            copy2(Path(__file__).resolve().parents[1] / "scripts/package-mixdog.py", script)
            skill = root / "skills/frontend-skill"
            skill.mkdir(parents=True)
            manifest = skill / "SKILL.md"
            manifest.write_bytes(b"---\nname: frontend-skill\ndescription: Example\n---\n\nOriginal body.\n")
            resource = skill / "reference.md"
            resource.write_bytes(b"First line.\nSecond line.\n")
            (root / ".gitattributes").write_bytes(b"* text=auto eol=lf\n")
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "add", "--", ".gitattributes", "skills"], cwd=root, check=True)

            def build():
                subprocess.run([sys.executable, str(script)], cwd=root, check=True, capture_output=True)
                return root / "packages/frontend-skill-mixdog.zip"

            original = build().read_bytes()
            resource.write_bytes(b"First line.\r\nSecond line.\r\n")
            manifest.write_bytes(b"Unstaged, not ready to ship.\n")
            (skill / "draft.md").write_bytes(b"Untracked.\n")
            self.assertEqual(build().read_bytes(), original)

            resource.write_bytes(b"Ready for release.\n")
            subprocess.run(["git", "add", "--", "skills/frontend-skill/reference.md"], cwd=root, check=True)
            resource.write_bytes(b"Next edit, not staged.\n")
            with ZipFile(build()) as archive:
                self.assertEqual(archive.read("frontend-skill/reference.md"), b"Ready for release.\n")
                self.assertNotIn("frontend-skill/draft.md", archive.namelist())
