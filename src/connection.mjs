import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

/** Verify credentials, public download and cleanup using only a unique nonsensitive test object. */
export async function testConnection(client, config, fetchPublic = fetch) {
  // 1. Use a fresh key so cached responses and existing user files cannot produce a false success.
  const key = '_connection-test/' + randomUUID() + '.txt';
  const body = 'R2 connection verification: ' + randomUUID();
  const signal = AbortSignal.timeout(30000);
  let failure;
  try {
    try {
      // 2. Test actual write permission with a tiny object; never upload any note or selected file.
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: 'text/plain', CacheControl: 'no-store' }), { abortSignal: signal });
    } catch (error) {
      throw new Error('R2 上传测试失败，请检查账号、密钥、桶权限或网络。' + (error?.$metadata?.httpStatusCode ? ' HTTP ' + error.$metadata.httpStatusCode : ''));
    }
    try {
      // 3. Compare bytes through the configured public domain rather than assuming S3 success means public access.
      const response = await fetchPublic(config.publicBase + '/' + key, { signal, redirect: 'error' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      if (await response.text() !== body) throw new Error('内容不匹配');
    } catch (error) {
      throw new Error('R2 写入成功，但公开下载测试失败。' + (/^HTTP [0-9]+$/.test(error?.message) ? error.message : '请检查公开域名、访问限制及网络。'));
    }
  } catch (error) {
    failure = error;
  } finally {
    // 4. Use an independent deadline so a timed-out upload still gets a cleanup attempt.
    try {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(10000) });
    } catch {
      throw new Error((failure ? failure.message + '\n' : '') + '测试文件清理失败，请在桶中手动删除：' + key);
    }
  }
  if (failure) throw failure;
}
