import { query } from "./db";

type StoredToken = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

/**
 * Generic helper for OAuth providers with rotating refresh tokens (Etsy, Canva).
 * Seeds the Postgres-backed token row from env vars on first use, then keeps
 * itself fresh by calling `refresh` a little before expiry.
 */
export async function getValidAccessToken(params: {
  provider: string;
  seedAccessToken: string;
  seedRefreshToken: string;
  refresh: (refreshToken: string) => Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number }>;
}): Promise<string> {
  let [row] = await query<StoredToken>(`select access_token, refresh_token, expires_at from oauth_tokens where provider = $1`, [
    params.provider,
  ]);

  if (!row) {
    // First run: seed from env vars, but treat as already-expired so the
    // very first call refreshes and establishes a real expiry timestamp.
    await query(
      `insert into oauth_tokens (provider, access_token, refresh_token, expires_at)
       values ($1, $2, $3, now())
       on conflict (provider) do nothing`,
      [params.provider, params.seedAccessToken, params.seedRefreshToken]
    );
    [row] = await query<StoredToken>(`select access_token, refresh_token, expires_at from oauth_tokens where provider = $1`, [
      params.provider,
    ]);
  }

  const expiresAt = new Date(row.expires_at).getTime();
  const needsRefresh = Date.now() >= expiresAt - 60_000;

  if (!needsRefresh) {
    return row.access_token;
  }

  const refreshed = await params.refresh(row.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString();

  await query(
    `update oauth_tokens set access_token = $2, refresh_token = $3, expires_at = $4, updated_at = now()
     where provider = $1`,
    [params.provider, refreshed.accessToken, refreshed.refreshToken, newExpiresAt]
  );

  return refreshed.accessToken;
}
