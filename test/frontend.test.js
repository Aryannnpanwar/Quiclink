const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const qrBundle = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'qrcode-browser.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function createResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (payload === undefined ? '' : JSON.stringify(payload)),
  };
}

function createFrontend({ postStatus = 201 } = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    if (!/navigation \(except hash changes\)/i.test(error.message)) console.error(error);
  });
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const records = new Map();
  let nextId = 1;
  let copiedValue = '';

  window.TextEncoder = TextEncoder;

  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      createImageData: (width, height) => ({ data: new window.Uint8ClampedArray(width * height * 4) }),
      clearRect: () => {},
      putImageData: () => {},
    };
  };
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,quiclink-test';
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLAnchorElement.prototype.click = function click() {
    this.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  window.navigator.clipboard = { writeText: async (value) => { copiedValue = value; } };
  window.fetch = async (url, options = {}) => {
    const requestUrl = new URL(url, window.location.href);
    const method = options.method || 'GET';
    if (requestUrl.pathname === '/api/links' && method === 'GET') return createResponse([...records.values()]);
    if (requestUrl.pathname === '/api/links' && method === 'POST') {
      if (postStatus >= 400) return createResponse({ error: 'PostgreSQL is unavailable.' }, postStatus);
      const body = JSON.parse(options.body);
      const shortCode = body.shortCode || `test${nextId}`;
      const record = {
        id: nextId++,
        shortCode,
        shortUrl: `http://127.0.0.1:3000/${shortCode}`,
        destinationUrl: body.destinationUrl,
        createdAt: new Date().toISOString(),
      };
      records.set(String(record.id), record);
      return createResponse(record, 201);
    }
    const match = requestUrl.pathname.match(/^\/api\/links\/(\d+)$/);
    if (match && method === 'PATCH') {
      const record = records.get(match[1]);
      if (!record) return createResponse({ error: 'Link not found.' }, 404);
      const body = JSON.parse(options.body);
      Object.assign(record, { destinationUrl: body.destinationUrl, shortCode: body.shortCode || record.shortCode });
      record.shortUrl = `http://127.0.0.1:3000/${record.shortCode}`;
      return createResponse(record);
    }
    if (match && method === 'DELETE') {
      records.delete(match[1]);
      return createResponse(undefined, 204);
    }
    return createResponse({ error: 'Not found.' }, 404);
  };

  window.eval(qrBundle);
  window.eval(appSource);

  return { dom, window, records, getCopiedValue: () => copiedValue };
}

async function settle() {
  await new Promise((resolve) => windowSetTimeout(resolve, 0));
}

function windowSetTimeout(resolve, delay) {
  setTimeout(resolve, delay);
}

async function submit(window, tool, url, alias = '') {
  window.document.querySelector(`[data-tool="${tool}"]`).click();
  const urlInput = window.document.querySelector('#url-input');
  urlInput.value = url;
  window.document.querySelector('#alias-input').value = alias;
  window.document.querySelector('#link-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
}

test('shorten workflow uses the API, exposes the live link, and supports actions', async () => {
  const { dom, window, records, getCopiedValue } = createFrontend();
  try {
    await submit(window, 'shorten', 'https://example.com/docs', 'docs-demo');
    const result = window.document.querySelector('#result-card');
    assert.equal(result.hidden, false);
    assert.equal(window.document.querySelector('#short-link').href, 'http://127.0.0.1:3000/docs-demo');
    assert.equal(window.document.querySelector('#qr-preview').hidden, true);
    assert.equal(window.document.querySelector('#download-button').hidden, true);
    assert.equal(window.document.querySelector('#result-qr-button').hidden, false);

    window.document.querySelector('#result-qr-button').click();
    await settle();
    await settle();
    assert.equal(window.document.querySelector('#qr-preview').hidden, false);
    assert.equal(window.document.querySelector('#download-button').disabled, false);

    window.document.querySelector('#copy-button').click();
    await settle();
    assert.equal(getCopiedValue(), 'http://127.0.0.1:3000/docs-demo');

    window.document.querySelector('#new-link-button').click();
    assert.equal(window.document.querySelector('#result-card').hidden, true);
    window.document.querySelector('#url-input').value = 'https://example.com/cleared';
    window.document.querySelector('#alias-input').value = 'cleared';
    window.document.querySelector('#clear-button').click();
    assert.equal(window.document.querySelector('#url-input').value, '');
    assert.equal(window.document.querySelector('#alias-input').value, '');

    const deleteButton = [...window.document.querySelectorAll('#api-recent-list .recent-item-action')]
      .find((button) => button.textContent === 'Delete');
    assert.ok(deleteButton);
    const editButton = [...window.document.querySelectorAll('#api-recent-list .recent-item-action')]
      .find((button) => button.textContent === 'Edit');
    assert.ok(editButton);
    editButton.click();
    window.document.querySelector('#url-input').value = 'https://example.com/edited';
    window.document.querySelector('#link-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    assert.equal([...records.values()][0].destinationUrl, 'https://example.com/edited');
    deleteButton.click();
    await settle();
    assert.equal(records.size, 0);
  } finally {
    dom.window.close();
  }
});

test('QR-only workflow does not call the link API and enables PNG download', async () => {
  const { dom, window, records } = createFrontend();
  try {
    await submit(window, 'qr', 'https://example.com/qr');
    assert.equal(records.size, 0);
    assert.equal(window.document.querySelector('#result-card').hidden, false);
    assert.equal(window.document.querySelector('#qr-preview').hidden, false);
    assert.equal(window.document.querySelector('#download-button').hidden, false);
    assert.equal(window.document.querySelector('#download-button').disabled, false);
    assert.equal(window.document.querySelector('#qr-canvas').width, 220);
    window.document.querySelector('#download-button').click();
    await settle();
    assert.match(window.document.querySelector('#toast').textContent, /downloaded/i);

    const localCopyButton = [...window.document.querySelectorAll('#local-recent-list .recent-item-action')]
      .find((button) => button.textContent === 'Copy');
    assert.ok(localCopyButton);
    localCopyButton.click();
    await settle();
    assert.equal(window.document.querySelector('#local-recent-list').textContent.includes('QR'), true);

    await submit(window, 'qr', 'https://example.com/qr-second');
    const localDeleteButton = [...window.document.querySelectorAll('#local-recent-list .recent-item-action')]
      .find((button) => button.textContent === 'Delete');
    assert.ok(localDeleteButton);
    localDeleteButton.click();
    await settle();
    assert.equal(window.document.querySelectorAll('#local-recent-list .recent-item').length, 1);
    window.document.querySelector('#clear-history').click();
    assert.match(window.document.querySelector('#local-recent-list').textContent, /No links yet/);
    assert.match(window.document.querySelector('#local-recent-list').textContent, /QR/);
  } finally {
    dom.window.close();
  }
});

test('combined workflow puts the real API short URL into the QR flow', async () => {
  const { dom, window, records } = createFrontend();
  try {
    await submit(window, 'combo', 'https://example.com/combined', 'combined-demo');
    assert.equal(records.size, 1);
    assert.equal(window.document.querySelector('#result-card').hidden, false);
    assert.equal(window.document.querySelector('#short-link').href, 'http://127.0.0.1:3000/combined-demo');
    assert.equal(window.document.querySelector('#qr-preview').hidden, false);
    assert.equal(window.document.querySelector('#download-button').disabled, false);
  } finally {
    dom.window.close();
  }
});

test('API failures do not show a success result', async () => {
  const { dom, window } = createFrontend({ postStatus: 503 });
  try {
    await submit(window, 'shorten', 'https://example.com/unavailable');
    assert.equal(window.document.querySelector('#result-card').hidden, true);
    assert.match(window.document.querySelector('#inline-status').textContent, /unavailable/i);
    assert.equal(window.document.querySelector('.success-mark').closest('#result-card').hidden, true);
  } finally {
    dom.window.close();
  }
});

test('mobile navigation toggles and closes from a navigation link', () => {
  const { dom, window } = createFrontend();
  try {
    const menu = window.document.querySelector('#menu-toggle');
    const nav = window.document.querySelector('#site-nav');
    menu.click();
    assert.equal(menu.getAttribute('aria-expanded'), 'true');
    assert.equal(nav.classList.contains('is-open'), true);
    nav.querySelector('a').click();
    assert.equal(menu.getAttribute('aria-expanded'), 'false');
    assert.equal(nav.classList.contains('is-open'), false);
  } finally {
    dom.window.close();
  }
});
