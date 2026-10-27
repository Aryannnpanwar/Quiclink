'use strict';

const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');

const PORT = parsePort(process.env.PORT);
const PUBLIC_APP_URL = getPublicAppUrl(process.env.PUBLIC_APP_URL, PORT);
const databaseConfig = getDatabaseConfig(process.env);
const pool = databaseConfig ? new Pool(databaseConfig) : null;

const FRONTEND_DIRECTORY = __dirname;
const LINK_COLUMNS = 'id, short_code, destination_url, created_at, updated_at';
const SHORT_CODE_LENGTH = 8;
const MAX_SHORT_CODE_LENGTH = 64;
const MAX_URL_LENGTH = 2048;
const MAX_INSERT_ATTEMPTS = 6;
const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
const RESERVED_SHORT_CODES = new Set([
  'api',
  'app.js',
  'index.html',
  'node_modules',
  'quiclink-logo.svg',
  'styles.css',
  'vendor',
]);

if (pool && typeof pool.on === 'function') {
  pool.on('error', (error) => {
    console.error('Unexpected PostgreSQL pool error:', error.message);
  });
}

function parsePort(value) {
  if (value === undefined || value === '') return 3000;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  return port;
}

function getPublicAppUrl(value, port) {
  const configuredUrl = (value || `http://localhost:${port}`).trim().replace(/\/+$/, '');
  let parsedUrl;

  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new Error('PUBLIC_APP_URL must be a valid HTTP or HTTPS URL.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    throw new Error('PUBLIC_APP_URL must be a valid HTTP or HTTPS URL.');
  }

  return configuredUrl;
}

function getDatabaseConfig(environment) {
  const databaseUrl = environment.DATABASE_URL?.trim();
  const individualConfigKeys = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
  const hasIndividualConfig = individualConfigKeys.some((key) => Boolean(environment[key]?.trim()));

  if (!databaseUrl && !hasIndividualConfig) return null;

  const config = {
    max: parsePoolSize(environment.PGPOOL_MAX),
  };

  if (databaseUrl) {
    config.connectionString = databaseUrl;
  } else {
    if (environment.PGHOST) config.host = environment.PGHOST;
    if (environment.PGPORT) config.port = Number(environment.PGPORT);
    if (environment.PGDATABASE) config.database = environment.PGDATABASE;
    if (environment.PGUSER) config.user = environment.PGUSER;
    if (environment.PGPASSWORD) config.password = environment.PGPASSWORD;
  }

  const sslSetting = (environment.DATABASE_SSL || '').trim().toLowerCase();
  if (sslSetting === 'true' || sslSetting === 'require' || environment.PGSSLMODE === 'require') {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

function parsePoolSize(value) {
  if (value === undefined || value === '') return 10;

  const size = Number(value);
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('PGPOOL_MAX must be a positive integer.');
  }
  return size;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pickField(object, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(object, name)) {
      return { present: true, value: object[name] };
    }
  }
  return { present: false, value: undefined };
}

function validateHttpUrl(value) {
  if (typeof value !== 'string') {
    return { error: 'A destination URL is required.' };
  }

  const trimmed = value.trim();
  if (!trimmed) return { error: 'A destination URL is required.' };
  if (trimmed.length > MAX_URL_LENGTH) {
    return { error: `Destination URLs must be ${MAX_URL_LENGTH} characters or fewer.` };
  }
  if (/[\u0000-\u0020]/.test(trimmed)) {
    return { error: 'The destination URL cannot contain spaces or control characters.' };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return { error: 'Use a complete URL beginning with http:// or https://.' };
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    return { error: 'Only HTTP and HTTPS destination URLs are supported.' };
  }

  return { value: trimmed };
}

function validateShortCode(value) {
  if (typeof value !== 'string') {
    return { error: 'shortCode must be a string.' };
  }

  const shortCode = value.trim();
  if (!shortCode || shortCode.length > MAX_SHORT_CODE_LENGTH || !SHORT_CODE_PATTERN.test(shortCode)) {
    return {
      error: `shortCode must contain only letters, numbers, hyphens, or underscores and be at most ${MAX_SHORT_CODE_LENGTH} characters.`,
    };
  }

  if (RESERVED_SHORT_CODES.has(shortCode.toLowerCase())) {
    return { error: 'That shortCode is reserved by the application.' };
  }

  return { value: shortCode };
}

function generateShortCode() {
  // Six bytes produce exactly eight base64url characters. The base64url alphabet
  // is URL-safe and avoids punctuation that needs escaping in a path segment.
  return crypto.randomBytes(6).toString('base64url').slice(0, SHORT_CODE_LENGTH);
}

function buildShortUrl(shortCode) {
  return `${PUBLIC_APP_URL}/${encodeURIComponent(shortCode)}`;
}

function serializeLink(row) {
  const destinationUrl = row.destination_url;
  const shortCode = row.short_code;

  return {
    id: row.id,
    shortCode,
    url: destinationUrl,
    destinationUrl,
    shortUrl: buildShortUrl(shortCode),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(error) {
  return error && error.code === '23505';
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
    this.code = 'SHORT_CODE_TAKEN';
  }
}

class AllocationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AllocationError';
    this.statusCode = 503;
    this.code = 'SHORT_CODE_ALLOCATION_FAILED';
  }
}

function sendDatabaseNotConfigured(res) {
  return res.status(503).json({
    status: 'error',
    database: 'not_configured',
    error: 'PostgreSQL is not configured. Set DATABASE_URL before using the link API.',
    code: 'DATABASE_NOT_CONFIGURED',
  });
}

function sendDatabaseUnavailable(res, error) {
  console.error('PostgreSQL request failed:', error.message);
  return res.status(503).json({
    status: 'error',
    database: 'unavailable',
    error: 'PostgreSQL is unavailable. Try again later.',
    code: 'DATABASE_UNAVAILABLE',
  });
}

function requireDatabase(_request, response, next) {
  if (!pool) return sendDatabaseNotConfigured(response);
  return next();
}

function sendValidationError(response, message, field) {
  const body = { error: message, code: 'VALIDATION_ERROR' };
  if (field) body.field = field;
  return response.status(400).json(body);
}

function normalizeId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  return value;
}

async function insertLink(destinationUrl, requestedShortCode) {
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const shortCode = requestedShortCode || generateShortCode();

    try {
      const result = await pool.query(
        `INSERT INTO links (short_code, destination_url)
         VALUES ($1, $2)
         RETURNING ${LINK_COLUMNS}`,
        [shortCode, destinationUrl],
      );
      return result.rows[0];
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (requestedShortCode) {
        throw new ConflictError('That shortCode is already in use.');
      }
    }
  }

  throw new AllocationError('Unable to allocate a unique short code. Please try again.');
}

app.use(express.json({ limit: '32kb' }));

app.get('/api/health', async (_request, response) => {
  if (!pool) return sendDatabaseNotConfigured(response);

  try {
    await pool.query('SELECT 1');
    return response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    return sendDatabaseUnavailable(response, error);
  }
});

app.post('/api/links', requireDatabase, async (request, response) => {
  if (!isObject(request.body)) {
    return sendValidationError(response, 'Request body must be a JSON object.');
  }

  const urlField = pickField(request.body, ['url', 'destinationUrl', 'destination_url', 'destination']);
  if (!urlField.present) {
    return sendValidationError(response, 'A destination URL is required.', 'url');
  }

  const urlValidation = validateHttpUrl(urlField.value);
  if (urlValidation.error) return sendValidationError(response, urlValidation.error, 'url');

  const shortCodeField = pickField(request.body, ['shortCode', 'short_code', 'alias', 'customAlias']);
  let requestedShortCode;
  if (shortCodeField.present) {
    const shortCodeValidation = validateShortCode(shortCodeField.value);
    if (shortCodeValidation.error) {
      return sendValidationError(response, shortCodeValidation.error, 'shortCode');
    }
    requestedShortCode = shortCodeValidation.value;
  }

  try {
    const row = await insertLink(urlValidation.value, requestedShortCode);
    return response.status(201).json(serializeLink(row));
  } catch (error) {
    if (error.statusCode) {
      return response.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    return sendDatabaseUnavailable(response, error);
  }
});

app.get('/api/links', requireDatabase, async (_request, response) => {
  try {
    const result = await pool.query(
      `SELECT ${LINK_COLUMNS}
       FROM links
       ORDER BY created_at DESC, id DESC`,
    );
    return response.json(result.rows.map(serializeLink));
  } catch (error) {
    return sendDatabaseUnavailable(response, error);
  }
});

app.patch('/api/links/:id', requireDatabase, async (request, response) => {
  const id = normalizeId(request.params.id);
  if (!id) return sendValidationError(response, 'id must be a positive integer.', 'id');
  if (!isObject(request.body)) {
    return sendValidationError(response, 'Request body must be a JSON object.');
  }

  const updates = [];
  const values = [];

  const urlField = pickField(request.body, ['url', 'destinationUrl', 'destination_url', 'destination']);
  if (urlField.present) {
    const urlValidation = validateHttpUrl(urlField.value);
    if (urlValidation.error) return sendValidationError(response, urlValidation.error, 'url');
    values.push(urlValidation.value);
    updates.push(`destination_url = $${values.length}`);
  }

  const shortCodeField = pickField(request.body, ['shortCode', 'short_code', 'alias', 'customAlias']);
  if (shortCodeField.present) {
    const shortCodeValidation = validateShortCode(shortCodeField.value);
    if (shortCodeValidation.error) {
      return sendValidationError(response, shortCodeValidation.error, 'shortCode');
    }
    values.push(shortCodeValidation.value);
    updates.push(`short_code = $${values.length}`);
  }

  if (!updates.length) {
    return sendValidationError(response, 'Provide url or shortCode/customAlias to update.');
  }

  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE links
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING ${LINK_COLUMNS}`,
      values,
    );

    if (!result.rows.length) return response.status(404).json({ error: 'Link not found.', code: 'NOT_FOUND' });
    return response.json(serializeLink(result.rows[0]));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return response.status(409).json({ error: 'That shortCode is already in use.', code: 'SHORT_CODE_TAKEN' });
    }
    return sendDatabaseUnavailable(response, error);
  }
});

app.delete('/api/links/:id', requireDatabase, async (request, response) => {
  const id = normalizeId(request.params.id);
  if (!id) return sendValidationError(response, 'id must be a positive integer.', 'id');

  try {
    const result = await pool.query('DELETE FROM links WHERE id = $1 RETURNING id', [id]);
    if (!result.rows.length) return response.status(404).json({ error: 'Link not found.', code: 'NOT_FOUND' });
    return response.status(204).end();
  } catch (error) {
    return sendDatabaseUnavailable(response, error);
  }
});

// Keep the prototype's existing frontend available from this same origin.
app.use(express.static(FRONTEND_DIRECTORY, { dotfiles: 'ignore', index: 'index.html' }));

app.get('/:shortCode', requireDatabase, async (request, response) => {
  const { shortCode } = request.params;
  if (shortCode === 'api') return response.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });

  try {
    const result = await pool.query(
      `SELECT destination_url
       FROM links
       WHERE short_code = $1`,
      [shortCode],
    );

    if (!result.rows.length) return response.status(404).json({ error: 'Short link not found.', code: 'NOT_FOUND' });
    return response.redirect(302, result.rows[0].destination_url);
  } catch (error) {
    return sendDatabaseUnavailable(response, error);
  }
});

app.use((error, request, response, _next) => {
  if (error instanceof SyntaxError && error.status === 400 && error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Request body must contain valid JSON.', code: 'INVALID_JSON' });
  }

  console.error('Unhandled request error:', error);
  if (request.path.startsWith('/api/')) {
    return response.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
  return response.status(500).send('Internal server error.');
});

app.use((request, response) => {
  if (request.path.startsWith('/api/')) {
    return response.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  }
  return response.status(404).send('Not found.');
});

function startServer() {
  return app.listen(PORT, () => {
    console.log(`QuicLink listening on port ${PORT}.`);
    if (!pool) {
      console.warn('PostgreSQL is not configured; link API and redirects will return HTTP 503.');
    }
  });
}

if (require.main === module) {
  const server = startServer();
  const shutdown = async (signal) => {
    console.log(`Received ${signal}; shutting down.`);
    server.close(async () => {
      if (pool) await pool.end();
      process.exit(0);
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = {
  app,
  pool,
  startServer,
  generateShortCode,
  validateHttpUrl,
  validateShortCode,
};
