import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExtensions, assertAllowedExtension } from '../src/core.mjs';

test('extension list normalizes dots, separators, case and duplicate entries', () => {
  // Accept common ways of entering an extension list, including compound suffixes.
  assert.deepEqual(parseExtensions(' .ZIP, pdf；7Z tar.gz,zip '), ['zip', 'pdf', '7z', 'tar.gz']);
  assert.deepEqual(parseExtensions(''), []);
  assert.throws(() => parseExtensions('zip,*.pdf'));
  assert.throws(() => parseExtensions('zip,../pdf'));
});

test('extension filtering rejects disguised and extensionless files before upload', () => {
  // Match complete trailing suffixes rather than arbitrary filename substrings.
  assert.doesNotThrow(() => assertAllowedExtension('资料.ZIP', 'zip,pdf'));
  assert.doesNotThrow(() => assertAllowedExtension('archive.TAR.GZ', '.tar.gz'));
  assert.doesNotThrow(() => assertAllowedExtension('README', ''));
  for (const file of ['archive.zip.exe', 'zip', 'README', '.zip', 'archive.zip.']) {
    assert.throws(() => assertAllowedExtension(file, 'zip,pdf'));
  }
});
