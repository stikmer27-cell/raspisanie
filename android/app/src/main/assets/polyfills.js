// Недостающие в старом WebView (Chrome < 128) функции, которые использует pdf.js.
// Подключается раньше pdf.js. Ничего не трогает, если функция уже есть.
/* eslint-disable no-extend-native */
const def = (obj, name, value) => {
  if (obj && typeof obj[name] === 'undefined') {
    Object.defineProperty(obj, name, { value, writable: true, configurable: true, enumerable: false });
  }
};

def(Promise, 'withResolvers', function withResolvers() {
  let resolve, reject;
  const promise = new this((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
});
def(Promise, 'try', function (fn, ...args) {
  return new this((resolve) => resolve(fn(...args)));
});

def(URL, 'parse', (url, base) => { try { return new URL(url, base); } catch { return null; } });
def(URL, 'canParse', (url, base) => { try { new URL(url, base); return true; } catch { return false; } });

def(Object, 'groupBy', (items, fn) => {
  const out = Object.create(null);
  let i = 0;
  for (const x of items) { const k = fn(x, i++); (out[k] ||= []).push(x); }
  return out;
});
def(Map, 'groupBy', (items, fn) => {
  const out = new Map();
  let i = 0;
  for (const x of items) {
    const k = fn(x, i++);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(x);
  }
  return out;
});
def(Array, 'fromAsync', async (items, fn) => {
  const out = [];
  let i = 0;
  for await (const x of items) out.push(fn ? await fn(x, i++) : x);
  return out;
});

def(ArrayBuffer.prototype, 'transfer', function (length = this.byteLength) {
  const out = new ArrayBuffer(length);
  new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(length, this.byteLength)));
  return out;
});
def(ArrayBuffer.prototype, 'transferToFixedLength', ArrayBuffer.prototype.transfer);

// Set: union / intersection / difference / ...
const keysOf = (other) => (typeof other.keys === 'function' ? other.keys() : other);
def(Set.prototype, 'union', function (o) { const r = new Set(this); for (const x of keysOf(o)) r.add(x); return r; });
def(Set.prototype, 'intersection', function (o) { const r = new Set(); for (const x of this) if (o.has(x)) r.add(x); return r; });
def(Set.prototype, 'difference', function (o) { const r = new Set(this); for (const x of keysOf(o)) r.delete(x); return r; });
def(Set.prototype, 'symmetricDifference', function (o) {
  const r = new Set(this);
  for (const x of keysOf(o)) { if (this.has(x)) r.delete(x); else r.add(x); }
  return r;
});
def(Set.prototype, 'isSubsetOf', function (o) { for (const x of this) if (!o.has(x)) return false; return true; });
def(Set.prototype, 'isSupersetOf', function (o) { for (const x of keysOf(o)) if (!this.has(x)) return false; return true; });
def(Set.prototype, 'isDisjointFrom', function (o) { for (const x of this) if (o.has(x)) return false; return true; });

def(Math, 'sumPrecise', (items) => {
  let sum = 0, c = 0;
  for (const x of items) { const y = x - c; const t = sum + y; c = (t - sum) - y; sum = t; }
  return sum;
});

// Uint8Array <-> base64 / hex
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
def(Uint8Array.prototype, 'toBase64', function (opts = {}) {
  let s = '';
  for (let i = 0; i < this.length; i += 0x8000) s += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000));
  let out = btoa(s);
  if (opts.alphabet === 'base64url') out = out.replace(/\+/g, '-').replace(/\//g, '_');
  if (opts.omitPadding) out = out.replace(/=+$/, '');
  return out;
});
def(Uint8Array, 'fromBase64', (str, opts = {}) => {
  let s = String(str).replace(/\s+/g, '');
  if (opts.alphabet === 'base64url') s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
});
def(Uint8Array.prototype, 'toHex', function () {
  let s = '';
  for (const b of this) s += b.toString(16).padStart(2, '0');
  return s;
});
def(Uint8Array, 'fromHex', (str) => {
  const out = new Uint8Array(str.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(str.substr(i * 2, 2), 16);
  return out;
});
void B64;

// Итерируемый ReadableStream (for await ... of stream)
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}
