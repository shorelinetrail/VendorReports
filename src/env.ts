// Runtime configuration, all optional with local-dev defaults.
export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/vendortrak';

/** Port the HTTP server listens on. */
export const PORT = Number(process.env.PORT ?? 8788);

/** Directory report files are stored under (was the R2 bucket). */
export const FILES_DIR = process.env.FILES_DIR ?? 'data/reports';

/**
 * Set TRUST_PROXY=1 when running behind a TLS-terminating reverse proxy.
 * The app then derives its public origin from X-Forwarded-Proto/-Host
 * (secure cookies + CSRF origin check). Leave unset when exposed directly -
 * honoring these headers from arbitrary clients would be wrong.
 */
export const TRUST_PROXY = process.env.TRUST_PROXY === '1';
