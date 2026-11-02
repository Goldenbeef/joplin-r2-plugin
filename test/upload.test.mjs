import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { uploadStream } from '../src/upload.mjs';

/** Exercise real SDK HTTP multipart requests against a disposable S3 test server, with no cloud keys. */
async function withS3Server(failPart, run) {
  // 1. Track transport completion and aborts instead of treating a resolved mock as successful uploading.
  const state = { parts: [], total: 0, completed: false, aborted: false };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let bytes = 0;
    for await (const chunk of req) bytes += chunk.length;
    res.setHeader('Content-Type', 'application/xml');
    if (req.method === 'POST' && url.searchParams.has('uploads')) {
      res.end('<InitiateMultipartUploadResult><Bucket>test</Bucket><Key>large.zip</Key><UploadId>test-upload</UploadId></InitiateMultipartUploadResult>');
    } else if (req.method === 'PUT' && url.searchParams.has('partNumber')) {
      const part = Number(url.searchParams.get('partNumber'));
      if (failPart && part === 1) {
        res.statusCode = 500;
        res.end('<Error><Code>InternalError</Code><Message>test failure</Message></Error>');
      } else {
        state.parts.push(bytes); state.total += bytes;
        res.setHeader('ETag', '"part-' + part + '"'); res.end();
      }
    } else if (req.method === 'POST' && url.searchParams.has('uploadId')) {
      state.completed = true;
      res.end('<CompleteMultipartUploadResult><Location>https://example.com/large.zip</Location><Bucket>test</Bucket><Key>large.zip</Key><ETag>"complete"</ETag></CompleteMultipartUploadResult>');
    } else if (req.method === 'DELETE') {
      state.aborted = true; res.statusCode = 204; res.end();
    } else { res.statusCode = 400; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new S3Client({
    region: 'auto', endpoint: 'http://127.0.0.1:' + server.address().port, forcePathStyle: true,
    credentials: { accessKeyId: 'test-only', secretAccessKey: 'test-only' }, maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  try { await run(client, state); } finally { client.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

/** Generate a fixture as a stream, without loading an entire large attachment into one buffer. */
function fixture(size) {
  // Each yielded chunk is small; the SDK supplies multipart buffering and backpressure.
  return Readable.from((function* () {
    let remaining = size;
    while (remaining > 0) { const length = Math.min(256 * 1024, remaining); remaining -= length; yield Buffer.alloc(length, 0x5a); }
  })());
}

test('89.5 MiB attachment uses multiple parts and completes only after all bytes arrive', async () => {
  // Match the incident's approximate attachment size without touching any user file.
  await withS3Server(false, async (client, state) => {
    const size = 89.5 * 1024 * 1024;
    await uploadStream(client, 'test', 'large.zip', fixture(size), size, new AbortController().signal);
    assert.equal(state.total, size);
    assert.equal(state.parts.length, 12);
    assert.ok(state.parts.every(n => n <= 8 * 1024 * 1024));
    assert.equal(state.completed, true);
    assert.equal(state.aborted, false);
  });
});

test('failed multipart upload rejects and requests cleanup instead of reporting success', async () => {
  // A part failure must not look like a completed attachment to the caller that inserts the link.
  await withS3Server(true, async (client, state) => {
    const size = 17 * 1024 * 1024;
    await assert.rejects(uploadStream(client, 'test', 'large.zip', fixture(size), size, new AbortController().signal));
    assert.equal(state.completed, false);
    assert.equal(state.aborted, true);
  });
});
