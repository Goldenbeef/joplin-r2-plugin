/** Validate all settings before credentials or file contents enter the upload path. */
export function validateSettings(input) {
  // 1. Trim user-entered fields; keep errors free of credential values.
  const config = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v || '').trim()]));
  if (!/^[a-f0-9]{32}$/.test(config.accountId)) throw new Error('Cloudflare Account ID 应为 32 位十六进制字符。');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket)) throw new Error('请填写有效的 R2 桶名称。');
  if (!config.accessKeyId || !config.secretAccessKey) throw new Error('请先在插件设置中填写 R2 S3 Access Key ID 和 Secret Access Key。');
  // 2. Only accept an HTTPS public origin, without embedded authentication or expiring query strings.
  let base;
  try { base = new URL(config.publicBase); } catch { throw new Error('公开访问地址必须是有效的 HTTPS 地址。'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('公开访问地址须为 HTTPS 域名，不含用户名、密码、路径、查询参数或片段。');
  }
  // 3. Derive the credential-bearing endpoint from the account ID; never send keys to a user-supplied host.
  return { ...config, publicBase: base.origin, endpoint: `https://${config.accountId}.r2.cloudflarestorage.com` };
}

/** Keep the displayed file name harmless while preserving the exact encoded object key. */
export function buildLink(fileName, key, publicBase) {
  // 1. Escape Markdown labels and collapse control characters to keep one link on one line.
  const label = fileName.replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').replace(/[\\\[\]<>*_`]/g, '\\$&');
  // 2. Encode each key segment independently, including parentheses that encodeURIComponent leaves unchanged.
  const path = key.split('/').map(p => encodeURIComponent(p).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
  return `[${label}](${publicBase.replace(/\/$/, '')}/${path})`;
}
