import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import io

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).with_name("server.py"))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
EXAMPLE = {"message_id": "om_test_123", "title": "测试：自动发布", "date": "2026-09-16", "category": "技术实践", "tags": ["AI", "Docker"], "summary": "用于验证发布流程。", "body": "# 自动发布\n\n一段正文。"}


class PublisherFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        p.DATA = self.root / "data"
        p.REPO = p.DATA / "repository.git"
        p.REMOTE = str(self.root / "remote.git")
        subprocess.run(["git", "init", "--bare", p.REMOTE], check=True, capture_output=True)
        work = self.root / "seed"
        subprocess.run(["git", "init", "-b", "main", str(work)], check=True, capture_output=True)
        (work / "untouched.txt").write_text("Keep existing files\n")
        for command in [["config", "user.name", "Test"], ["config", "user.email", "test@example.com"], ["add", "."], ["commit", "-m", "seed"], ["push", p.REMOTE, "main"]]:
            subprocess.run(["git", "-C", str(work), *command], check=True, capture_output=True)

    def tearDown(self):
        self.temp.cleanup()

    def remote(self, *args):
        return subprocess.check_output(["git", "--git-dir", p.REMOTE, *args])


class PublisherTests(PublisherFixture):
    def test_publishes_one_file_and_preserves_existing_tree(self):
        job = p.publish(EXAMPLE)
        self.assertEqual(job["state"], "submitted")
        self.assertEqual(self.remote("show", "main:untouched.txt"), b"Keep existing files\n")
        names = self.remote("diff-tree", "--no-commit-id", "--name-only", "-r", "main").decode().splitlines()
        self.assertEqual(names, ["public/markdown/" + job["id"] + ".md"])
        self.assertIn(b'date: "2026-09-16"', self.remote("show", "main:" + names[0]))

    def test_retry_after_success_does_not_create_another_commit(self):
        first = p.publish(EXAMPLE)
        head = self.remote("rev-parse", "main")
        second = p.publish(EXAMPLE)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(head, self.remote("rev-parse", "main"))

    def test_ambiguous_push_result_recovers_from_remote(self):
        original = p.git
        def uncertain(*args, **kwargs):
            result = original(*args, **kwargs)
            if args[0] == "push" and result.returncode == 0:
                result.returncode = 1
            return result
        p.git = uncertain
        try:
            job = p.publish(EXAMPLE)
            self.assertEqual(job["state"], "submitted")
            self.assertEqual(self.remote("rev-list", "--count", "main").strip(), b"2")
        finally:
            p.git = original

    def test_changed_retry_refuses_overwrite(self):
        p.publish(EXAMPLE)
        changed = {**EXAMPLE, "body": "Different text"}
        with self.assertRaisesRegex(ValueError, "refusing to overwrite"):
            p.publish(changed)

    def test_rejects_extra_path_bad_date_and_credentials(self):
        cases = [{**EXAMPLE, "path": "../../workflow.yml"}, {**EXAMPLE, "date": "2026-02-30"}, {**EXAMPLE, "body": "sk-" + "x" * 32}, {**EXAMPLE, "title": "Title\ndraft: true"}, {**EXAMPLE, "tags": "AI"}]
        for payload in cases:
            with self.subTest(payload=list(payload)), self.assertRaises(ValueError):
                p.validate(payload)

    def test_frontmatter_escapes_quotes(self):
        job, source = p.validate({**EXAMPLE, "title": '测试 "双引号": 值'})
        title_line = source.decode().splitlines()[1]
        self.assertEqual(json.loads(title_line.split(": ", 1)[1]), '测试 "双引号": 值')

    def test_spa_fallback_is_not_reported_as_live(self):
        job = p.publish(EXAMPLE)
        with patch.object(p.urllib.request, 'urlopen', return_value=io.BytesIO(b'<html>SPA fallback</html>')):
            self.assertEqual(p.status(job['id'])['state'], 'deploying')
        _, source = p.validate(EXAMPLE)
        with patch.object(p.urllib.request, 'urlopen', return_value=io.BytesIO(source)):
            self.assertEqual(p.status(job['id'])['state'], 'live')

    def test_missing_or_wrong_token_is_rejected(self):
        handler = object.__new__(p.Handler)
        with patch.dict(os.environ, {'PUBLISHER_TOKEN': 'x' * 40}):
            for headers in [{}, {'Authorization': 'Bearer wrong'}]:
                handler.headers = headers
                self.assertFalse(handler.authorized())
            handler.headers = {'Authorization': 'Bearer ' + 'x' * 40}
            self.assertTrue(handler.authorized())


if __name__ == "__main__":
    unittest.main()
