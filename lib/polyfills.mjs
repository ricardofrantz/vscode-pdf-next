// Polyfills for runtime methods the vendored PDF.js relies on but the V8
// shipped in current VS Code Electron builds does not yet expose.
//
// Map.prototype.getOrInsertComputed and WeakMap.prototype.getOrInsertComputed
// come from the TC39 "Upsert" proposal (Stage 3 at time of writing).
// RegExp.escape and Response.prototype.bytes are part of newer Baseline
// JavaScript/Web API sets used by PDF.js find-query handling and binary CMap /
// standard-font loading. VS Code 1.95's Electron runtime does not ship them.
// Without these polyfills, opening PDFs with packaged binary resources or
// searching for punctuation can throw in the bundled viewer.
//
// This file must be imported before any PDF.js module so the prototypes/globals
// are patched before the viewer evaluates.

function getOrInsertComputed(key, callbackFn) {
  if (typeof callbackFn !== 'function') {
    throw new TypeError('callbackFn must be a function');
  }
  if (this.has(key)) {
    return this.get(key);
  }
  const value = callbackFn(key);
  this.set(key, value);
  return value;
}

if (typeof Map.prototype.getOrInsertComputed !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value: getOrInsertComputed,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

if (typeof WeakMap.prototype.getOrInsertComputed !== 'function') {
  Object.defineProperty(WeakMap.prototype, 'getOrInsertComputed', {
    value: getOrInsertComputed,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

const regexSyntaxCharacters = new Set('^$\\.*+?()[]{}|/');
const otherPunctuators = new Set(',-=<>#&!%:;@~\'`"');
const controlEscapes = new Map([
  ['\f', 'f'],
  ['\n', 'n'],
  ['\r', 'r'],
  ['\t', 't'],
  ['\v', 'v'],
]);

function hexEscape(codePoint, length = 2) {
  return `\\x${codePoint.toString(16).padStart(length, '0')}`;
}

function unicodeEscape(codePoint) {
  return `\\u${codePoint.toString(16).padStart(4, '0')}`;
}

function regexpEscape(value) {
  const string = String(value);
  let escaped = '';

  for (let index = 0; index < string.length; index += 1) {
    const char = string[index];
    const codePoint = char.codePointAt(0);

    if (
      index === 0 &&
      ((codePoint >= 0x30 && codePoint <= 0x39) ||
        (codePoint >= 0x41 && codePoint <= 0x5a) ||
        (codePoint >= 0x61 && codePoint <= 0x7a))
    ) {
      escaped += hexEscape(codePoint);
      continue;
    }

    const controlEscape = controlEscapes.get(char);
    if (controlEscape) {
      escaped += `\\${controlEscape}`;
      continue;
    }

    if (char === ' ') {
      escaped += '\\x20';
      continue;
    }

    if (regexSyntaxCharacters.has(char)) {
      escaped += `\\${char}`;
      continue;
    }

    if (otherPunctuators.has(char)) {
      escaped += hexEscape(codePoint);
      continue;
    }

    if (
      codePoint < 0x20 ||
      codePoint === 0x7f ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      escaped += unicodeEscape(codePoint);
      continue;
    }

    escaped += char;
  }

  return escaped;
}

if (typeof RegExp.escape !== 'function') {
  Object.defineProperty(RegExp, 'escape', {
    value: regexpEscape,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

function base64EncodeBytes(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64DecodeBytes(value) {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

if (typeof Uint8Array.fromBase64 !== 'function') {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    value: base64DecodeBytes,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

if (typeof Uint8Array.prototype.toBase64 !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toBase64', {
    value() {
      return base64EncodeBytes(this);
    },
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

const hexDigits = '0123456789abcdef';

function bytesToHex() {
  let hex = '';
  for (let index = 0; index < this.length; index += 1) {
    const byte = this[index];
    hex += hexDigits[byte >> 4] + hexDigits[byte & 0x0f];
  }
  return hex;
}

function hexToBytes(value) {
  const string = String(value);
  if (string.length % 2 !== 0 || /[^0-9a-fA-F]/.test(string)) {
    throw new SyntaxError('Invalid hex string');
  }
  const bytes = new Uint8Array(string.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(string.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

if (typeof Uint8Array.prototype.toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value: bytesToHex,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

if (typeof Uint8Array.fromHex !== 'function') {
  Object.defineProperty(Uint8Array, 'fromHex', {
    value: hexToBytes,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

async function responseBytes() {
  return new Uint8Array(await this.arrayBuffer());
}

if (
  typeof Response !== 'undefined' &&
  typeof Response.prototype.bytes !== 'function'
) {
  Object.defineProperty(Response.prototype, 'bytes', {
    value: responseBytes,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}
