/** Partition files without interpreting an empty automatic rule list as permission to publish everything. */
export function partitionDroppedFiles(files, extensions) {
  // 1. Preserve order and compare full trailing suffixes, ignoring case.
  const r2 = [], native = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    const match = extensions.some(ext => name.length > ext.length + 1 && name.endsWith('.' + ext));
    (match ? r2 : native).push(file);
  }
  return { r2, native };
}

/** Capture drops before native handling and track insertion anchors through concurrent edits. */
export function installDropHandler({ view, noteId, getRules, getPath, upload, fallback, notify }) {
  // 1. Invalidate an anchor permanently when switching notes or destroying its editor.
  const jobs = new Set();
  let disposed = false;
  const update = update => {
    for (const job of jobs) {
      if (noteId() !== job.noteId) job.valid = false;
      if (update.docChanged) job.pos = update.changes.mapPos(job.pos, 1);
    }
  };
  const handler = event => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length || event.altKey || view.state.readOnly || disposed) return;
    // 2. Stop synchronously; awaiting the routing rules otherwise creates duplicate native resources.
    event.preventDefault();
    event.stopImmediatePropagation();
    const job = { noteId: noteId(), pos: view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head, valid: true };
    jobs.add(job);
    void (async () => {
      try {
        const { r2, native } = partitionDroppedFiles(files, await getRules());
        if (disposed || !job.valid || noteId() !== job.noteId) throw new Error('拖入期间笔记已切换，请重新拖入文件。');
        // 3. Resolve real OS paths before starting uploads; send paths, never file bytes, over IPC.
        const paths = r2.map(file => getPath(file));
        if (paths.some(path => !path)) throw new Error('无法读取拖入文件路径，未上传。请使用本地普通文件或手动上传按钮。');
        if (native.length) fallback(event, native);
        for (const path of paths) {
          const result = await upload(path);
          if (!result?.link) continue;
          // 4. Insert in the original editor session only; retain completed links after navigation.
          if (!disposed && job.valid && noteId() === job.noteId && !view.state.readOnly) {
            view.dispatch({ changes: { from: job.pos, insert: result.link + '\n' } });
          } else {
            await notify({ type: 'copyLink', link: result.link });
          }
        }
      } catch (error) {
        await notify({ type: 'dropError', message: error.message });
      } finally {
        jobs.delete(job);
      }
    })();
  };
  view.dom.addEventListener('drop', handler, true);
  return {
    update,
    destroy() {
      // 5. Prevent late inserts into a replacement editor and release the listener.
      disposed = true;
      view.dom.removeEventListener('drop', handler, true);
    },
  };
}
