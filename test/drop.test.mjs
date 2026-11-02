import test from 'node:test';
import assert from 'node:assert/strict';
import { installDropHandler, partitionDroppedFiles } from '../src/drop.mjs';

/** Simulate an editor and a deferred upload to verify asynchronous routing and note boundaries. */
function fixture(rules = ['zip']) {
  // 1. Expose observable native calls, inserts and clipboard notifications without network access.
  let handler, note = 'note-a', finish;
  const calls = [], inserts = [], notices = [];
  const view = { state: { readOnly: false, selection: { main: { head: 3 } } }, dom: { addEventListener(_t, h) { handler = h; }, removeEventListener() {} }, posAtCoords: () => 3, dispatch: tr => inserts.push(tr.changes) };
  const control = installDropHandler({ view, noteId: () => note, getRules: async () => rules, getPath: f => '/tmp/' + f.name, upload: path => { calls.push(path); return new Promise(resolve => { finish = resolve; }); }, fallback: (_e, files) => calls.push(files.map(f => f.name)), notify: async m => notices.push(m) });
  // 2. Allow tests to change notes or complete uploads after the initial drop has returned.
  return { calls, inserts, notices, control, switchNote: () => { note = 'note-b'; control.update({ docChanged: false }); }, finish: () => finish({ link: '[file](https://files.example.com/file)' }), drop: names => {
    const e = { dataTransfer: { files: names.map(name => ({ name })) }, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, clientX: 1, clientY: 2 };
    handler(e); return e;
  } };
}

// Allow the asynchronous drop handler and its message bridge to settle without fixed delays.
const settle = () => new Promise(resolve => setImmediate(resolve));

test('empty automatic rules keep all files native; mixed drops route independently', async () => {
  // Only matching suffixes enter the R2 path, and the event is suppressed before any await.
  assert.equal(partitionDroppedFiles([{ name: 'a.zip' }], []).r2.length, 0);
  const f = fixture(); const event = f.drop(['a.ZIP', 'b.png']);
  assert.equal(event.prevented, true);
  await settle();
  assert.deepEqual(f.calls, [['b.png'], '/tmp/a.ZIP']);
  f.finish(); await settle();
  assert.equal(f.inserts.length, 1);
});

test('drop anchor follows edits and inserts only after upload completes', async () => {
  // Continue editing while upload runs; the original logical location must remain valid.
  const f = fixture(); f.drop(['a.zip']); await settle();
  assert.equal(f.inserts.length, 0);
  f.control.update({ docChanged: true, changes: { mapPos: p => p + 10 } });
  f.finish(); await settle();
  assert.equal(f.inserts[0].from, 13);
});

test('note switching copies completed links without inserting into another note', async () => {
  // A completed upload must never change the newly selected note.
  const f = fixture(); f.drop(['a.zip']); await settle();
  f.switchNote(); f.finish(); await settle();
  assert.equal(f.inserts.length, 0);
  assert.equal(f.notices[0].type, 'copyLink');
});

test('editor destruction blocks late insertion', async () => {
  // Closing a note window must invalidate uploads even if the note ID remains unchanged.
  const f = fixture(); f.drop(['a.zip']); await settle();
  f.control.destroy(); f.finish(); await settle();
  assert.equal(f.inserts.length, 0);
  assert.equal(f.notices[0].type, 'copyLink');
});
