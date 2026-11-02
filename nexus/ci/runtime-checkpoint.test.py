# SPDX-License-Identifier: MIT
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('checkpoint', Path(__file__).with_name('runtime-checkpoint.py'))
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.root = Path(self.scratch.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.source)], check=True)
        (self.source / 'tracked').write_text('source')
        subprocess.run(['git', 'add', '.'], cwd=self.source, check=True)
        subprocess.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], cwd=self.source, check=True)
        self.sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.source, text=True).strip()
        self.temp = self.root / 'runner-temp'
        self.temp.mkdir()
        self.output, self.fixtures = self.temp / 'nexus-output', self.temp / 'nexus-fixtures'
        self.output.mkdir()
        self.fixtures.mkdir()
        self.runtime_name = cp.distribution_identity()[1] + '-g' + self.sha[:8]
        self.runtime = self.output / self.runtime_name
        (self.runtime / 'files/bin').mkdir(parents=True)
        self.binary = self.runtime / 'files/bin/wine'
        self.binary.write_bytes(b'unchanged synthetic executable')
        self.binary.chmod(0o755)
        (self.runtime / 'files/bin/wine64').symlink_to('wine')
        dos = self.runtime / 'files/share/default_pfx/dosdevices'
        dos.mkdir(parents=True)
        (dos / 'z:').symlink_to('/')
        aux = self.temp / 'nexus-auxiliary'
        aux.mkdir()
        (aux / 'auxiliary.json').write_text('{}')
        for name in ['components', 'nghttp2-src', 'media/stage']:
            (aux / name).mkdir(parents=True)
        (aux / 'media/media-manifest.json').write_text('{"version":"4.4.8"}')
        (aux / 'media/ffmpeg-4.4.8.tar.xz').write_bytes(b'synthetic corresponding source')
        prepared = self.temp / 'nexus-work'
        (prepared / 'runtime-dependency-sources').mkdir(parents=True)
        (prepared / 'prepared.json').write_text('{}')
        (prepared / 'source-module-plan.json').write_text('{"required":["wine"],"excluded":["zluda-libs/rocm-systems"]}')
        self.built = {'graph': {'proton': self.sha}, 'source': str(self.source), 'runtime': str(self.runtime),
                      'aux': str(aux), 'prepared': str(prepared), 'metadata': {}, 'name': self.runtime_name}
        (self.output / 'built.json').write_text(json.dumps(self.built))
        (self.fixtures / 'fixtures.json').write_text(json.dumps({'sourceGraph': self.built['graph']}))
        (self.fixtures / 'probe.exe').write_bytes(b'unchanged fixture')
        self.checkpoint = self.root / 'checkpoint'
        self.env = patch.dict(os.environ, {'GITHUB_REPOSITORY': cp.distribution_identity()[0], 'GITHUB_REF': 'refs/heads/main',
                 'GITHUB_SHA': self.sha, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_WORKSPACE': str(self.source), 'RUNNER_TEMP': str(self.temp)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.scratch.cleanup)

    def destination(self):
        source = self.root / 'other-source'
        subprocess.run(['git', 'clone', '-q', str(self.source), str(source)], check=True)
        temp = self.root / 'other-temp'
        temp.mkdir()
        return source, temp

    def test_roundtrip_variants_and_default_both_architectures_relocates_only_paths(self):
        identities = [('domsvoboda/nexus-runtime-cachyos', 'nexus-runtime-cachyos-11.0-experimental', 'x86_64'),
                      ('domsvoboda/nexus-runtime', 'nexus-runtime-11.0-experimental', 'x86_64'),
                      ('domsvoboda/nexus-runtime', 'nexus-runtime-11.0-experimental', 'arm64')]
        for index, (repository, prefix, arch) in enumerate(identities):
            with self.subTest(repository=repository, arch=arch), patch.object(cp, 'distribution_identity', return_value=(repository, prefix)), patch.dict(os.environ, {'GITHUB_REPOSITORY': repository}):
                name = cp.runtime_name(self.sha, arch)
                runtime = self.output / name
                if runtime != self.runtime:
                    shutil.copytree(self.runtime, runtime, symlinks=True)
                self.built.update(name=name, runtime=str(runtime))
                self.built['metadata']['targetArchitecture'] = arch
                (self.output / 'built.json').write_text(json.dumps(self.built))
                bundle = self.root / ('checkpoint-' + str(index))
                cp.create(self.output, self.fixtures, bundle)
                source = self.root / ('destination-' + str(index))
                subprocess.run(['git', 'clone', '-q', str(self.source), str(source)], check=True)
                temp = self.root / ('temp-' + str(index))
                temp.mkdir()
                with patch.dict(os.environ, {'GITHUB_WORKSPACE': str(source), 'RUNNER_TEMP': str(temp)}):
                    cp.restore(bundle, arch)
                restored = temp / 'nexus-output' / name / 'files/bin/wine'
                self.assertEqual(restored.read_bytes(), self.binary.read_bytes())
                self.assertEqual(restored.stat().st_mode & 0o777, 0o755)
                self.assertEqual(os.readlink(restored.with_name('wine64')), 'wine')
                self.assertEqual(os.readlink(temp / 'nexus-output' / name / 'files/share/default_pfx/dosdevices/z:'), '/')
                self.assertEqual(json.loads((temp / 'nexus-output/built.json').read_text())['source'], str(source))
                self.assertEqual(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source), (self.sha+'\n').encode())
                self.assertEqual((temp / 'nexus-fixtures/probe.exe').read_bytes(), b'unchanged fixture')
                self.assertEqual((temp / 'nexus-work/source-module-plan.json').read_text(), '{"required":["wine"],"excluded":["zluda-libs/rocm-systems"]}')

    def test_cachyos_arm_checkpoint_is_not_enabled_by_default_arm_support(self):
        with self.assertRaisesRegex(ValueError, 'Unreviewed checkpoint architecture'):
            cp.runtime_name(self.sha, 'arm64')

    def enable_xml_fixture(self):
        import hashlib
        names = ['parser.c', 'COPYING', 'AUTHORS'] + ['file-%02d' % n for n in range(96)]
        files = {name: hashlib.sha256(('fixture:' + name).encode()).hexdigest() for name in names}
        lock = json.dumps({'files': files}).encode()
        pin = {'repository': 'ValveSoftware/wine', 'commit': '7fc704ef49c50e9702c9983a5250d5738697bb04',
               'subtree': 'libs/xml2', 'tree': '27d5326b87ecf1c4042507bb9937a98961f2de0a',
               'lockSha256': hashlib.sha256(lock).hexdigest()}
        target = self.source / 'wine/dlls/xgameruntime/cmake/xml2.lock.json'
        target.parent.mkdir(parents=True)
        target.write_bytes(lock)
        (self.source / 'nexus').mkdir()
        (self.source / 'nexus/inputs.lock.json').write_text(json.dumps({'xml2Source': pin}))
        subprocess.run(['git', 'add', '.'], cwd=self.source, check=True)
        subprocess.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'XML fixture'], cwd=self.source, check=True)
        self.sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.source, text=True).strip()
        os.environ['GITHUB_SHA'] = self.sha
        name = cp.runtime_name(self.sha, 'x86_64')
        runtime = self.output / name
        self.runtime.rename(runtime)
        self.runtime, self.runtime_name, self.binary = runtime, name, runtime / 'files/bin/wine'
        self.built.update(name=name, runtime=str(runtime), inputs={'xml2Source': pin}, graph={'proton': self.sha, 'xml2Source': pin})
        (self.output / 'built.json').write_text(json.dumps(self.built))
        (self.fixtures / 'fixtures.json').write_text(json.dumps({'sourceGraph': self.built['graph']}))
        work = self.temp / 'nexus-work'
        (work / 'xgr-xml2-source').mkdir()
        for name in names:
            (work / 'xgr-xml2-source' / name).write_text('fixture:' + name)
        (work / 'xgr-xml2-source.json').write_text(json.dumps({'schema': 1, 'identity': pin, 'files': files,
            'licenses': {name: files[name] for name in ['COPYING', 'AUTHORS']}}))
        return pin, work

    def test_strict_xml_source_roundtrip_preserves_files_identity_and_licenses(self):
        pin, work = self.enable_xml_fixture()
        cp.create(self.output, self.fixtures, self.checkpoint)
        source, temp = self.destination()
        with patch.dict(os.environ, {'GITHUB_WORKSPACE': str(source), 'RUNNER_TEMP': str(temp)}):
            cp.restore(self.checkpoint, 'x86_64')
        cp.verify_xml_source(source, temp / 'nexus-work', pin)
        for name in ['parser.c', 'COPYING', 'AUTHORS']:
            self.assertEqual((temp / 'nexus-work/xgr-xml2-source' / name).read_bytes(), (work / 'xgr-xml2-source' / name).read_bytes())

    def test_strict_xml_identity_cannot_be_omitted_from_checkpoint(self):
        pin, work = self.enable_xml_fixture()
        with self.assertRaises(ValueError):
            cp.verify_xml_source(self.source, work, None)

    def test_strict_xml_changed_missing_extra_and_redirected_files_rejected(self):
        pin, work = self.enable_xml_fixture()
        file = work / 'xgr-xml2-source/parser.c'
        original = file.read_bytes()
        file.write_bytes(b'changed parser')
        with self.assertRaises(ValueError):
            cp.verify_xml_source(self.source, work, pin)
        file.unlink()
        with self.assertRaises(ValueError):
            cp.verify_xml_source(self.source, work, pin)
        file.write_bytes(original)
        extra = work / 'xgr-xml2-source/extra'
        extra.write_text('new file')
        with self.assertRaises(ValueError):
            cp.verify_xml_source(self.source, work, pin)
        extra.unlink()
        file.unlink()
        file.symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):
            cp.verify_xml_source(self.source, work, pin)

    def test_strict_xml_metadata_external_link_rejected_before_checkpoint(self):
        pin, work = self.enable_xml_fixture()
        manifest = work / 'xgr-xml2-source.json'
        outside = self.temp / 'identical-xml-metadata.json'
        manifest.rename(outside)
        manifest.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'Redirected strict XML provenance'):
            cp.verify_xml_source(self.source, work, pin)
        with self.assertRaisesRegex(ValueError, 'Redirected strict XML provenance'):
            cp.create(self.output, self.fixtures, self.checkpoint)
        manifest.unlink()
        outside.rename(manifest)
        alias = self.temp / 'redirected-work'
        alias.symlink_to(work)
        with self.assertRaisesRegex(ValueError, 'Redirected strict XML provenance'):
            cp.verify_xml_source(self.source, alias, pin)

    def test_checkpoint_rerun_accepts_original_producer_not_foreign_run(self):
        cp.create(self.output, self.fixtures, self.checkpoint)
        for changes in [{'GITHUB_RUN_ID': '124'}, {'GITHUB_RUN_ATTEMPT': '0'}]:
            with patch.dict(os.environ, changes), self.assertRaises(ValueError):
                cp.restore(self.checkpoint, 'x86_64')
        info = cp.read(self.checkpoint / 'checkpoint.json')
        info['producer']['attempt'] = 3
        (self.checkpoint / 'checkpoint.json').write_text(json.dumps(info))
        with patch.dict(os.environ, {'GITHUB_RUN_ATTEMPT': '2'}), self.assertRaisesRegex(ValueError, 'Wrong checkpoint producer'):
            cp.restore(self.checkpoint, 'x86_64')
        info['producer']['attempt'] = 1
        (self.checkpoint / 'checkpoint.json').write_text(json.dumps(info))
        source, temp = self.destination()
        with patch.dict(os.environ, {'GITHUB_WORKSPACE': str(source), 'RUNNER_TEMP': str(temp), 'GITHUB_RUN_ATTEMPT': '2'}):
            cp.restore(self.checkpoint, 'x86_64')
        self.assertEqual((temp / 'nexus-output' / self.runtime_name / 'files/bin/wine').read_bytes(), self.binary.read_bytes())

    def test_corrupt_archive_rejected_before_writes(self):
        cp.create(self.output, self.fixtures, self.checkpoint)
        with (self.checkpoint / 'output.tar.zst').open('ab') as f:
            f.write(b'corruption')
        source, temp = self.destination()
        with patch.dict(os.environ, {'GITHUB_WORKSPACE': str(source), 'RUNNER_TEMP': str(temp)}):
            with self.assertRaisesRegex(ValueError, 'Wrong or changed'):
                cp.restore(self.checkpoint, 'x86_64')
        self.assertEqual(list(temp.iterdir()), [])

    def test_wrong_source_architecture_and_existing_work_rejected(self):
        cp.create(self.output, self.fixtures, self.checkpoint)
        with patch.dict(os.environ, {'GITHUB_SHA': 'a'*40}):
            with self.assertRaisesRegex(ValueError, 'Wrong or changed'):
                cp.restore(self.checkpoint, 'x86_64')
        with self.assertRaisesRegex(ValueError, 'Wrong or changed'):
            cp.restore(self.checkpoint, 'arm64')
        with self.assertRaisesRegex(ValueError, 'Do not overwrite'):
            cp.restore(self.checkpoint, 'x86_64')

    def test_fork_context_and_unsafe_archive_members_rejected(self):
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'fork/nexus-runtime'}):
            with self.assertRaises(ValueError):
                cp.context()
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'domsvoboda/nexus-runtime'}):
            with self.assertRaises(ValueError):
                cp.context()
        for name in ['../escape', '/absolute', '.git/config', 'runtime/files/share/default_pfx/dosdevices/z:/escape']:
            with self.assertRaises(ValueError):
                cp.safe_member(tarfile.TarInfo(name), str(self.root))
        internal = tarfile.TarInfo('metadata')
        internal.type, internal.linkname = tarfile.SYMTYPE, '.git'
        with self.assertRaises(ValueError):
            cp.safe_member(internal, str(self.root))
        link = tarfile.TarInfo('outside')
        link.type, link.linkname = tarfile.SYMTYPE, '/tmp'
        with self.assertRaises(tarfile.FilterError):
            cp.safe_member(link, str(self.root))


if __name__ == '__main__':
    unittest.main()
