import test from 'node:test';
import assert from 'node:assert/strict';
import { testConnection } from '../src/connection.mjs';

/** Simulate S3 and public fetch separately so upload permission cannot mask a broken public domain. */
function fixture({ putFails = false, publicFails = false, deleteFails = false } = {}) {
  // Track all calls and preserve the uploaded bytes for the public-download check.
  const calls = [];
  let body;
  const client = { send: async command => {
    const name = command.constructor.name;
    calls.push(name);
    assert.equal(command.input.Bucket, 'test-bucket');
    assert.match(command.input.Key, new RegExp('^_connection-test/[a-f0-9-]+[.]txt$'));
    if (name === 'PutObjectCommand') { if (putFails) throw new Error('private SDK detail'); body = command.input.Body; }
    if (name === 'DeleteObjectCommand' && deleteFails) throw new Error('private cleanup detail');
  } };
  const fetchPublic = async url => {
    calls.push('public GET');
    assert.ok(url.startsWith('https://files.example.com/_connection-test/'));
    return { ok: !publicFails, status: publicFails ? 403 : 200, text: async () => body };
  };
  return { client, fetchPublic, calls };
}

test('connection succeeds only after upload, matching public download and deletion', async () => {
  // A successful upload alone is insufficient evidence that note links can be downloaded.
  const f = fixture();
  await testConnection(f.client, { bucket: 'test-bucket', publicBase: 'https://files.example.com' }, f.fetchPublic);
  assert.deepEqual(f.calls, ['PutObjectCommand', 'public GET', 'DeleteObjectCommand']);
});

test('public download failure still deletes the test object and hides SDK details', async () => {
  // Cleanup must also run when the public domain is unavailable.
  const f = fixture({ publicFails: true });
  await assert.rejects(testConnection(f.client, { bucket: 'test-bucket', publicBase: 'https://files.example.com' }, f.fetchPublic), /公开下载.*403/);
  assert.equal(f.calls.at(-1), 'DeleteObjectCommand');
});

test('failed upload attempts cleanup and never returns success', async () => {
  // PUT response loss can leave an object, so cleanup is required even after a rejected PUT.
  const f = fixture({ putFails: true });
  await assert.rejects(testConnection(f.client, { bucket: 'test-bucket', publicBase: 'https://files.example.com' }, f.fetchPublic), /R2 上传测试失败/);
  assert.deepEqual(f.calls, ['PutObjectCommand', 'DeleteObjectCommand']);
});

test('cleanup failure reports the residual object path instead of claiming full success', async () => {
  // Tell the user exactly which nonsensitive test object needs manual removal.
  const f = fixture({ deleteFails: true });
  await assert.rejects(testConnection(f.client, { bucket: 'test-bucket', publicBase: 'https://files.example.com' }, f.fetchPublic), new RegExp('清理失败.*_connection-test/'));
});
