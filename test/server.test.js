const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateShortCode,
  validateHttpUrl,
  validateShortCode,
} = require('../server');

test('accepts HTTP and HTTPS destination URLs', () => {
  assert.equal(validateHttpUrl('https://example.com/path').value, 'https://example.com/path');
  assert.equal(validateHttpUrl('http://localhost:8080').value, 'http://localhost:8080');
});

test('rejects unsupported, incomplete, and unsafe destination URLs', () => {
  assert.ok(validateHttpUrl('').error);
  assert.ok(validateHttpUrl('example.com/path').error);
  assert.ok(validateHttpUrl('javascript:alert(1)').error);
  assert.ok(validateHttpUrl('https://example.com/a space').error);
});

test('validates custom short codes', () => {
  assert.equal(validateShortCode('launch-day').value, 'launch-day');
  assert.equal(validateShortCode('A_B_7').value, 'A_B_7');
  assert.ok(validateShortCode('not valid').error);
  assert.ok(validateShortCode('bad/path').error);
  assert.ok(validateShortCode('api').error);
});

test('generates URL-safe eight-character short codes', () => {
  const codes = new Set(Array.from({ length: 100 }, () => generateShortCode()));
  assert.equal(codes.size, 100);
  for (const code of codes) {
    assert.match(code, /^[A-Za-z0-9_-]{8}$/);
  }
});
