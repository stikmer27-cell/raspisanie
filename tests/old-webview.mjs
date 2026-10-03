// Имитация старого WebView (Chrome 113, как в эмуляторе Android 14 без обновлений):
// убираем встроенные функции, появившиеся позже, подключаем наши полифилы и разбираем PDF.
// Запускается из run.mjs отдельным процессом (портит глобальные объекты).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'android', 'app', 'src', 'main', 'assets');
const url = (f) => 'file://' + path.join(ASSETS, f).replace(/\\/g, '/');

const kill = (obj, name) => {
  if (obj && name in obj) {
    try { delete obj[name]; } catch { /* */ }
    if (name in obj) Object.defineProperty(obj, name, { value: undefined, configurable: true, writable: true });
  }
};
for (const n of ['withResolvers', 'try']) kill(Promise, n);
for (const n of ['parse', 'canParse']) kill(URL, n);
kill(Object, 'groupBy');
kill(Map, 'groupBy');
kill(Array, 'fromAsync');
kill(ArrayBuffer.prototype, 'transfer');
kill(Math, 'sumPrecise');
for (const n of ['fromBase64', 'fromHex']) kill(Uint8Array, n);
for (const n of ['toBase64', 'toHex', 'setFromBase64', 'setFromHex']) kill(Uint8Array.prototype, n);
for (const n of ['union', 'intersection', 'difference', 'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom']) kill(Set.prototype, n);
if (globalThis.Iterator) {
  for (const n of ['map', 'filter', 'take', 'drop', 'flatMap', 'reduce', 'toArray', 'forEach', 'some', 'every', 'find']) kill(Iterator.prototype, n);
}
if (globalThis.ReadableStream) kill(ReadableStream.prototype, Symbol.asyncIterator);

await import(url('polyfills.js'));
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { parsePdf } = await import(url('engine.js'));
const res = await parsePdf(pdfjs, new Uint8Array(fs.readFileSync(path.join(HERE, 'fixtures', '4-2-kurs-SPO.pdf'))), '2026-09-30');
console.log(JSON.stringify({ groups: Object.keys(res.groups).length, warnings: res.warnings.length, lessons: res.groups['2507сб1'].days['2026-10-01'].length }));
