# R2 公开附件 — Joplin 桌面插件

选择一个文件，直接以 S3 协议上传到 Cloudflare R2，然后在当前 Markdown 笔记的光标位置插入公开 HTTPS 下载链接。笔记仍使用现有的 Joplin Server 同步目标。

## 安装和使用

1. 在 Joplin 桌面版打开“设置 → 插件”，通过齿轮菜单选择“从文件安装”，选取 `publish/local.r2.publicattachments.jpl`。在合适时间重启 Joplin 以加载插件，请先保存正在编辑的内容。
2. 在“设置 → R2 公开附件”填写自己的 Cloudflare Account ID、桶名称、公开下载域名，以及专用的 R2 **S3 Access Key ID**、**Secret Access Key**。所有账号与目标配置默认留空。
3. 打开一篇普通笔记，切换到 Markdown 编辑器，把光标放到目标位置，点击编辑器工具栏的云上传按钮，或“工具 → 上传公开附件到 R2”。
4. 在文件选择框中选择 ZIP、PDF、图片等文件。上传完成后插入链接，随后照常同步笔记。上传中再次执行同一命令可取消。
5. 如果上传期间切换了笔记，插件不会往其他笔记写入；完成后会把链接复制到剪贴板供手动粘贴。插入失败也采用这个处理方式。

## R2 凭据（需要用户在本机填写，不要发送到聊天）

在 Cloudflare 的 R2 Overview → Manage API Tokens 中创建专用 R2 S3 凭据：

- 权限：Object Read & Write。
- 仅允许访问你用于附件的专用桶。
- 把创建后显示的 Access Key ID 和 Secret Access Key 填入插件设置；不是复制普通 Cloudflare API Token。
- 两项凭据使用 Joplin `secure: true` 设置，系统钥匙串可用时由其存储，不写入笔记、安装包或源码。其实际安全性仍取决于 Joplin/操作系统的钥匙串支持，不保证各平台都具有相同存储机制。

官方说明：https://developers.cloudflare.com/r2/api/tokens/

## 目标配置

- Cloudflare Account ID：填写你自己的账号 ID，不要提交到公开仓库。
- R2 桶名称：填写用于公开附件的专用桶。
- 公开下载域名：填写该桶已绑定的 HTTPS 域名，例如 `https://files.example.com`；示例域名不可直接使用。
- 上传入口由 Account ID 派生：`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`。
- 插件不会创建或修改桶、域名和现有同步配置。

## 行为与边界

- 只有你明确选择的文件会公开上传。任何获得下载地址的人都可读取文件，不能把随机路径当成访问控制。
- 文件直传 R2 S3 API，不经过 Joplin Server、BWG 或 NAS Tunnel；但仍需要本机网络可连到 Cloudflare R2。
- 采用 8 MiB 分片、并发 2、最多 3 次 SDK 请求尝试。未实现跨应用重启的断点续传；完成前断开，需要重新选择文件上传。
- 失败时 SDK 尝试终止未完成的 multipart upload。断网或退出应用可能使清理失败，不能保证没有残留分片。
- 对象路径使用随机 UUID 防止覆盖。网络丢失恰好发生在完成响应阶段时，对象可能已写入但客户端仍报失败，错误框显示对象路径以便核查；重试可能产生重复对象。
- 按普通二进制附件下载处理，不自动生成图片嵌入或内联预览。
- 不接管 Joplin 原有附件按钮，不迁移、不删除已有资源，不修改同步目标。
- 外链文件不受 Joplin 端到端加密保护，不随 JEX 导出自动打包，不自动离线缓存；删除笔记或撤销链接也不会自动删除 R2 文件。
- 上传功能仅支持桌面 Markdown 编辑器。其他设备无需插件即可通过 HTTPS 链接下载，但设备仍需联网。

## 构建与测试

需要 Node.js 20+ 和 npm。

```sh
npm ci --ignore-scripts
npm test
npm run dist
```

构建脚本将 index.js 与 manifest.json 打成标准 tar 格式 JPL。依赖固定版本并保留 package-lock.json。`api/` 来自官方 generator-joplin 3.7.2 的 API 声明；相关上游项目使用 AGPL-3.0-or-later。AWS SDK 使用 Apache-2.0；esbuild 使用 MIT。本目录为本地交付，未上传到插件市场。

自动化测试覆盖配置校验、文件名的 Markdown/URL 转义、约 89.5 MiB 合成文件通过真实 AWS SDK HTTP multipart 上传到本地模拟 S3 服务，以及分片失败的 abort 请求。这些测试不等于真实用户附件已在 R2 上传成功。

R2 的真实公开链路已用一段无敏感信息的 52 字节文本验证：REST API 写入 → 公开自定义域名读到相同内容 → 删除测试对象。不使用用户文件；该验证不包含桌面插件的 S3 签名认证，后者需要填写专用凭据后验证。

已在本机 Joplin 3.7.22 的独立测试配置中加载安装包，运行日志确认插件 `onStart` 完成，无插件加载错误；没有修改日常使用的 Joplin 配置。实际界面操作和真实 S3 凭据上传尚未完成验证，需要安装并填写凭据后测试。

## 回滚

在 Joplin 中停用或卸载插件，不改变现有 Server 同步。若要关闭新公开域名，可在 R2 桶设置中禁用你绑定的公开域名；此举会使已插入的外链不可访问。删除桶或文件前先自行确认文件已备份，不能因为卸载插件就直接删除附件。
