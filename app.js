const toolTabs = [...document.querySelectorAll('.tool-tab')];
const linkForm = document.querySelector('#link-form');
const urlInput = document.querySelector('#url-input');
const aliasInput = document.querySelector('#alias-input');
const aliasPrefix = document.querySelector('#alias-prefix');
const aliasRow = document.querySelector('#alias-row');
const submitButton = document.querySelector('#submit-button');
const submitLabel = document.querySelector('#submit-label');
const clearButton = document.querySelector('#clear-button');
const toolShell = document.querySelector('.tool-shell');
const resultCard = document.querySelector('#result-card');
const resultTitle = document.querySelector('#result-title');
const resultCaption = document.querySelector('#result-caption');
const shortLink = document.querySelector('#short-link');
const copyButton = document.querySelector('#copy-button');
const resultQrButton = document.querySelector('#result-qr-button');
const downloadButton = document.querySelector('#download-button');
const newLinkButton = document.querySelector('#new-link-button');
const resultNote = document.querySelector('#result-note');
const qrPreview = document.querySelector('#qr-preview');
const qrCanvas = document.querySelector('#qr-canvas');
const qrPlaceholder = document.querySelector('#qr-placeholder');
const inlineStatus = document.querySelector('#inline-status');
const urlError = document.querySelector('#url-error');
const aliasError = document.querySelector('#alias-error');
const panelLabel = document.querySelector('#panel-label');
const panelTitle = document.querySelector('#panel-title');
const statusPill = document.querySelector('.status-pill');
const toast = document.querySelector('#toast');
const apiRecentList = document.querySelector('#api-recent-list');
const apiRecentEmpty = document.querySelector('#api-recent-empty');
const apiRecentEmptyTitle = apiRecentEmpty?.querySelector('strong');
const apiRecentEmptyDetail = apiRecentEmpty?.querySelector('p');
const apiRecentStatus = document.querySelector('#api-recent-status');
const localRecentList = document.querySelector('#local-recent-list');
const localRecentEmpty = document.querySelector('#local-recent-empty');
const clearHistoryButton = document.querySelector('#clear-history');
const menuButton = document.querySelector('#menu-toggle');
const siteNav = document.querySelector('#site-nav');

document.body.classList.add('reveal-ready');

const LINKS_ENDPOINT = '/api/links';
const HISTORY_KEY = 'quiclink.local-history.v1';
const MAX_LOCAL_HISTORY = 6;

let activeTool = 'shorten';
let currentResult = null;
let serverLinks = [];
let editingLinkId = null;
let editingLink = null;
let toastTimer;

function setAliasPrefix() {
  if (!aliasPrefix || !window.location.origin || window.location.origin === 'null') return;
  aliasPrefix.textContent = `${window.location.origin.replace(/^https?:\/\//, '').replace(/\/$/, '')}/`;
}

const toolCopy = {
  shorten: {
    label: 'SHORTEN URL',
    title: 'Create a short link.',
    submit: 'Shorten URL',
    resultTitle: 'Your short link is ready.',
  },
  qr: {
    label: 'QR CODE',
    title: 'Create a QR code.',
    submit: 'Generate QR',
    resultTitle: 'Your QR code is ready.',
  },
  combo: {
    label: 'SHORTEN + QR',
    title: 'Create both in one step.',
    submit: 'Shorten & Generate QR',
    resultTitle: 'Your short link and QR code are ready.',
  },
};

function setMenuOpen(isOpen) {
  if (!menuButton || !siteNav) return;
  menuButton.setAttribute('aria-expanded', String(isOpen));
  siteNav.classList.toggle('is-open', isOpen);
}

function initScrollReveals() {
  const revealItems = [...document.querySelectorAll('.reveal:not(.is-visible)')];
  if (!revealItems.length) return;

  if (typeof window.IntersectionObserver !== 'function') {
    revealItems.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new window.IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  revealItems.forEach((item) => observer.observe(item));
}

function setActiveTool(tool, shouldFocus = false) {
  if (!toolCopy[tool]) return;
  if (tool !== 'shorten' && editingLinkId) clearEditingState();
  activeTool = tool;
  const copy = toolCopy[tool];

  toolTabs.forEach((tab) => {
    const isActive = tab.dataset.tool === tool;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

  panelLabel.textContent = copy.label;
  panelTitle.textContent = editingLinkId && tool === 'shorten' ? 'Update your short link.' : copy.title;
  submitLabel.textContent = editingLinkId && tool === 'shorten' ? 'Save changes' : copy.submit;
  aliasRow.hidden = tool === 'qr';
  resetResult();
  clearErrors();
  clearStatus();
  setStatusPill('Ready');

  if (shouldFocus) {
    toolTabs.find((tab) => tab.dataset.tool === tool)?.focus();
  }
}

function clearErrors() {
  urlError.textContent = '';
  aliasError.textContent = '';
  urlInput.removeAttribute('aria-invalid');
  aliasInput.removeAttribute('aria-invalid');
}

function clearStatus() {
  inlineStatus.textContent = '';
  inlineStatus.className = 'inline-status';
}

function setStatus(message, type = '') {
  inlineStatus.textContent = message;
  inlineStatus.className = `inline-status${type ? ` ${type}` : ''}`;
}

function setStatusPill(message, type = '') {
  if (!statusPill) return;
  const text = statusPill.lastChild;
  if (text?.nodeType === Node.TEXT_NODE) text.textContent = ` ${message}`;
  else statusPill.append(document.createTextNode(` ${message}`));
  statusPill.classList.toggle('is-loading', type === 'loading');
  statusPill.classList.toggle('is-error', type === 'error');
}

function resetQr() {
  qrCanvas.hidden = true;
  qrPlaceholder.hidden = false;
  const context = qrCanvas.getContext('2d');
  context?.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
  const label = qrPlaceholder.querySelector('span');
  const detail = qrPlaceholder.querySelector('small');
  if (label) label.textContent = 'QR';
  if (detail) detail.textContent = 'Generated locally';
}

function resetResult() {
  currentResult = null;
  resultCard.hidden = true;
  resultCard.classList.remove('is-revealing');
  qrPreview.hidden = true;
  resultQrButton.hidden = true;
  downloadButton.hidden = true;
  downloadButton.disabled = true;
  resetQr();
}

function showError(element, input, message) {
  element.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function validateForm() {
  clearErrors();
  const destination = urlInput.value.trim();
  const alias = activeTool === 'qr' ? '' : aliasInput.value.trim();

  if (!destination) {
    showError(urlError, urlInput, 'Add a URL before creating your result.');
    return null;
  }
  if (destination.length > 2048) {
    showError(urlError, urlInput, 'Use a URL shorter than 2,048 characters.');
    return null;
  }
  if (!isValidHttpUrl(destination)) {
    showError(urlError, urlInput, 'Use a complete link starting with https:// or http://.');
    return null;
  }
  if (alias && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(alias)) {
    showError(aliasError, aliasInput, 'Use letters, numbers, and single hyphens only.');
    return null;
  }

  return { destination, alias };
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  clearButton.disabled = isLoading;
  toolShell?.classList.toggle('is-submitting', isLoading);
  submitButton.classList.toggle('is-loading', isLoading);
  submitLabel.textContent = isLoading ? 'Preparing…' : (editingLinkId && activeTool === 'shorten' ? 'Save changes' : toolCopy[activeTool].submit);
  setStatusPill(isLoading ? 'Working…' : 'Ready', isLoading ? 'loading' : '');
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error('QuicLink could not reach the link service. Check your connection and try again.');
  }

  const responseText = await response.text();
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { message: responseText };
    }
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || `The link service returned ${response.status}.`;
    const error = new Error(message);
    error.code = payload?.code || '';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function extractLinkCollection(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.links)) return payload.links;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === 'object') return extractLinkCollection(payload.data);
  return [];
}

function unwrapLink(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload)) return unwrapLink(payload[0]);
  if (payload.link && typeof payload.link === 'object') return payload.link;
  if (Array.isArray(payload.data)) return unwrapLink(payload.data[0]);
  if (payload.data && !Array.isArray(payload.data) && typeof payload.data === 'object') return unwrapLink(payload.data);
  return payload;
}

function extractShortCode(shortUrl) {
  if (!shortUrl) return '';
  try {
    const parsed = new URL(shortUrl, window.location.origin);
    return parsed.pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    return String(shortUrl).split('/').filter(Boolean).pop() || '';
  }
}

function shortUrlFromCode(shortCode) {
  if (!shortCode) return '';
  const base = window.location.origin && window.location.origin !== 'null' ? window.location.origin.replace(/\/$/, '') : '';
  return `${base}/${encodeURIComponent(shortCode)}`;
}

function normalizeLink(raw) {
  const value = unwrapLink(raw);
  if (!value) return null;

  const destinationUrl = value.destinationUrl || value.destination || value.originalUrl || value.targetUrl || '';
  const returnedShortUrl = value.shortUrl || value.shortURL || value.shortLink || '';
  const shortCode = String(value.shortCode || value.code || value.slug || extractShortCode(returnedShortUrl) || '');
  const shortUrl = returnedShortUrl || shortUrlFromCode(shortCode);
  const id = String(value.id ?? value._id ?? value.linkId ?? shortCode ?? '');

  if (!destinationUrl && !shortUrl && !shortCode) return null;
  return {
    ...value,
    id,
    destinationUrl,
    customAlias: value.customAlias || value.alias || '',
    shortCode,
    shortUrl,
  };
}

function ensureServerLink(payload, fallback = null) {
  const link = normalizeLink(payload);
  const fallbackLink = fallback ? normalizeLink(fallback) : null;
  const resolved = link ? {
    ...(fallback || {}),
    ...link,
    id: link.id || fallback?.id || '',
    destinationUrl: link.destinationUrl || fallback?.destinationUrl || '',
    customAlias: link.customAlias || fallback?.customAlias || '',
    shortCode: link.shortCode || fallback?.shortCode || '',
    shortUrl: link.shortUrl || fallback?.shortUrl || shortUrlFromCode(link.shortCode || fallback?.shortCode || ''),
  } : fallbackLink;
  if (!resolved || !resolved.shortUrl) throw new Error('The link service did not return a usable short URL.');
  return resolved;
}

async function createServerLink(destinationUrl, customAlias) {
  const body = { destinationUrl };
  if (customAlias) body.shortCode = customAlias;
  const payload = await requestJson(LINKS_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return ensureServerLink(payload, { destinationUrl, customAlias });
}

async function updateServerLink(id, destinationUrl, customAlias, fallback) {
  if (!id) throw new Error('This link cannot be edited because it has no identifier.');
  const body = { destinationUrl };
  if (customAlias) body.shortCode = customAlias;
  const payload = await requestJson(`${LINKS_ENDPOINT}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return ensureServerLink(payload, { ...fallback, destinationUrl, customAlias });
}

function setApiStatus(message, type = '') {
  if (!apiRecentStatus) return;
  apiRecentStatus.textContent = message;
  apiRecentStatus.dataset.state = type;
}

function setApiEmptyState(title, detail, type = '') {
  if (!apiRecentEmpty) return;
  apiRecentEmpty.dataset.state = type;
  if (apiRecentEmptyTitle) apiRecentEmptyTitle.textContent = title;
  if (apiRecentEmptyDetail) apiRecentEmptyDetail.textContent = detail;
}

function getApiErrorDetail(error) {
  if (error?.code === 'DATABASE_NOT_CONFIGURED' || /not configured/i.test(error?.message || '')) {
    return 'The link service needs a PostgreSQL connection before saved links can be used.';
  }
  if (error?.code === 'DATABASE_UNAVAILABLE' || /postgresql|database|link service/i.test(error?.message || '')) {
    return 'The PostgreSQL service could not be reached. Check the server connection and try again.';
  }
  return error?.message || 'The saved-link service could not be reached. Try again shortly.';
}

async function loadServerLinks() {
  setApiStatus('Loading…');
  setApiEmptyState('Loading saved links…', 'Checking the PostgreSQL-backed link service.');
  try {
    const payload = await requestJson(LINKS_ENDPOINT);
    serverLinks = extractLinkCollection(payload).map(normalizeLink).filter((link) => link?.shortUrl);
    renderServerLinks();
    setApiStatus(serverLinks.length ? `${serverLinks.length} loaded` : 'No links yet');
    setStatusPill('Ready');
  } catch (error) {
    serverLinks = [];
    renderServerLinks();
    setApiEmptyState('Saved links unavailable.', getApiErrorDetail(error), 'error');
    setApiStatus('Database unavailable', 'error');
    setStatusPill('API offline', 'error');
  }
}

function getLocalHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (Array.isArray(saved)) {
      return saved.map((item) => ({
        ...item,
        id: item.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        destinationUrl: item.destinationUrl || item.destination || '',
        displayValue: item.displayValue || item.destinationUrl || item.destination || '',
      }));
    }
  } catch {
    // Local history is optional and may be unavailable in privacy mode.
  }
  return [];
}

function saveLocalHistory(item) {
  const entry = {
    ...item,
    id: item.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: item.createdAt || new Date().toISOString(),
  };
  const history = [entry, ...getLocalHistory().filter((saved) => saved.id !== entry.id && saved.displayValue !== entry.displayValue)].slice(0, MAX_LOCAL_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Local history is optional and may be unavailable in privacy mode.
  }
  renderLocalHistory();
}

function removeLocalHistory(id) {
  const history = getLocalHistory().filter((entry) => entry.id !== id);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Local history is optional and may be unavailable in privacy mode.
  }
  renderLocalHistory();
}

function createAction(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'recent-item-action';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createRecentItem(item, source) {
  const article = document.createElement('article');
  article.className = 'recent-item';

  const top = document.createElement('div');
  top.className = 'recent-item-top';
  const link = document.createElement('a');
  link.className = 'recent-item-link';
  link.target = '_blank';
  link.rel = 'noreferrer';
  const linkValue = source === 'api' ? item.shortUrl : (item.displayValue || item.destinationUrl || item.destination || '');
  link.href = linkValue;
  link.textContent = linkValue.replace(/^https?:\/\//, '');
  link.title = linkValue;
  const kind = document.createElement('span');
  kind.className = 'recent-item-kind';
  kind.textContent = source === 'api' ? 'API LINK' : (item.kind || 'QR');
  top.append(link, kind);

  const destination = document.createElement('p');
  destination.className = 'recent-item-destination';
  destination.textContent = item.destinationUrl || item.destination || '';
  destination.title = destination.textContent;

  const actions = document.createElement('div');
  actions.className = 'recent-item-actions';
  const openLink = document.createElement('a');
  openLink.className = 'recent-item-action';
  openLink.href = linkValue;
  openLink.target = '_blank';
  openLink.rel = 'noreferrer';
  openLink.textContent = 'Open';
  actions.append(openLink);
  actions.append(createAction('Copy', async () => {
    try {
      await copyText(linkValue);
      showToast('Copied to your clipboard.');
    } catch {
      showToast('Copy failed — select the link manually.');
    }
  }));
  if (source === 'api') {
    actions.append(createAction('Edit', () => beginEditing(item)));
  }
  actions.append(createAction('Delete', async () => {
    if (source === 'local') {
      removeLocalHistory(item.id);
      showToast('Local QR item deleted.');
      return;
    }
    await deleteServerLink(item);
  }));

  article.append(top, destination, actions);
  return article;
}

function renderServerLinks() {
  if (!apiRecentList) return;
  apiRecentList.replaceChildren();
  if (!serverLinks.length) {
    setApiEmptyState('No saved links yet.', 'Shortened links will appear here after you create one.');
    apiRecentList.append(apiRecentEmpty);
    return;
  }
  serverLinks.slice(0, 8).forEach((item) => apiRecentList.append(createRecentItem(item, 'api')));
}

function renderLocalHistory() {
  if (!localRecentList) return;
  const history = getLocalHistory();
  localRecentList.replaceChildren();
  if (!history.length) {
    localRecentList.append(localRecentEmpty);
    return;
  }
  history.slice(0, MAX_LOCAL_HISTORY).forEach((item) => localRecentList.append(createRecentItem(item, 'local')));
}

function rememberServerLink(link) {
  serverLinks = [link, ...serverLinks.filter((item) => item.id !== link.id && item.shortUrl !== link.shortUrl)].slice(0, 8);
  renderServerLinks();
  setApiStatus(`${serverLinks.length} loaded`);
}

async function deleteServerLink(link) {
  if (!link.id) {
    showToast('This link cannot be deleted because it has no identifier.');
    return;
  }
  try {
    await requestJson(`${LINKS_ENDPOINT}/${encodeURIComponent(link.id)}`, { method: 'DELETE' });
    serverLinks = serverLinks.filter((item) => item.id !== link.id);
    renderServerLinks();
    setApiStatus(serverLinks.length ? `${serverLinks.length} loaded` : 'No links yet');
    if (editingLinkId === link.id) resetForm();
    showToast('API link deleted.');
  } catch (error) {
    showToast(error.message || 'The link could not be deleted.');
  }
}

function beginEditing(link) {
  if (!link.id) {
    showToast('This link cannot be edited because it has no identifier.');
    return;
  }
  editingLinkId = link.id;
  editingLink = link;
  setActiveTool('shorten');
  urlInput.value = link.destinationUrl || '';
  aliasInput.value = link.customAlias || '';
  panelTitle.textContent = 'Update your short link.';
  submitLabel.textContent = 'Save changes';
  setStatus(`Editing ${link.shortUrl}. Save when you are ready.`, '');
  document.querySelector('#workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  urlInput.focus({ preventScroll: true });
}

function clearEditingState() {
  editingLinkId = null;
  editingLink = null;
  panelTitle.textContent = toolCopy[activeTool].title;
  submitLabel.textContent = toolCopy[activeTool].submit;
}

function resetForm() {
  linkForm.reset();
  clearEditingState();
  resetResult();
  clearErrors();
  clearStatus();
  setStatusPill('Ready');
  urlInput.focus();
}

function renderResult({ destination, link = null, qrValue = '', qrReady = false, qrError = null, showQr = null }) {
  const isQrOnly = activeTool === 'qr';
  const visibleValue = isQrOnly ? destination : link?.shortUrl;
  if (!visibleValue) throw new Error('No shareable URL was returned.');

  resultTitle.textContent = toolCopy[activeTool].resultTitle;
  resultCaption.textContent = isQrOnly ? 'SOURCE URL' : 'SHORT LINK';
  shortLink.textContent = visibleValue;
  shortLink.href = visibleValue;
  shortLink.title = visibleValue;
  shortLink.target = '_blank';
  shortLink.rel = 'noreferrer';
  copyButton.setAttribute('aria-label', isQrOnly ? 'Copy source URL' : 'Copy short link');

  const shouldShowQr = showQr ?? (activeTool === 'qr' || activeTool === 'combo');
  qrPreview.hidden = !shouldShowQr;
  resultQrButton.hidden = activeTool !== 'shorten' || shouldShowQr;
  downloadButton.hidden = !shouldShowQr || !qrReady;
  downloadButton.disabled = !qrReady;
  if (!shouldShowQr) resetQr();
  if (shouldShowQr && !qrReady) {
    const label = qrPlaceholder.querySelector('span');
    const detail = qrPlaceholder.querySelector('small');
    if (label) label.textContent = 'QR';
    if (detail) detail.textContent = qrError ? 'Unavailable' : 'Preparing';
    qrPlaceholder.hidden = false;
    qrCanvas.hidden = true;
  }

  if (activeTool === 'shorten' && shouldShowQr) {
    resultNote.textContent = 'This QR code points to the live short link.';
  } else if (activeTool === 'shorten') {
    resultNote.textContent = 'The API returned this live short link. Open it or copy it to share.';
  } else if (activeTool === 'combo' && qrError) {
    resultNote.textContent = 'The short link is ready. QR generation failed, but you can still open or copy the link.';
  } else if (activeTool === 'combo') {
    resultNote.textContent = 'Your QR code points to the API short link.';
  } else {
    resultNote.textContent = 'This QR code was generated locally and is kept in your browser history.';
  }

  currentResult = { destination, link, shortUrl: link?.shortUrl || '', qrValue, qrReady, showQr: shouldShowQr, visibleValue };
  resultCard.classList.remove('is-revealing');
  void resultCard.offsetWidth;
  resultCard.classList.add('is-revealing');
  resultCard.hidden = false;
}

async function createQr(value) {
  if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
    await window.QRCode.toCanvas(qrCanvas, value, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#10202d', light: '#ffffff' },
    });
    qrPlaceholder.hidden = true;
    qrCanvas.hidden = false;
    qrCanvas.setAttribute('aria-label', `Generated QR code for ${value}`);
    return;
  }

  const matrix = createQrMatrix(value);
  paintQr(matrix, qrCanvas);
  qrPlaceholder.hidden = true;
  qrCanvas.hidden = false;
}

async function copyText(value) {
  if (!value) throw new Error('There is no link to copy.');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const helper = document.createElement('textarea');
  helper.value = value;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.left = '-9999px';
  helper.style.opacity = '0';
  document.body.append(helper);
  helper.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    helper.remove();
  }
  if (!copied) throw new Error('Clipboard access was unavailable.');
}

function downloadQr() {
  if (!currentResult?.qrReady || qrCanvas.hidden) {
    showToast('There is no QR image to download yet.');
    return;
  }
  try {
    const anchor = document.createElement('a');
    anchor.href = qrCanvas.toDataURL('image/png');
    anchor.download = `quiclink-${currentResult.link?.shortCode || 'qr'}.png`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    showToast('QR code downloaded as a PNG.');
  } catch {
    setStatus('The QR image could not be downloaded in this browser.', 'error');
    showToast('QR download failed.');
  }
}

toolTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => setActiveTool(tab.dataset.tool));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + toolTabs.length) % toolTabs.length;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % toolTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = toolTabs.length - 1;
    const nextTool = toolTabs[nextIndex]?.dataset.tool;
    if (nextTool) setActiveTool(nextTool, true);
  });
});

linkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = validateForm();
  if (!values) return;

  const { destination, alias } = values;
  const requestedTool = activeTool;
  setLoading(true);
  clearStatus();

  try {
    if (requestedTool === 'qr') {
      try {
         await createQr(destination);
      } catch (error) {
        resetResult();
        throw new Error(error.message || 'This URL could not be encoded as a QR code.');
      }
      renderResult({ destination, qrValue: destination, qrReady: true });
      saveLocalHistory({ destination, displayValue: destination, kind: 'QR' });
      setStatus('Ready to copy or download.', 'success');
      setStatusPill('Ready');
      showToast('QR code created locally.');
      return;
    }

    const link = editingLinkId
      ? await updateServerLink(editingLinkId, destination, alias, editingLink)
      : await createServerLink(destination, alias);
    rememberServerLink(link);

    if (requestedTool === 'combo') {
      let qrError = null;
      try {
         await createQr(link.shortUrl);
      } catch (error) {
        resetQr();
        qrError = error;
      }
      renderResult({ destination, link, qrValue: link.shortUrl, qrReady: !qrError, qrError });
      if (qrError) {
        setStatus('Short link created, but QR generation failed. You can still copy or open the link.', 'warning');
        setStatusPill('Link ready');
        showToast('Short link created; QR generation failed.');
      } else {
        setStatus('Ready to copy, open, or download.', 'success');
        setStatusPill('Ready');
        showToast('Your QuicLink and QR are ready.');
      }
    } else {
      resetQr();
      renderResult({ destination, link, qrValue: '', qrReady: false });
      setStatus(editingLinkId ? 'Your short link was updated.' : 'Ready to copy or open.', 'success');
      setStatusPill('Ready');
      showToast(editingLinkId ? 'Short link updated.' : 'Your QuicLink is ready.');
    }

    clearEditingState();
  } catch (error) {
    setStatus(error.message || 'Something went wrong while creating your result.', 'error');
    setStatusPill('Needs attention', 'error');
  } finally {
    setLoading(false);
  }
});

copyButton.addEventListener('click', async () => {
  if (!currentResult) return;
  try {
    await copyText(currentResult.visibleValue);
    showToast('Copied to your clipboard.');
    setStatus('Copied — your link is ready to share.', 'success');
    copyButton.setAttribute('aria-label', 'Copied');
    window.setTimeout(() => copyButton.setAttribute('aria-label', activeTool === 'qr' ? 'Copy source URL' : 'Copy short link'), 1400);
  } catch {
    setStatus('Copy was blocked by the browser. Select the link manually.', 'error');
    showToast('Copy failed — select the link manually.');
  }
});

downloadButton.addEventListener('click', downloadQr);
resultQrButton.addEventListener('click', async () => {
  if (!currentResult?.link?.shortUrl) return;
  resultQrButton.disabled = true;
  setStatusPill('Working…', 'loading');
  try {
    await createQr(currentResult.link.shortUrl);
    renderResult({
      destination: currentResult.destination,
      link: currentResult.link,
      qrValue: currentResult.link.shortUrl,
      qrReady: true,
      showQr: true,
    });
    setStatus('Ready to copy or download.', 'success');
    setStatusPill('Ready');
    showToast('QR code created locally.');
  } catch (error) {
    resetQr();
    setStatus(error.message || 'This link could not be encoded as a QR code.', 'error');
    setStatusPill('Needs attention', 'error');
  } finally {
    resultQrButton.disabled = false;
  }
});
newLinkButton.addEventListener('click', resetForm);
clearButton.addEventListener('click', resetForm);

clearHistoryButton.addEventListener('click', () => {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // Local history is optional and may be unavailable in privacy mode.
  }
  renderLocalHistory();
  showToast('Local QR history cleared.');
});

menuButton?.addEventListener('click', () => setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true'));
siteNav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenuOpen(false)));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenuOpen(false);
});

renderLocalHistory();
renderServerLinks();
setAliasPrefix();
setActiveTool('shorten');
initScrollReveals();
loadServerLinks();

/*
 * Dependency-free QR encoder.
 *
 * QuicLink keeps QR generation local so the workspace does not depend on a
 * third-party CDN or send link data to an image service. It supports byte mode,
 * error correction level L, and QR versions 1–10, which covers generated short
 * links and normal-sized destination URLs.
 */
const QR_BLOCKS_L = [
  null,
  [{ total: 26, data: 19 }],
  [{ total: 44, data: 34 }],
  [{ total: 70, data: 55 }],
  [{ total: 100, data: 80 }],
  [{ total: 134, data: 108 }],
  [{ total: 86, data: 68 }, { total: 86, data: 68 }],
  [{ total: 98, data: 78 }, { total: 98, data: 78 }],
  [{ total: 121, data: 97 }, { total: 121, data: 97 }],
  [{ total: 146, data: 116 }, { total: 146, data: 116 }],
  [{ total: 86, data: 68 }, { total: 86, data: 68 }, { total: 87, data: 69 }, { total: 87, data: 69 }],
];

const ALIGNMENT_POSITIONS = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const GF_EXP = new Array(512).fill(0);
const GF_LOG = new Array(256).fill(0);
GF_EXP[0] = 1;
for (let index = 1; index < 512; index += 1) {
  let value = GF_EXP[index - 1] << 1;
  if (value & 0x100) value ^= 0x11d;
  GF_EXP[index] = value;
}
for (let index = 0; index < 255; index += 1) GF_LOG[GF_EXP[index]] = index;

function gfMultiply(first, second) {
  if (first === 0 || second === 0) return 0;
  return GF_EXP[GF_LOG[first] + GF_LOG[second]];
}

const generatorCache = new Map();

function generatorPolynomial(length) {
  if (generatorCache.has(length)) return generatorCache.get(length);
  let polynomial = [1];
  for (let index = 0; index < length; index += 1) {
    const next = new Array(polynomial.length + 1).fill(0);
    for (let item = 0; item < polynomial.length; item += 1) {
      next[item] ^= polynomial[item];
      next[item + 1] ^= gfMultiply(polynomial[item], GF_EXP[index]);
    }
    polynomial = next;
  }
  generatorCache.set(length, polynomial);
  return polynomial;
}

function reedSolomonRemainder(data, ecLength) {
  const generator = generatorPolynomial(ecLength);
  const remainder = new Array(ecLength).fill(0);
  data.forEach((value) => {
    const factor = value ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let index = 0; index < ecLength; index += 1) {
      remainder[index] ^= gfMultiply(generator[index + 1], factor);
    }
  });
  return remainder;
}

function putBits(bits, value, length) {
  for (let index = length - 1; index >= 0; index -= 1) bits.push(((value >>> index) & 1) === 1);
}

function chooseQrVersion(bytes) {
  for (let version = 1; version <= 10; version += 1) {
    const capacity = QR_BLOCKS_L[version].reduce((sum, block) => sum + block.data, 0) * 8;
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= capacity) return version;
  }
  throw new Error('This URL is too long for the local QR renderer.');
}

function createDataCodewords(bytes, version) {
  const blocks = QR_BLOCKS_L[version];
  const totalDataBits = blocks.reduce((sum, block) => sum + block.data, 0) * 8;
  const countBits = version < 10 ? 8 : 16;
  const bits = [];

  putBits(bits, 4, 4);
  putBits(bits, bytes.length, countBits);
  bytes.forEach((value) => putBits(bits, value, 8));
  if (bits.length + 4 <= totalDataBits) putBits(bits, 0, 4);
  while (bits.length % 8 !== 0) bits.push(false);

  let pad = true;
  while (bits.length < totalDataBits) {
    putBits(bits, pad ? 0xec : 0x11, 8);
    pad = !pad;
  }

  const codewords = [];
  for (let index = 0; index < bits.length; index += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | (bits[index + bit] ? 1 : 0);
    codewords.push(value);
  }

  const dataBlocks = [];
  const errorBlocks = [];
  let offset = 0;
  blocks.forEach((block) => {
    const data = codewords.slice(offset, offset + block.data);
    offset += block.data;
    dataBlocks.push(data);
    errorBlocks.push(reedSolomonRemainder(data, block.total - block.data));
  });

  const interleaved = [];
  const maxDataLength = Math.max(...dataBlocks.map((block) => block.length));
  const maxErrorLength = Math.max(...errorBlocks.map((block) => block.length));
  for (let index = 0; index < maxDataLength; index += 1) {
    dataBlocks.forEach((block) => {
      if (index < block.length) interleaved.push(block[index]);
    });
  }
  for (let index = 0; index < maxErrorLength; index += 1) {
    errorBlocks.forEach((block) => {
      if (index < block.length) interleaved.push(block[index]);
    });
  }
  return interleaved;
}

function bchDigit(value) {
  let digit = 0;
  while (value !== 0) {
    digit += 1;
    value >>>= 1;
  }
  return digit;
}

function bchTypeInfo(data) {
  let value = data << 10;
  const generator = 0x537;
  while (bchDigit(value) - bchDigit(generator) >= 0) {
    value ^= generator << (bchDigit(value) - bchDigit(generator));
  }
  return ((data << 10) | value) ^ 0x5412;
}

function bchTypeNumber(data) {
  let value = data << 12;
  const generator = 0x1f25;
  while (bchDigit(value) - bchDigit(generator) >= 0) {
    value ^= generator << (bchDigit(value) - bchDigit(generator));
  }
  return (data << 12) | value;
}

function setupFinder(modules, row, column) {
  const size = modules.length;
  for (let r = -1; r <= 7; r += 1) {
    if (row + r < 0 || row + r >= size) continue;
    for (let c = -1; c <= 7; c += 1) {
      if (column + c < 0 || column + c >= size) continue;
      const isRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      modules[row + r][column + c] = isRing || isCenter;
    }
  }
}

function setupTiming(modules) {
  const size = modules.length;
  for (let index = 8; index < size - 8; index += 1) {
    if (modules[index][6] === null) modules[index][6] = index % 2 === 0;
    if (modules[6][index] === null) modules[6][index] = index % 2 === 0;
  }
}

function setupAlignment(modules, version) {
  const positions = ALIGNMENT_POSITIONS[version];
  for (let rowIndex = 0; rowIndex < positions.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < positions.length; columnIndex += 1) {
      const row = positions[rowIndex];
      const column = positions[columnIndex];
      if (modules[row][column] !== null) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          modules[row + r][column + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        }
      }
    }
  }
}

function setupTypeNumber(modules, version, test) {
  const bits = bchTypeNumber(version);
  const size = modules.length;
  for (let index = 0; index < 18; index += 1) {
    const value = !test && ((bits >>> index) & 1) === 1;
    modules[Math.floor(index / 3)][(index % 3) + size - 8 - 3] = value;
    modules[(index % 3) + size - 8 - 3][Math.floor(index / 3)] = value;
  }
}

function setupTypeInfo(modules, mask, test) {
  const bits = bchTypeInfo((1 << 3) | mask);
  const size = modules.length;
  for (let index = 0; index < 15; index += 1) {
    const value = !test && ((bits >>> index) & 1) === 1;
    if (index < 6) modules[index][8] = value;
    else if (index < 8) modules[index + 1][8] = value;
    else modules[size - 15 + index][8] = value;

    if (index < 8) modules[8][size - index - 1] = value;
    else if (index < 9) modules[8][15 - index - 1 + 1] = value;
    else modules[8][15 - index - 1] = value;
  }
  modules[size - 8][8] = !test;
}

function maskValue(mask, row, column) {
  switch (mask) {
    case 0: return (row + column) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return column % 3 === 0;
    case 3: return (row + column) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5: return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6: return ((((row * column) % 2) + ((row * column) % 3)) % 2) === 0;
    case 7: return ((((row * column) % 3) + ((row + column) % 2)) % 2) === 0;
    default: return false;
  }
}

function mapData(modules, data, mask) {
  const size = modules.length;
  let row = size - 1;
  let direction = -1;
  let bitIndex = 7;
  let byteIndex = 0;

  for (let column = size - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const currentColumn = column - offset;
        if (modules[row][currentColumn] !== null) continue;
        let dark = false;
        if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
        if (maskValue(mask, row, currentColumn)) dark = !dark;
        modules[row][currentColumn] = dark;
        bitIndex -= 1;
        if (bitIndex === -1) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += direction;
      if (row < 0 || row >= size) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }
}

function buildMatrix(version, data, mask, test) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  setupFinder(modules, 0, 0);
  setupFinder(modules, size - 7, 0);
  setupFinder(modules, 0, size - 7);
  setupTiming(modules);
  setupAlignment(modules, version);
  if (version >= 7) setupTypeNumber(modules, version, test);
  setupTypeInfo(modules, mask, test);
  mapData(modules, data, mask);
  return modules;
}

function lostPoint(modules) {
  const size = modules.length;
  let score = 0;

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let sameCount = 0;
      const dark = modules[row][column];
      for (let r = -1; r <= 1; r += 1) {
        if (row + r < 0 || row + r >= size) continue;
        for (let c = -1; c <= 1; c += 1) {
          if (column + c < 0 || column + c >= size || (r === 0 && c === 0)) continue;
          if (dark === modules[row + r][column + c]) sameCount += 1;
        }
      }
      if (sameCount > 5) score += 3 + sameCount - 5;
    }
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const count = (modules[row][column] ? 1 : 0)
        + (modules[row + 1][column] ? 1 : 0)
        + (modules[row][column + 1] ? 1 : 0)
        + (modules[row + 1][column + 1] ? 1 : 0);
      if (count === 0 || count === 4) score += 3;
    }
  }

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size - 6; column += 1) {
      if (modules[row][column] && !modules[row][column + 1] && modules[row][column + 2] && modules[row][column + 3] && modules[row][column + 4] && !modules[row][column + 5] && modules[row][column + 6]) score += 40;
    }
  }
  for (let column = 0; column < size; column += 1) {
    for (let row = 0; row < size - 6; row += 1) {
      if (modules[row][column] && !modules[row + 1][column] && modules[row + 2][column] && modules[row + 3][column] && modules[row + 4][column] && !modules[row + 5][column] && modules[row + 6][column]) score += 40;
    }
  }

  let darkCount = 0;
  modules.forEach((row) => row.forEach((value) => { if (value) darkCount += 1; }));
  score += (Math.abs((100 * darkCount) / size / size - 50) / 5) * 10;
  return score;
}

function toUtf8Bytes(value) {
  if (typeof TextEncoder !== 'undefined') return [...new TextEncoder().encode(value)];
  return [...unescape(encodeURIComponent(value))].map((character) => character.charCodeAt(0));
}

function createQrMatrix(value) {
  const bytes = toUtf8Bytes(value);
  const version = chooseQrVersion(bytes);
  const data = createDataCodewords(bytes, version);
  let bestMatrix = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = buildMatrix(version, data, mask, true);
    const score = lostPoint(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMatrix = candidate;
      bestMask = mask;
    }
  }
  return bestMatrix ? buildMatrix(version, data, bestMask, false) : null;
}

function paintQr(matrix, canvas) {
  if (!matrix || !canvas) throw new Error('The local QR renderer is unavailable.');
  const rendererSize = 1024;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not create a QR canvas.');
  canvas.width = rendererSize;
  canvas.height = rendererSize;
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, rendererSize, rendererSize);

  const quietZone = 4;
  const totalModules = matrix.length + quietZone * 2;
  const moduleSize = Math.floor(rendererSize / totalModules);
  const offset = Math.floor((rendererSize - moduleSize * totalModules) / 2) + quietZone * moduleSize;
  context.fillStyle = '#10202d';
  matrix.forEach((row, rowIndex) => {
    row.forEach((isDark, columnIndex) => {
      if (isDark) context.fillRect(offset + columnIndex * moduleSize, offset + rowIndex * moduleSize, moduleSize, moduleSize);
    });
  });
  canvas.setAttribute('aria-label', 'Generated QR code');
}
