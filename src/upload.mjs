import { Upload } from '@aws-sdk/lib-storage';

/** Stream in bounded multipart chunks; failed multipart uploads are aborted by the SDK. */
export async function uploadStream(client, bucket, key, body, size, signal, onProgress = () => {}) {
  // 1. Preserve ZIP/PDF/other bytes exactly; octet-stream prevents accidental execution as a web page.
  const upload = new Upload({
    client,
    params: { Bucket: bucket, Key: key, Body: body, ContentLength: size, ContentType: 'application/octet-stream' },
    queueSize: 2,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });
  // 2. Abort the current request and release the local file stream when the command is cancelled.
  const abort = () => { void upload.abort(); body.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  upload.on('httpUploadProgress', event => onProgress(event.loaded || 0, size));
  try {
    if (signal?.aborted) { abort(); throw new Error('Upload cancelled'); }
    // 3. Resolve only after multipart completion; callers must not insert a link earlier.
    return await upload.done();
  } finally {
    signal?.removeEventListener('abort', abort);
    body.destroy();
  }
}
