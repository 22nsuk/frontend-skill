import json
import re
import subprocess
import sys
import unittest
from pathlib import Path
from shutil import copy2
from tempfile import TemporaryDirectory
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_PATH = "packages/frontend-skill-mixdog.zip"


def with_trigger(script, trigger):
    line = b"TRIGGER = " + json.dumps(trigger, ensure_ascii=False).encode("utf-8")
    return re.sub(rb"^TRIGGER = .*$", lambda _: line, script, count=1, flags=re.M)


def skill_with_description(description):
    value = json.dumps(description, ensure_ascii=False)
    return f"---\nname: frontend-skill\ndescription: {value}\n---\n\nBody.\n".encode("utf-8")


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

    def test_trigger_remains_visible_in_a_crowded_mixdog_listing(self):
        self.build()
        with ZipFile(self.archive) as archive:
            manifest = archive.read("frontend-skill/SKILL.md").decode("utf-8")
        frontmatter = manifest.split("---", 2)[1].splitlines()
        [value] = [line.split(":", 1)[1] for line in frontmatter if line.startswith("when_to_use:")]
        trigger = json.loads(value)
        self.assertTrue(trigger.strip())
        self.assertLessEqual(len(trigger.encode("utf-16-le")) // 2, 60)

    def assert_not_shipped(self, message):
        original = self.archive.read_bytes()
        for args in [(), ("--check",)]:
            failed = self.build(*args, check=False)
            self.assertNotEqual(failed.returncode, 0)
            self.assertNotIn("Traceback", failed.stderr)
            self.assertIn(message, failed.stderr)
        self.assertEqual(self.archive.read_bytes(), original)

    def test_source_manifest_mixdog_cannot_parse_is_not_shipped(self):
        self.build()
        subprocess.run(["git", "add", "--", ARCHIVE_PATH], cwd=self.root, check=True)
        duplicate = "Remove when_to_use from skills/frontend-skill/SKILL.md"
        sources = {
            b"---\nname: wrong-skill\ndescription: Example\n---\n\nBody.\n": "must match the packaged folder",
            b"---\nname: frontend-skill\ndescription:\n---\n\nBody.\n": "description must be a nonempty string",
            b"---\nname: frontend-skill\nwhen_to_use: Existing\ndescription: Example\n---\n\nBody.\n": duplicate,
            b'---\nname: frontend-skill\n"when_to_\\u0075se": Existing\ndescription: Example\n---\n\nBody.\n': duplicate,
            b"---\n  name: frontend-skill\n  when_to_use: Existing\n  description: Example\n---\n\nBody.\n": duplicate,
            b"---\nname: frontend-skill\ndescription: Example\nmetadata:\n  team: a\n  team: b\n---\n\nBody.\n":
                "found duplicate key 'team'",
            b"---\n{name: frontend-skill, description: Example}\n---\n\nBody.\n": "must be a YAML block mapping",
            b"---\nname: frontend-skill\ndescription: Example\n\nBody without a closing fence.\n": "closed by a --- line",
        }
        for source, message in sources.items():
            with self.subTest(source=source):
                (self.skill / "SKILL.md").write_bytes(source)
                subprocess.run(["git", "add", "--", "skills/frontend-skill/SKILL.md"], cwd=self.root, check=True)
                self.assert_not_shipped(message)

    def test_equivalent_standard_frontmatter_is_packaged(self):
        sources = [
            b"---\nname: frontend-skill\ndescription: Example\nmetadata:\n  when_to_use: Nested\n---\n\n"
            b"when_to_use: shown as body text.\n",
            b"---\n  name: frontend-skill\n  description: Example\n---\n\nBody.\n",
        ]
        for source in sources:
            with self.subTest(source=source):
                (self.skill / "SKILL.md").write_bytes(source)
                subprocess.run(["git", "add", "--", "skills/frontend-skill/SKILL.md"], cwd=self.root, check=True)
                self.build()
                with ZipFile(self.archive) as archive:
                    manifest = archive.read("frontend-skill/SKILL.md")
                indent = re.match(rb"---\n( *)", source)[1]
                self.assertTrue(manifest.startswith(b"---\n" + indent + b'when_to_use: "'), manifest)
                self.assertTrue(manifest.endswith(source.removeprefix(b"---\n")), manifest)

    def test_missing_build_prerequisite_is_reported_without_installing(self):
        # -I -S hides installed packages, as on a machine without the build requirement.
        result = subprocess.run(
            [sys.executable, "-I", "-S", str(self.script)], cwd=self.root, capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("python -m pip install -r scripts/requirements-package-mixdog.txt", result.stderr)
        self.assertFalse(self.archive.exists())

    def test_trigger_outside_the_listing_contract_is_not_shipped(self):
        self.build()
        subprocess.run(["git", "add", "--", ARCHIVE_PATH], cwd=self.root, check=True)
        script = self.script.read_bytes()
        for trigger in [" ", "x" * 61, "x" * 59 + "\U0001f3a8", "Design <pages>"]:
            with self.subTest(trigger=trigger):
                self.script.write_bytes(with_trigger(script, trigger))
                subprocess.run(["git", "add", "--", "scripts/package-mixdog.py"], cwd=self.root, check=True)
                self.assert_not_shipped("TRIGGER must")

    def test_description_over_the_mixdog_limit_is_not_shipped(self):
        self.build()
        subprocess.run(["git", "add", "--", ARCHIVE_PATH], cwd=self.root, check=True)
        for description in ["x" * 1025, "x" * 1023 + "\U0001f3a8"]:
            with self.subTest(description=description):
                (self.skill / "SKILL.md").write_bytes(skill_with_description(description))
                subprocess.run(["git", "add", "--", "skills/frontend-skill/SKILL.md"], cwd=self.root, check=True)
                self.assert_not_shipped("at most 1024 UTF-16 code units")

    def test_exact_text_limits_are_accepted_after_trimming(self):
        script = self.script.read_bytes()
        cases = [
            (" " + "x" * 1024 + " ", " " + "x" * 60 + " "),
            ("\ufeff" + "x" * 1022 + "\U0001f3a8", "\ufeff" + "x" * 58 + "\U0001f3a8"),
        ]
        for description, trigger in cases:
            with self.subTest(description=description, trigger=trigger):
                (self.skill / "SKILL.md").write_bytes(skill_with_description(description))
                self.script.write_bytes(with_trigger(script, trigger))
                subprocess.run(["git", "add", "--", "skills", "scripts"], cwd=self.root, check=True)
                self.build()
                subprocess.run(["git", "add", "--", ARCHIVE_PATH], cwd=self.root, check=True)
                self.build("--check")

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
        self.script.write_bytes(with_trigger(script, "Revised: design pages"))

        failed = self.build(check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("git add -- scripts/package-mixdog.py", failed.stderr)
        self.assertEqual(self.archive.read_bytes(), original)

        subprocess.run(["git", "add", "--", "scripts/package-mixdog.py"], cwd=self.root, check=True)
        self.build()
        with ZipFile(self.archive) as archive:
            self.assertIn(b'when_to_use: "Revised: design pages"', archive.read("frontend-skill/SKILL.md"))
