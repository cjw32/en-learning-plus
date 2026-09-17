"""Destructive checks use isolated local repositories, never the real blog."""
import io
import json
import subprocess
import unittest
from unittest.mock import patch
from test_server import PublisherFixture, EXAMPLE, p


class DeleteTests(PublisherFixture):
    def prepare(self):
        job = p.publish(EXAMPLE)
        preview = p.prepare_delete({'article_id': job['id'], 'message_id': 'om_delete'})
        confirmation = {'request_id': preview['request_id'], 'confirmation_message_id': 'om_confirm',
                        'confirmation_text': preview['confirmation_text']}
        return job, preview, confirmation

    def change(self, path, source, mode='100644'):
        head = p.fetch_head()
        env = {'GIT_INDEX_FILE': str(self.root / 'test-index')}
        blob = p.git('hash-object', '-w', '--stdin', input=source).stdout.decode().strip()
        p.git('read-tree', head, extra_env=env)
        p.git('update-index', '--add', '--cacheinfo', mode + ',' + blob + ',' + path, extra_env=env)
        tree = p.git('write-tree', extra_env=env).stdout.decode().strip()
        commit = p.git('commit-tree', tree, '-p', head, input=b'test edit\n').stdout.decode().strip()
        p.git('push', 'origin', commit + ':refs/heads/main')
        return commit

    def test_preview_read_only_and_search_handles_existing_ids(self):
        p.publish(EXAMPLE)
        self.change('public/markdown/2026010101.md', '---\ntitle: 旧文章\n---\n正文'.encode())
        head = self.remote('rev-parse', 'main')
        result = p.list_articles('旧文章')
        self.assertEqual(result['articles'][0]['id'], '2026010101')
        preview = p.prepare_delete({'article_id': '2026010101', 'message_id': 'om_preview'})
        self.assertEqual(preview['title'], '旧文章')
        self.assertEqual(preview['url'], p.BASE + '/article/2026010101')
        self.assertEqual(self.remote('rev-parse', 'main'), head)

    def test_rejects_unsafe_paths_and_symlinks(self):
        p.publish(EXAMPLE)
        for article in ['../x', '.github/workflows/x', 'a/b', '--all', 'a.md', '', None]:
            with self.subTest(article=article), self.assertRaises(ValueError):
                p.prepare_delete({'article_id': article, 'message_id': 'om_x'})
        self.change('public/markdown/link.md', b'../../untouched.txt', '120000')
        with self.assertRaisesRegex(ValueError, 'regular Markdown'):
            p.prepare_delete({'article_id': 'link', 'message_id': 'om_x'})
        self.assertEqual(p.list_articles()['total'], 1)

    def test_wrong_code_same_message_and_expiry_preserve_head(self):
        _, preview, confirmation = self.prepare()
        head = self.remote('rev-parse', 'main')
        for payload in [{**confirmation, 'confirmation_text': '确认删除 WRONG'},
                        {**confirmation, 'confirmation_message_id': 'om_delete'}]:
            with self.assertRaises(ValueError):
                p.confirm_delete(payload)
        with patch.object(p.time, 'time', return_value=preview['expires_at'] + 1):
            with self.assertRaisesRegex(ValueError, 'expired'):
                p.confirm_delete(confirmation)
        self.assertEqual(self.remote('rev-parse', 'main'), head)

    def test_deletes_exact_file_preserves_concurrent_changes_and_recoverable_history(self):
        article, _, confirmation = self.prepare()
        self.change('public/markdown/other.md', b'other article')
        before = self.remote('rev-parse', 'main').decode().strip()
        job = p.confirm_delete(confirmation)
        path = 'public/markdown/' + article['id'] + '.md'
        self.assertEqual(job['previous_commit'], before)
        self.assertEqual(self.remote('diff-tree', '--no-commit-id', '--name-only', '-r', 'main').decode().strip(), path)
        self.assertEqual(self.remote('show', 'main:public/markdown/other.md'), b'other article')
        self.assertEqual(self.remote('show', 'main:untouched.txt'), b'Keep existing files\n')
        self.assertEqual(self.remote('show', 'main^:' + path), p.validate(EXAMPLE)[1])
        head = self.remote('rev-parse', 'main')
        self.assertEqual(p.confirm_delete(confirmation), job)
        self.assertEqual(self.remote('rev-parse', 'main'), head)
        self.change(path, b'manually restored article')
        restored = self.remote('rev-parse', 'main')
        self.assertEqual(p.confirm_delete(confirmation), job)
        self.assertEqual(self.remote('rev-parse', 'main'), restored)

    def test_modified_article_requires_new_preview(self):
        article, _, confirmation = self.prepare()
        self.change('public/markdown/' + article['id'] + '.md', b'changed after preview')
        head = self.remote('rev-parse', 'main')
        with self.assertRaisesRegex(ValueError, 'changed after preview'):
            p.confirm_delete(confirmation)
        self.assertEqual(self.remote('rev-parse', 'main'), head)

    def test_delete_ambiguous_push_is_recovered(self):
        _, _, confirmation = self.prepare()
        original = p.git
        def uncertain(*args, **kwargs):
            result = original(*args, **kwargs)
            if args[0] == 'push':
                result.returncode = 1
            return result
        with patch.object(p, 'git', side_effect=uncertain):
            job = p.confirm_delete(confirmation)
        self.assertEqual(job['state'], 'submitted')
        self.assertEqual(self.remote('rev-list', '--count', 'main').strip(), b'3')

    def test_failed_push_cannot_be_blindly_retried(self):
        _, _, confirmation = self.prepare()
        head = self.remote('rev-parse', 'main')
        original = p.git
        def fail(*args, **kwargs):
            if args[0] == 'push':
                return subprocess.CompletedProcess([], 1, b'', b'network down')
            return original(*args, **kwargs)
        with patch.object(p, 'git', side_effect=fail):
            with self.assertRaises(RuntimeError):
                p.confirm_delete(confirmation)
        with self.assertRaisesRegex(ValueError, 'new preview'):
            p.confirm_delete(confirmation)
        self.assertEqual(self.remote('rev-parse', 'main'), head)

    def test_crash_after_push_recovers_without_second_commit(self):
        _, _, confirmation = self.prepare()
        with patch.object(p, 'complete_delete', side_effect=RuntimeError('simulated crash')):
            with self.assertRaises(RuntimeError):
                p.confirm_delete(confirmation)
        head = self.remote('rev-parse', 'main')
        self.assertEqual(p.confirm_delete(confirmation)['state'], 'submitted')
        self.assertEqual(self.remote('rev-parse', 'main'), head)

    def test_old_publish_retry_does_not_resurrect_deleted_article(self):
        _, _, confirmation = self.prepare()
        p.confirm_delete(confirmation)
        head = self.remote('rev-parse', 'main')
        with self.assertRaisesRegex(ValueError, 'refusing to recreate'):
            p.publish(EXAMPLE)
        self.assertEqual(self.remote('rev-parse', 'main'), head)

    def test_removed_requires_healthy_shell_and_article_absent(self):
        _, _, confirmation = self.prepare()
        job = p.confirm_delete(confirmation)
        shell = b'<html><div id="app"></div><script src="/blog/assets/a.js"></script></html>'
        for body, expected in [(b'old article', 'deploying'), (b'<html>different error</html>', 'deploying'), (shell, 'removed')]:
            with self.subTest(body=body), patch.object(p.urllib.request, 'urlopen', side_effect=[io.BytesIO(shell), io.BytesIO(body)]):
                self.assertEqual(p.status(job['id'])['state'], expected)
        for code, expected in [(404, 'removed'), (410, 'removed'), (503, 'deploying')]:
            error = p.urllib.error.HTTPError('url', code, 'error', {}, None)
            with self.subTest(code=code), patch.object(p.urllib.request, 'urlopen', side_effect=[io.BytesIO(shell), error]):
                self.assertEqual(p.status(job['id'])['state'], expected)
        with patch.object(p.urllib.request, 'urlopen', return_value=io.BytesIO(b'<html>unhealthy</html>')):
            self.assertEqual(p.status(job['id'])['state'], 'deploying')
        with patch.object(p.urllib.request, 'urlopen', side_effect=p.urllib.error.URLError('offline')):
            self.assertEqual(p.status(job['id'])['state'], 'deploying')


if __name__ == '__main__':
    unittest.main()
