#!/usr/bin/env python3
"""Exercise real release scripts with local files and a simulated transport.

This checks activation/rollback safety, not live SSH, HTTP, or TLS behavior.
"""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]
REMOTE = '/srv/bendavisbuilds'
TRANSPORT = r'''#!/usr/bin/env python3
from pathlib import Path
import os, shutil, subprocess, sys
root = Path(os.environ['TEST_REMOTE'])
name = Path(sys.argv[0]).name
if name == 'ssh':
    command = sys.argv[-1].replace('/srv/bendavisbuilds', str(root))
    result = subprocess.run(command, shell=True, stdin=sys.stdin, stdout=subprocess.PIPE, text=True)
    sys.stdout.write(result.stdout.replace(str(root), '/srv/bendavisbuilds'))
    raise SystemExit(result.returncode)
elif name == 'rsync':
    if '--dry-run' not in sys.argv:
        source = Path(sys.argv[-2])
        dest = Path(sys.argv[-1].split(':', 1)[1].replace('/srv/bendavisbuilds', str(root)))
        shutil.copytree(source, dest, dirs_exist_ok=True)
elif name == 'curl':
    url = sys.argv[-1]
    if url.endswith('/health.txt'):
        print('wrong-release' if os.environ.get('TEST_FAIL_HEALTH') else (root / 'current/health.txt').read_text().strip())
    else:
        print('404' if 'nonexistent-release-check' in url else '200', end='')
'''


class Releases(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='built-signal-release-test-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.remote = self.base / 'remote'
        bootstrap = self.remote / 'releases/bootstrap'
        bootstrap.mkdir(parents=True)
        (bootstrap / 'index.html').write_text('bootstrap')
        (bootstrap / 'health.txt').write_text('bootstrap\n')
        (self.remote / 'current').symlink_to(bootstrap)
        self.artifact = self.base / 'artifact'
        self.artifact.mkdir()
        (self.artifact / 'index.html').write_text('new static site')
        (self.artifact / '404.html').write_text('not found')
        binary = self.base / 'bin'
        binary.mkdir()
        for name in ('ssh', 'rsync', 'curl'):
            script = binary / name
            script.write_text(TRANSPORT)
            script.chmod(0o755)
        for name in ('key', 'known-hosts'):
            (self.base / name).write_text('test fixture, not a credential')
        self.env = {**os.environ, 'PATH': str(binary) + ':' + os.environ['PATH'],
                    'TEST_REMOTE': str(self.remote), 'DEPLOY_HOST': 'example.invalid',
                    'DEPLOY_USER': 'deploy', 'DEPLOY_KEY': str(self.base / 'key'),
                    'DEPLOY_KNOWN_HOSTS': str(self.base / 'known-hosts'),
                    'DEPLOY_HEALTH_URL': 'https://example.invalid', 'RELEASE_ID': 'test-release'}

    def run_script(self, script, *args, **variables):
        return subprocess.run(['bash', str(SOURCE / 'scripts' / script), *args],
                              env={**self.env, **variables}, text=True, capture_output=True)

    def test_activation_and_explicit_rollback(self):
        result = self.run_script('deploy.sh', str(self.artifact))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.remote / 'current/health.txt').read_text().strip(), 'test-release')
        self.assertFalse((self.remote / '.deploy-lock').exists())
        self.assertEqual((self.remote / 'releases/bootstrap/index.html').read_text(), 'bootstrap')
        result = self.run_script('rollback.sh', 'bootstrap')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.remote / 'current/health.txt').read_text().strip(), 'bootstrap')

    def test_failed_health_restores_previous_release(self):
        result = self.run_script('deploy.sh', str(self.artifact), TEST_FAIL_HEALTH='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.remote / 'current/health.txt').read_text().strip(), 'bootstrap')
        self.assertFalse((self.remote / '.deploy-lock').exists())

    def test_invalid_rollback_keeps_current_and_releases_lock(self):
        result = self.run_script('rollback.sh', 'missing-release')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.remote / 'current/health.txt').read_text().strip(), 'bootstrap')
        self.assertFalse((self.remote / '.deploy-lock').exists())

    def test_source_and_symlinks_are_rejected_before_transfer(self):
        (self.artifact / 'private-link').symlink_to(self.base / 'key')
        self.assertNotEqual(self.run_script('deploy.sh', str(self.artifact)).returncode, 0)
        (self.artifact / 'private-link').unlink()
        (self.artifact / 'package.json').write_text('{}')
        self.assertNotEqual(self.run_script('deploy.sh', str(self.artifact)).returncode, 0)
        self.assertFalse((self.remote / 'releases/test-release').exists())

    def test_existing_release_is_never_overwritten(self):
        directory = self.remote / 'releases/test-release'
        directory.mkdir()
        (directory / 'index.html').write_text('keep me')
        self.assertNotEqual(self.run_script('deploy.sh', str(self.artifact)).returncode, 0)
        self.assertEqual((directory / 'index.html').read_text(), 'keep me')
        self.assertFalse((self.remote / '.deploy-lock').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
