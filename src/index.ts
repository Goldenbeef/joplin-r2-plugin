import joplin from '../api';
import { MenuItemLocation, SettingItemType, ToolbarButtonLocation } from '../api/types';
import { S3Client } from '@aws-sdk/client-s3';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildLink, validateSettings, assertAllowedExtension } from './core.mjs';
import { uploadStream } from './upload.mjs';
import { testConnection } from './connection.mjs';

let activeUpload: AbortController | null = null;
// Reserve the command while settings and the file dialog are pending, before an upload exists.
let commandBusy = false;
let connectionBusy = false;
let connectionDialog: string;

/** Read saved destination values and construct the same S3 client for uploads and connection checks. */
async function configuredClient() {
  // 1. Validate saved settings before contacting any destination or reading a file.
  const config = validateSettings(await joplin.settings.values(['accountId', 'bucket', 'publicBase', 'accessKeyId', 'secretAccessKey']));
  // 2. Keep credential-bearing requests on the account-derived S3 endpoint.
  const client = new S3Client({
    region: 'auto', endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 3, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return { config, client };
}

/** Offer a real test button without relying on unsupported settings-button callbacks. */
async function checkConnection() {
  // 1. Prevent concurrent test dialogs and explain the temporary public test object before writing it.
  if (connectionBusy) return;
  connectionBusy = true;
  let client: S3Client | undefined;
  try {
    const result = await joplin.views.dialogs.open(connectionDialog);
    if (result.id !== 'confirm') return;
    // 2. Use saved configuration and always release the SDK connections, including on validation failure.
    const configured = await configuredClient();
    client = configured.client;
    await testConnection(client, configured.config);
    await joplin.views.dialogs.showMessageBox('测试通过：R2 写入、公开域名下载内容校验、测试文件删除均成功。');
  } catch (error) {
    // 3. Helpers return sanitized diagnostics; never display raw SDK request objects or credentials.
    await joplin.views.dialogs.showMessageBox(error instanceof Error ? error.message : '连通测试失败，请检查配置和网络。');
  } finally {
    client?.destroy();
    connectionBusy = false;
  }
}

/** Register the small set of fields needed for one R2 bucket; secrets use Joplin secure storage. */
async function registerSettings() {
  // 1. Keep all credentials local to this desktop; do not add them to notes or source files.
  await joplin.settings.registerSection('r2Attachments', { label: 'R2 公开附件', iconName: 'fas fa-cloud-upload-alt' });
  const field = (label: string, value: string, secure = false) => ({
    label, value, secure, type: SettingItemType.String, public: true, section: 'r2Attachments',
  });
  // 2. Leave destination fields empty so published source and builds contain no personal account or domain.
  await joplin.settings.registerSettings({
    accountId: field('Cloudflare Account ID', ''),
    bucket: field('R2 桶名称', ''),
    publicBase: field('公开访问地址', ''),
    accessKeyId: field('R2 S3 Access Key ID', '', true),
    secretAccessKey: field('R2 S3 Secret Access Key', '', true),
    allowedExtensions: { ...field('允许上传 R2 的文件后缀', ''), description: '例如 zip,pdf,7z 或 tar.gz；不区分大小写，留空不限。仅限制插件上传按钮。测试配置请先保存，然后在工具菜单打开 R2 配置连通测试。' },
  });
}

/** Upload one explicitly selected file and insert its link only into the original selected note. */
async function uploadAttachment() {
  // 1. Re-running this command during an upload gives a cancellation option, never a duplicate upload.
  if (activeUpload) {
    const uploadToCancel = activeUpload;
    if (await joplin.views.dialogs.showMessageBox('文件正在上传，是否取消本次上传？') === 0) uploadToCancel.abort();
    return;
  }
  // Reserve synchronously so repeated clicks cannot open overlapping file dialogs.
  if (commandBusy) return;
  commandBusy = true;
  let client: S3Client | undefined;
  let link = '';
  let uploadedKey = '';
  try {
    const selected = await joplin.workspace.selectedNote();
    if (!selected || selected.is_conflict) {
      await joplin.views.dialogs.showMessageBox('请先打开一篇可编辑的普通笔记。');
      return;
    }
    // 2. Reject incomplete configuration before opening or uploading any file.
    const configured = await configuredClient();
    const config = configured.config;
    client = configured.client;
    const files = await joplin.views.dialogs.showOpenDialog({ title: '选择要公开上传到 R2 的附件', properties: ['openFile'] });
    if (!files?.length) return;
    const filePath = files[0];
    // Reject disallowed suffixes before opening a file stream or sending an S3 request.
    assertAllowedExtension(basename(filePath), await joplin.settings.value('allowedExtensions'));
    const fs = joplin.require('fs-extra');
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('请选择普通文件。');
    if ((await joplin.workspace.selectedNote())?.id !== selected.id) throw new Error('当前笔记已切换，请重新执行上传。');
    // 3. Random object paths avoid collisions; preserve the visible file name without placing note titles in R2.
    uploadedKey = `attachments/${randomUUID()}/${basename(filePath)}`;
    link = buildLink(basename(filePath), uploadedKey, config.publicBase);
    activeUpload = new AbortController();
    // 4. Show a non-blocking start notification; the same toolbar command can cancel a slow upload.
    await joplin.views.dialogs.showToast({ message: `正在上传 ${basename(filePath)}（${(stat.size / 1048576).toFixed(1)} MiB）；再次点击可取消。`, duration: 5000 });
    await uploadStream(client, config.bucket, uploadedKey, fs.createReadStream(filePath), stat.size, activeUpload.signal);
    // 5. Do not append to a different note if the user navigated away while the upload was running.
    const current = await joplin.workspace.selectedNote();
    if (current?.id !== selected.id) {
      await joplin.clipboard.writeText(link);
      await joplin.views.dialogs.showMessageBox('上传已完成，但当前笔记已切换。下载链接已复制到剪贴板，请粘贴到需要的位置。\n\n' + link);
      return;
    }
    try {
      // 6. Use the editor command so unsaved edits and the undo history remain under Joplin control.
      await joplin.commands.execute('insertText', link);
    } catch {
      await joplin.clipboard.writeText(link);
      await joplin.views.dialogs.showMessageBox('文件已上传，但自动插入失败。链接已复制到剪贴板，请手动粘贴。\n\n' + link);
      return;
    }
    await joplin.views.dialogs.showToast({ message: 'R2 上传完成，公开链接已插入笔记。', duration: 4000 });
  } catch (error) {
    // 7. Never print SDK errors or request objects: they can contain credential-bearing request details.
    const cancelled = activeUpload?.signal.aborted;
    const status = error?.$metadata?.httpStatusCode;
    const localError = !activeUpload && error instanceof Error ? error.message : '';
    await joplin.views.dialogs.showMessageBox(cancelled ? '已取消上传，未插入链接。' :
      localError || `R2 上传未完成，未插入链接。${status ? ' HTTP ' + status + '。' : ''}请检查凭据、桶权限及网络后重试。\n对象路径：${uploadedKey || '尚未创建'}`);
  } finally {
    // 8. Release connections and clear command state for the next explicitly selected file.
    client?.destroy();
    activeUpload = null;
    commandBusy = false;
  }
}

joplin.plugins.register({
  onStart: async () => {
    // 1. Register local settings before exposing the upload command.
    await registerSettings();
    // Create a dedicated dialog: settings APIs expose no custom callback for native Button fields.
    connectionDialog = await joplin.views.dialogs.create('r2ConnectionTest');
    await joplin.views.dialogs.setHtml(connectionDialog, '<h2>R2 配置连通测试</h2><p>请先保存插件设置。点击测试将使用已保存的配置，上传少量无敏感内容的测试文本，通过公开域名核对内容后删除测试文件。不会读取笔记或附件。</p><p>测试最长约 40 秒；若清理失败，将显示需手动删除的测试对象路径。</p>');
    await joplin.views.dialogs.setButtons(connectionDialog, [{ id: 'confirm', title: '测试连通' }, { id: 'cancel', title: '取消' }]);
    await joplin.commands.register({ name: 'testPublicR2Connection', label: 'R2 配置连通测试', execute: checkConnection });
    await joplin.views.menuItems.create('publicR2ConnectionMenu', 'testPublicR2Connection', MenuItemLocation.Tools);
    // 2. Keep upload restricted to editable Markdown notes; other clients can still open the resulting HTTPS link.
    await joplin.commands.register({
      name: 'uploadPublicR2Attachment', label: '上传公开附件到 R2（再次点击取消）', iconName: 'fas fa-cloud-upload-alt',
      enabledCondition: 'oneNoteSelected && !inConflictFolder && editorType == markdown', execute: uploadAttachment,
    });
    await joplin.views.menuItems.create('publicR2AttachmentMenu', 'uploadPublicR2Attachment', MenuItemLocation.Tools);
    await joplin.views.toolbarButtons.create('publicR2AttachmentButton', 'uploadPublicR2Attachment', ToolbarButtonLocation.EditorToolbar);
  },
});
