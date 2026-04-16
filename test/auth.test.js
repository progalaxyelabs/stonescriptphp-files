/**
 * auth.test.js
 *
 * Unit tests for JWT authentication middleware.
 * Verifies that only RS256 and ES256 are accepted, and that HS256 and alg=none are rejected.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createAuthMiddleware, createJwksAuthMiddleware } from '../src/auth.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Generate a minimal mock Express request with a Bearer token.
 */
function mockReq(token) {
  return {
    headers: { authorization: `Bearer ${token}` }
  };
}

/**
 * Capture a res.status(n).json(body) call.
 * Provides res._status and res._body after the middleware runs.
 */
function mockRes() {
  const res = {};
  res.status = (code) => {
    res._status = code;
    res.json = (body) => {
      res._body = body;
      return res;
    };
    return res;
  };
  return res;
}

/**
 * Craft a token with alg=none manually.
 * jsonwebtoken refuses to produce alg=none tokens; we craft one by hand.
 * Format: base64url(header).base64url(payload). (empty signature)
 */
function craftAlgNoneToken(payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify({
    sub: 'user-1',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload
  })).toString('base64url');
  return `${header}.${body}.`;
}

/**
 * Run Express middleware and return a Promise that resolves when either
 * next() is called OR res.json() is called (whichever happens first).
 * Returns { nextCalled, status, body }.
 */
function runMiddleware(middleware, req, res) {
  return new Promise((resolve) => {
    let resolved = false;

    // Intercept res.status().json() chain
    const origStatus = res.status.bind(res);
    res.status = (code) => {
      const r = origStatus(code);
      const origJson = (r.json || (() => {})).bind(r);
      r.json = (body) => {
        const ret = origJson(body);
        if (!resolved) { resolved = true; resolve({ nextCalled: false, status: code, body }); }
        return ret;
      };
      return r;
    };

    const result = middleware(req, res, () => {
      if (!resolved) { resolved = true; resolve({ nextCalled: true, status: res._status, body: res._body }); }
    });

    // If middleware is async, catch unhandled rejections silently
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        if (!resolved) { resolved = true; resolve({ nextCalled: false, status: res._status, body: res._body }); }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Key material — generated once before all tests
// ---------------------------------------------------------------------------

let rsaPrivateKey;
let rsaPublicKey;

before(() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  rsaPrivateKey = privateKey;
  rsaPublicKey  = publicKey;
});

// ---------------------------------------------------------------------------
// createAuthMiddleware tests
// ---------------------------------------------------------------------------

describe('createAuthMiddleware — algorithm enforcement', () => {

  it('accepts a valid RS256 token', async () => {
    const token = jwt.sign({ sub: 'user-rs256' }, rsaPrivateKey, { algorithm: 'RS256', expiresIn: '1h' });
    const middleware = createAuthMiddleware(rsaPublicKey);
    const { nextCalled } = await runMiddleware(middleware, mockReq(token), mockRes());
    assert.ok(nextCalled, 'next() should be called for valid RS256 token');
  });

  it('rejects HS256 token with 401', async () => {
    const token = jwt.sign({ sub: 'user-1' }, 'supersecret', { algorithm: 'HS256', expiresIn: '1h' });
    const middleware = createAuthMiddleware(rsaPublicKey);
    const { nextCalled, status, body } = await runMiddleware(middleware, mockReq(token), mockRes());
    assert.ok(!nextCalled, 'next() should NOT be called for HS256 token');
    assert.equal(status, 401, 'Expected HTTP 401 for HS256 token');
    assert.ok(
      body?.message?.includes('HS256') || body?.message?.includes('not allowed'),
      `Expected message about disallowed algorithm, got: ${body?.message}`
    );
  });

  it('rejects alg=none token with 401', async () => {
    const token = craftAlgNoneToken();
    const middleware = createAuthMiddleware(rsaPublicKey);
    const { nextCalled, status, body } = await runMiddleware(middleware, mockReq(token), mockRes());
    assert.ok(!nextCalled, 'next() should NOT be called for alg=none token');
    assert.equal(status, 401, 'Expected HTTP 401 for alg=none token');
    assert.ok(
      body?.message?.includes('none') || body?.message?.includes('not allowed'),
      `Expected message about disallowed algorithm, got: ${body?.message}`
    );
  });

  it('rejects missing Authorization header with 401', async () => {
    const middleware = createAuthMiddleware(rsaPublicKey);
    const { nextCalled, status } = await runMiddleware(middleware, { headers: {} }, mockRes());
    assert.ok(!nextCalled, 'next() should NOT be called when header is missing');
    assert.equal(status, 401);
  });

  it('rejects truly expired token with 401 (expired 120s ago, outside 60s clock tolerance)', async () => {
    // expiresIn -120s is 2 minutes in the past, well outside the 60s clockTolerance window.
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { sub: 'user-1', exp: now - 120 },
      rsaPrivateKey,
      { algorithm: 'RS256' }
    );
    const middleware = createAuthMiddleware(rsaPublicKey);
    const { nextCalled, status, body } = await runMiddleware(middleware, mockReq(token), mockRes());
    assert.ok(!nextCalled, 'next() should NOT be called for expired token');
    assert.equal(status, 401);
    assert.equal(body?.message, 'Token expired');
  });

  it('accepts token expired 30s ago (within 60s clock tolerance)', async () => {
    // A token expired 30 seconds ago should still be accepted within the 60s skew window.
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { sub: 'user-1', exp: now - 30 },
      rsaPrivateKey,
      { algorithm: 'RS256' }
    );
    const middleware = createAuthMiddleware(rsaPublicKey);
    const { nextCalled } = await runMiddleware(middleware, mockReq(token), mockRes());
    assert.ok(nextCalled, 'next() should be called for token within clock tolerance');
  });

  it('rejects token with wrong issuer', async () => {
    // Sign with issuer 'wrong-issuer'; verify expects 'https://auth.example.com'
    const token = jwt.sign({ sub: 'user-1' }, rsaPrivateKey, {
      algorithm: 'RS256',
      expiresIn: '1h',
      issuer: 'wrong-issuer'
    });
    const middleware = createAuthMiddleware(rsaPublicKey, { issuer: 'https://auth.example.com' });
    const { nextCalled, status } = await runMiddleware(middleware, mockReq(token), mockRes());
    assert.ok(!nextCalled, 'next() should NOT be called for wrong issuer');
    assert.equal(status, 401, 'Expected HTTP 401 for wrong issuer');
  });

  it('accepts token with correct issuer', async () => {
    const token = jwt.sign({ sub: 'user-1' }, rsaPrivateKey, {
      algorithm: 'RS256',
      expiresIn: '1h',
      issuer: 'https://auth.example.com'
    });
    const middleware = createAuthMiddleware(rsaPublicKey, { issuer: 'https://auth.example.com' });
    const { nextCalled } = await runMiddleware(middleware, mockReq(token), mockRes());
    assert.ok(nextCalled, 'next() should be called for correct issuer');
  });
});

// ---------------------------------------------------------------------------
// createJwksAuthMiddleware tests
// ---------------------------------------------------------------------------

describe('createJwksAuthMiddleware — algorithm enforcement', () => {
  /**
   * Mock JwksClient that returns the given key + algorithm without network I/O.
   */
  function mockJwksClient(key, algorithm) {
    return { getSigningKey: async () => ({ key, algorithm }) };
  }

  it('accepts RS256 token via JWKS', async () => {
    const token = jwt.sign({ sub: 'user-jwks' }, rsaPrivateKey, { algorithm: 'RS256', expiresIn: '1h' });
    const client = mockJwksClient(rsaPublicKey, 'RS256');
    const middleware = createJwksAuthMiddleware(client);
    const { nextCalled } = await runMiddleware(middleware, mockReq(token), mockRes());
    assert.ok(nextCalled, 'next() should be called for valid RS256 token via JWKS');
  });

  it('rejects HS256 token via JWKS with 401', async () => {
    // The algorithm block fires before the JWKS fetch, so even if the client
    // would return the secret, the middleware rejects based on the header alg.
    const token = jwt.sign({ sub: 'user-1' }, 'supersecret', { algorithm: 'HS256', expiresIn: '1h' });
    const client = mockJwksClient('supersecret', 'HS256');
    const middleware = createJwksAuthMiddleware(client);
    const { nextCalled, status } = await runMiddleware(middleware, mockReq(token), mockRes());
    assert.ok(!nextCalled, 'next() should NOT be called for HS256 token');
    assert.equal(status, 401, 'Expected HTTP 401 for HS256 token');
  });

  it('rejects alg=none token via JWKS with 401', async () => {
    const token = craftAlgNoneToken();
    // alg=none: the middleware should reject before even calling getSigningKey
    const client = mockJwksClient(rsaPublicKey, 'none');
    const middleware = createJwksAuthMiddleware(client);
    const { nextCalled, status } = await runMiddleware(middleware, mockReq(token), mockRes());
    assert.ok(!nextCalled, 'next() should NOT be called for alg=none token');
    assert.equal(status, 401, 'Expected HTTP 401 for alg=none token');
  });
});
