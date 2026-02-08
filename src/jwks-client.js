import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export class JwksClient {
  constructor(authServers) {
    // authServers: [{issuer, jwksUrl, cacheTtl?}]
    this.authServers = authServers;
    this.cache = new Map(); // key: issuerKey, value: {jwks, fetchedAt}
    this.defaultCacheTtl = 3600 * 1000; // 1 hour in ms
  }

  async getSigningKey(token) {
    // 1. Decode token header (without verification) to get kid and iss
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) throw new Error('Invalid token');

    const { kid, alg } = decoded.header;
    const iss = decoded.payload.iss;

    // 2. Find matching auth server by issuer (or use first if iss is '*' or not found)
    const server = this.authServers.find(s => s.issuer === iss || s.issuer === '*') || this.authServers[0];
    if (!server) throw new Error('No auth server configured for issuer: ' + iss);

    // 3. Fetch JWKS (cached)
    const jwks = await this.fetchJwks(server.issuer, server);

    // 4. Find key by kid
    const jwk = jwks.keys.find(k => k.kid === kid);
    if (!jwk) throw new Error('Signing key not found for kid: ' + kid);

    // 5. Convert JWK to PEM
    const key = this.jwkToPem(jwk);

    return { key, algorithm: alg || 'RS256' };
  }

  async fetchJwks(issuerKey, serverConfig) {
    const cacheTtl = (serverConfig.cacheTtl || this.defaultCacheTtl / 1000) * 1000;
    const cached = this.cache.get(issuerKey);

    if (cached && (Date.now() - cached.fetchedAt) < cacheTtl) {
      return cached.jwks;
    }

    const response = await fetch(serverConfig.jwksUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch JWKS from ' + serverConfig.jwksUrl + ': ' + response.status);
    }

    const jwks = await response.json();
    this.cache.set(issuerKey, { jwks, fetchedAt: Date.now() });

    return jwks;
  }

  jwkToPem(jwk) {
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  }
}
