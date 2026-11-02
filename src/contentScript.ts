import { installDropHandler } from './drop.mjs';

/** Attach file routing to desktop CodeMirror 6 without modifying the rich-text editor. */
export default function(context) {
  // 1. Resolve Joplin's shared CodeMirror library and the supported Electron file-path API.
  return { plugin(wrapper) {
    if (!wrapper.editor || !wrapper.joplinExtensions?.noteIdFacet) return;
    let webUtils;
    try { webUtils = joplin.require('electron').webUtils; } catch { return; }
    if (!webUtils?.getPathForFile) return;
    const { ViewPlugin } = joplin.require('@codemirror/view');
    const replayed = new WeakSet();
    wrapper.addExtension(ViewPlugin.define(view => {
      // 2. Replay only unmatched files to Joplin's native handling at the original coordinates.
      const fallback = (event, files) => {
        const transfer = new DataTransfer();
        for (const file of files) transfer.items.add(file);
        const replay = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey });
        replayed.add(replay);
        event.target.dispatchEvent(replay);
      };
      // 3. Exclude native replay events to avoid recursive interception.
      const dom = {
        addEventListener(type, listener, capture) { this.listener = event => { if (!replayed.has(event)) listener(event); }; view.dom.addEventListener(type, this.listener, capture); },
        removeEventListener(type, _listener, capture) { view.dom.removeEventListener(type, this.listener, capture); },
      };
      return installDropHandler({
        view: { get state() { return view.state; }, dom, posAtCoords: p => view.posAtCoords(p), dispatch: tr => view.dispatch(tr) },
        noteId: () => view.state.facet(wrapper.joplinExtensions.noteIdFacet),
        getRules: () => context.postMessage({ type: 'dropRules' }),
        getPath: file => webUtils.getPathForFile(file),
        upload: path => context.postMessage({ type: 'dropUpload', path }),
        notify: message => context.postMessage(message), fallback,
      });
    }));
  } };
}
