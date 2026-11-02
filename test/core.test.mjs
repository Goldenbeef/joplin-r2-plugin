import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLink, validateSettings } from '../src/core.mjs';

const settings = {
  accountId: '0123456789abcdef0123456789abcdef',
  bucket: 'joplin-attachments', publicBase: 'https://files.example.com',
  accessKeyId: 'test-key', secretAccessKey: 'test-secret',
};

test('special file names cannot escape a Markdown link or change the public URL', () => {
  // A file name with Markdown syntax and line breaks must remain one attachment link.
  const link = buildLink('资料](evil)\n.zip', 'attachments/id/资料](evil)\n.zip', settings.publicBase);
  assert.ok(link.includes('资料\\]'));
  assert.ok(!link.includes('\n'));
  assert.ok(link.includes('%5D%28evil%29%0A.zip'));
  assert.ok(link.startsWith('['));
});

test('public URLs encode each object-key segment without losing its path', () => {
  // Spaces, Unicode and fragment characters must round-trip to the original S3 key.
  const key = 'attachments/unique/音频 #1.zip';
  const link = buildLink('音频 #1.zip', key, settings.publicBase + '/');
  const url = link.slice(link.indexOf('](') + 2, -1);
  assert.equal(decodeURIComponent(new URL(url).pathname), '/' + key);
});

test('reject missing credentials and an insecure or ambiguous public base URL', () => {
  // Configuration failures must happen before any file or network operations.
  assert.throws(() => validateSettings({ ...settings, secretAccessKey: '' }));
  assert.throws(() => validateSettings({ ...settings, publicBase: 'http://files.example.com' }));
  assert.throws(() => validateSettings({ ...settings, publicBase: 'https://user:pass@files.example.com' }));
  assert.throws(() => validateSettings({ ...settings, publicBase: 'https://files.example.com/?token=x' }));
  assert.throws(() => validateSettings({ ...settings, accountId: 'not-an-account' }));
  assert.equal(validateSettings(settings).endpoint, 'https://' + settings.accountId + '.r2.cloudflarestorage.com');
});
