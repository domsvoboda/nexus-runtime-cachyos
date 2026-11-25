# SPDX-License-Identifier: MIT
"""Exercise Proton's real optional-helper updater without importing its launcher."""
import ast
import errno
import io
import os
from pathlib import Path
import shutil
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

source = Path(__file__).resolve().parents[1] / 'proton'
tree = ast.parse(source.read_text())
compat = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'CompatData')
method = next(node for node in compat.body if isinstance(node, ast.FunctionDef) and node.name == 'copy_native_text_entry')
setup = next(node for node in compat.body if isinstance(node, ast.FunctionDef) and node.name == 'setup_prefix')
assert any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'copy_native_text_entry' for node in ast.walk(setup))
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ('try_copy', 'file_exists')]
namespace = dict(os=os, shutil=shutil, stat=stat, errno=errno, copyfile=shutil.copyfile, log=lambda *_: None)
exec(compile(ast.Module(body=functions + [method], type_ignores=[]), str(source), 'exec'), namespace)


class ExistingPrefix(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='native entry prefix ')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.default = self.root / 'runtime default prefix'
        self.prefix = self.root / 'existing game prefix'
        for folder in ('system32', 'syswow64'):
            (self.prefix / 'drive_c/windows' / folder).mkdir(parents=True)
        self.source = self.default / 'drive_c/windows/system32/nexus-text-entry.py'
        self.source.parent.mkdir(parents=True)
        self.save = self.prefix / 'save.dat'
        self.save.write_bytes(b'unchanged-user-data')
        self.tracking = io.StringIO()
        namespace['g_proton'] = SimpleNamespace(default_pfx_dir=str(self.default))
        self.context = SimpleNamespace(prefix_dir=str(self.prefix))

    def populate_default(self, directories=('system32', 'syswow64')):
        for directory in directories:
            folder = self.default / 'drive_c/windows' / directory
            folder.mkdir(parents=True, exist_ok=True)
            (folder / 'nexus-text-entry.py').write_bytes(b'first SDK helper\n')
            (folder / 'nexus-text-entry-host.exe').write_bytes(b'MZ ' + directory.encode())

    def sync(self):
        namespace['copy_native_text_entry'](self.context, self.tracking)
        self.assertEqual(self.save.read_bytes(), b'unchanged-user-data')

    def test_old_runtime_without_helper_leaves_existing_prefix_untouched(self):
        before = sorted(str(p.relative_to(self.prefix)) for p in self.prefix.rglob('*'))
        self.sync()
        self.assertEqual(before, sorted(str(p.relative_to(self.prefix)) for p in self.prefix.rglob('*')))
        self.assertEqual(self.tracking.getvalue(), '')

    def test_existing_x64_and_wow64_prefixes_receive_and_refresh_exact_helper(self):
        (self.prefix / 'dosdevices').mkdir()
        (self.prefix / 'dosdevices/c:').symlink_to('../drive_c')
        self.populate_default()
        self.sync()
        for directory in ('system32', 'syswow64'):
            for name in ('nexus-text-entry.py', 'nexus-text-entry-host.exe'):
                self.assertEqual((self.prefix / 'drive_c/windows' / directory / name).read_bytes(),
                                 (self.default / 'drive_c/windows' / directory / name).read_bytes())
        self.assertEqual(len(self.tracking.getvalue().splitlines()), 4)
        self.assertEqual(os.readlink(self.prefix / 'dosdevices/c:'), '../drive_c')
        for directory in ('system32', 'syswow64'):
            (self.default / 'drive_c/windows' / directory / self.source.name).write_bytes(b'updated SDK helper\n')
        self.sync()
        for directory in ('system32', 'syswow64'):
            self.assertEqual((self.prefix / 'drive_c/windows' / directory / self.source.name).read_bytes(), b'updated SDK helper\n')
        self.assertEqual(len(self.tracking.getvalue().splitlines()), 4)
        self.assertEqual(os.readlink(self.prefix / 'dosdevices/c:'), '../drive_c')

    def test_single_architecture_prefix_does_not_gain_a_fake_windows_directory(self):
        shutil.rmtree(self.prefix / 'drive_c/windows/syswow64')
        self.source.write_bytes(b'helper\n')
        (self.source.with_name('nexus-text-entry-host.exe')).write_bytes(b'MZ x86_64')
        self.sync()
        self.assertFalse((self.prefix / 'drive_c/windows/syswow64').exists())
        self.assertEqual(len(self.tracking.getvalue().splitlines()), 2)

    def test_prefix_aliasing_the_default_prefix_never_deletes_its_own_helper(self):
        self.populate_default()
        before = {(directory, name): (self.default / 'drive_c/windows' / directory / name).read_bytes()
                  for directory in ('system32', 'syswow64')
                  for name in ('nexus-text-entry.py', 'nexus-text-entry-host.exe')}
        alias = self.root / 'game prefix pfx symlink'
        alias.symlink_to(self.default, target_is_directory=True)
        self.context = SimpleNamespace(prefix_dir=str(alias))
        self.sync()
        for (directory, name), content in before.items():
            self.assertEqual((self.default / 'drive_c/windows' / directory / name).read_bytes(), content)
            self.assertEqual((alias / 'drive_c/windows' / directory / name).read_bytes(), content)
        self.assertEqual(self.tracking.getvalue(), '')

    def test_prefix_directory_symlink_escaping_the_prefix_is_not_written(self):
        self.populate_default()
        shutil.rmtree(self.prefix / 'drive_c/windows/syswow64')
        outside = self.root / 'hostile target'
        outside.mkdir()
        (outside / 'marker.txt').write_bytes(b'host data')
        system32 = self.prefix / 'drive_c/windows/system32'
        shutil.rmtree(system32)
        system32.symlink_to(outside, target_is_directory=True)
        self.sync()
        self.assertFalse((outside / 'nexus-text-entry.py').exists())
        self.assertFalse((outside / 'nexus-text-entry-host.exe').exists())
        self.assertEqual((outside / 'marker.txt').read_bytes(), b'host data')
        self.assertEqual(self.tracking.getvalue(), '')

    def test_incomplete_default_component_does_not_mix_prefix_versions(self):
        for directory in ('system32', 'syswow64'):
            folder = self.prefix / 'drive_c/windows' / directory
            (folder / 'nexus-text-entry.py').write_bytes(b'old python ' + directory.encode())
            (folder / 'nexus-text-entry-host.exe').write_bytes(b'MZ old ' + directory.encode())
        self.source.write_bytes(b'new python only')
        self.sync()
        for directory in ('system32', 'syswow64'):
            folder = self.prefix / 'drive_c/windows' / directory
            self.assertEqual((folder / 'nexus-text-entry.py').read_bytes(), b'old python ' + directory.encode())
            self.assertEqual((folder / 'nexus-text-entry-host.exe').read_bytes(), b'MZ old ' + directory.encode())
        self.assertEqual(self.tracking.getvalue(), '')

    def test_second_replacement_failure_restores_the_whole_pair(self):
        for directory in ('system32', 'syswow64'):
            folder = self.prefix / 'drive_c/windows' / directory
            (folder / 'nexus-text-entry.py').write_bytes(b'old python ' + directory.encode())
            (folder / 'nexus-text-entry-host.exe').write_bytes(b'MZ old ' + directory.encode())
        self.populate_default()
        calls = []
        original_replace = os.replace
        def replace(source, destination):
            calls.append(destination)
            if len(calls) == 2:
                raise OSError(errno.EIO, 'injected second replacement failure')
            return original_replace(source, destination)
        with mock.patch.object(os, 'replace', replace):
            with self.assertRaises(OSError):
                namespace['copy_native_text_entry'](self.context, self.tracking)
        for directory in ('system32', 'syswow64'):
            folder = self.prefix / 'drive_c/windows' / directory
            self.assertEqual((folder / 'nexus-text-entry.py').read_bytes(), b'old python ' + directory.encode())
            self.assertEqual((folder / 'nexus-text-entry-host.exe').read_bytes(), b'MZ old ' + directory.encode())
        self.assertEqual(self.tracking.getvalue(), '')
        self.assertEqual(self.save.read_bytes(), b'unchanged-user-data')

    def test_second_failure_restores_symlink_and_absent_entries(self):
        shutil.rmtree(self.prefix / 'drive_c/windows/syswow64')
        target = self.root / 'preexisting helper target'
        target.write_bytes(b'preexisting target bytes')
        folder = self.prefix / 'drive_c/windows/system32'
        (folder / 'nexus-text-entry.py').symlink_to(target)
        self.populate_default(('system32',))
        calls = []
        original_replace = os.replace
        def replace(source, destination):
            calls.append(destination)
            if len(calls) == 2:
                raise OSError(errno.EIO, 'injected second replacement failure')
            return original_replace(source, destination)
        with mock.patch.object(os, 'replace', replace):
            with self.assertRaises(OSError):
                namespace['copy_native_text_entry'](self.context, self.tracking)
        self.assertTrue(os.path.islink(folder / 'nexus-text-entry.py'))
        self.assertEqual(os.readlink(folder / 'nexus-text-entry.py'), str(target))
        self.assertFalse((folder / 'nexus-text-entry-host.exe').exists())
        self.assertEqual(self.tracking.getvalue(), '')
        self.assertEqual(self.save.read_bytes(), b'unchanged-user-data')

    def test_contained_cross_architecture_directory_alias_is_rejected(self):
        for directory in ('system32', 'syswow64'):
            folder = self.prefix / 'drive_c/windows' / directory
            (folder / 'nexus-text-entry.py').write_bytes(b'old python ' + directory.encode())
            (folder / 'nexus-text-entry-host.exe').write_bytes(b'MZ old ' + directory.encode())
        self.populate_default()
        wow = self.prefix / 'drive_c/windows/syswow64'
        shutil.rmtree(wow)
        wow.symlink_to('system32', target_is_directory=True)
        self.sync()
        system = self.prefix / 'drive_c/windows/system32'
        self.assertEqual((system / 'nexus-text-entry.py').read_bytes(), b'old python system32')
        self.assertEqual((system / 'nexus-text-entry-host.exe').read_bytes(), b'MZ old system32')
        self.assertEqual(os.readlink(wow), 'system32')
        self.assertEqual(self.tracking.getvalue(), '')

    def test_cross_architecture_alias_is_rejected_when_only_one_pair_exists(self):
        system = self.prefix / 'drive_c/windows/system32'
        wow = self.prefix / 'drive_c/windows/syswow64'
        shutil.rmtree(wow)
        wow.symlink_to('system32', target_is_directory=True)
        self.populate_default(('syswow64',))
        self.sync()
        self.assertFalse((system / 'nexus-text-entry.py').exists())
        self.assertFalse((system / 'nexus-text-entry-host.exe').exists())
        self.assertEqual(self.tracking.getvalue(), '')

    def test_destination_alias_into_default_source_is_rejected(self):
        inside_default = self.prefix / 'runtime default prefix'
        for directory in ('system32', 'syswow64'):
            folder = inside_default / 'drive_c/windows' / directory
            folder.mkdir(parents=True)
            (folder / 'nexus-text-entry.py').write_bytes(b'default python ' + directory.encode())
            (folder / 'nexus-text-entry-host.exe').write_bytes(b'MZ default ' + directory.encode())
        namespace['g_proton'] = SimpleNamespace(default_pfx_dir=str(inside_default))
        wow = self.prefix / 'drive_c/windows/syswow64'
        shutil.rmtree(wow)
        wow.symlink_to(inside_default / 'drive_c/windows/system32', target_is_directory=True)
        self.sync()
        source = inside_default / 'drive_c/windows/system32'
        self.assertEqual((source / 'nexus-text-entry.py').read_bytes(), b'default python system32')
        self.assertEqual((source / 'nexus-text-entry-host.exe').read_bytes(), b'MZ default system32')
        self.assertFalse((self.prefix / 'drive_c/windows/system32/nexus-text-entry.py').exists())
        self.assertFalse((self.prefix / 'drive_c/windows/system32/nexus-text-entry-host.exe').exists())
        self.assertEqual(self.tracking.getvalue(), '')

    def test_persistent_disk_full_restores_prior_entries_without_allocating(self):
        # system32 holds a prior regular helper with a non-default mode,
        # syswow64 a prior symlink, and both architecture directories lack a
        # bridge. The tracking write fails with ENOSPC and file creation keeps
        # failing, so this passes only if rollback renames prior entries that
        # were staged before the first replacement.
        system = self.prefix / 'drive_c/windows/system32'
        wow = self.prefix / 'drive_c/windows/syswow64'
        regular = system / 'nexus-text-entry.py'
        regular.write_bytes(b'prior regular helper bytes')
        regular.chmod(0o640)
        target = self.root / 'prior helper target'
        target.write_bytes(b'unchanged symlink target')
        linked = wow / 'nexus-text-entry.py'
        linked.symlink_to(target)
        self.populate_default()
        full = []
        original_open = os.open

        def open_file(path, flags, *args, **kwargs):
            if full and flags & os.O_CREAT:
                raise OSError(errno.ENOSPC, 'filesystem still full during rollback')
            return original_open(path, flags, *args, **kwargs)

        class FailingTracking(io.StringIO):
            def write(self, value):
                full.append(True)
                raise OSError(errno.ENOSPC, 'injected tracking failure')

        self.tracking = FailingTracking()
        with mock.patch.object(os, 'open', open_file):
            with self.assertRaises(OSError):
                namespace['copy_native_text_entry'](self.context, self.tracking)
        self.assertEqual(regular.read_bytes(), b'prior regular helper bytes')
        self.assertEqual(stat.S_IMODE(regular.stat().st_mode), 0o640)
        self.assertTrue(os.path.islink(linked))
        self.assertEqual(os.readlink(linked), str(target))
        for folder in (system, wow):
            self.assertEqual(sorted(entry.name for entry in folder.iterdir()), ['nexus-text-entry.py'])
        self.assertEqual(self.tracking.getvalue(), '')
        self.assertEqual(target.read_bytes(), b'unchanged symlink target')
        self.assertEqual(self.save.read_bytes(), b'unchanged-user-data')

    def test_tracking_failure_restores_the_whole_pair(self):
        self.populate_default()
        class FailingTracking(io.StringIO):
            def write(self, value):
                raise OSError(errno.ENOSPC, 'injected tracking failure')
        self.tracking = FailingTracking()
        with self.assertRaises(OSError):
            namespace['copy_native_text_entry'](self.context, self.tracking)
        for directory in ('system32', 'syswow64'):
            folder = self.prefix / 'drive_c/windows' / directory
            self.assertFalse((folder / 'nexus-text-entry.py').exists())
            self.assertFalse((folder / 'nexus-text-entry-host.exe').exists())
        self.assertEqual(self.save.read_bytes(), b'unchanged-user-data')


if __name__ == '__main__':
    unittest.main()
