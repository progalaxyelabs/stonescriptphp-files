# Changelog

All notable changes to `@progalaxyelabs/stonescriptphp-files` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [3.1.0] — 2026-04-16

### Added — Plugin hooks (non-breaking additions to `createFilesServer` config)

- **`config.hooks.authenticateRequest(req) → { userId, tenantId, ... } | throw`**
  Replaces the built-in JWKS/public-key auth entirely. Lets consumers integrate
  any auth provider without forking the library.
  Default: JWKS-based JWT verification (unchanged from v3.0.0 behaviour).

- **`config.hooks.resolveTenant(req, user) → string`**
  Returns the Azure Blob prefix used for all file operations for this request.
  Default: `tenantId ? \`${tenantId}/${userId}/\` : \`${userId}/\``

- **`config.hooks.onUpload(meta) → void`** (async-safe, optional)
  Called after a successful upload. Receives full file metadata plus `meta.req`.
  Errors in this hook are logged but do **not** fail the upload response.

- **`config.hooks.onDownload(meta) → void`** (async-safe, optional)
  Called after a successful download. Useful for audit logging.

- **New environment variables** (all optional, backward-compatible):
  - `BLOB_CONTAINER` — replaces `AZURE_CONTAINER_NAME` (old name still accepted as fallback)
  - `CORS_ORIGINS` — comma-separated CORS origins; defaults to `*`
  - `LOG_LEVEL` — `info` (default) | `warn` | `error`; suppresses request logging at `error` level
  - `MAX_UPLOAD_BYTES` — replaces hardcoded 100 MB default in code

- **`config.jwtIssuer` / `JWT_ISSUER` env** — pins the expected JWT `iss` claim
- **`config.jwtAudience` / `JWT_AUDIENCE` env** — pins the expected JWT `aud` claim
- **Clock skew tolerance** of exactly 60 seconds enforced on all JWT verification paths
- **Unit tests** for algorithm enforcement (Node.js built-in `node:test`):
  `npm test` covers RS256 accept, HS256 reject, alg=none reject, expired reject,
  issuer mismatch reject, and JWKS-path variants.

### Changed — Security hardening (tightened, not breaking for correct consumers)

- **`HS256` removed from allowed algorithm list.**
  `createAuthMiddleware` and `createJwksAuthMiddleware` now only accept
  `RS256` and `ES256`. Tokens signed with `HS256` or `alg=none` are rejected
  with HTTP 401 before signature verification is attempted.

  *Migration:* Re-sign tokens with RS256 or ES256. Asymmetric algorithms are
  required for proper public-key verification; symmetric `HS256` does not fit
  the public-key auth model this library is designed for.

- **`AzureStorageClient` methods** accept an optional `blobPrefix` final parameter.
  When supplied, it overrides the computed `tenantId/userId/scope` prefix.
  This is the integration point for the `resolveTenant` hook. Existing callers
  that omit the parameter are unaffected.

- **Container default name** changed from `platform-files` to `files`.
  Override via `BLOB_CONTAINER` env or `config.containerName`.

- Route factories now accept a `hooks` third/second parameter:
  `createUploadRouter(storage, maxFileSize, hooks)`,
  `createDownloadRouter(storage, hooks)`,
  `createListRouter(storage, hooks)`,
  `createDeleteRouter(storage, hooks)`.
  Callers that only pass the existing parameters are unaffected.

### Fixed

- Clock skew of up to 60 s no longer causes spurious `TokenExpiredError` on valid tokens
  issued by servers whose clocks differ slightly from the files-service host.

---

## [3.0.0] — 2026-02-07

Initial public release.

- Zero-config Express file server with Azure Blob Storage
- JWT Bearer token authentication (RS256 / ES256 / HS256)
- JWKS support via `AUTH_SERVERS` / `JWKS_URL`
- Multi-tenant blob namespacing (`tenantId/userId/` prefix)
- Optional per-request authorization via `AUTHORIZATION_URL`
- Rate limiting (upload / download windows)
- Composable exports for advanced usage
