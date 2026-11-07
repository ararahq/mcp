import type keytarModule from "keytar";

const SERVICE = "ararahq-mcp";
const ACCESS = "oauth-access-token";
const REFRESH = "oauth-refresh-token";
const EXPIRES = "oauth-expires-at";

type Keychain = typeof keytarModule;

/**
 * keytar is an optional native dependency used only by the local (stdio) login.
 * It is loaded on first use, so the hosted bundle and installs without libsecret
 * never touch it.
 */
const keychain = async (): Promise<Keychain> => {
  try {
    const module = await import("keytar");
    return module.default;
  } catch {
    throw new Error(
      "The OS keychain is unavailable (keytar did not load). Reinstall @ararahq/mcp with its optional dependencies.",
    );
  }
};

export type StoredToken = { accessToken: string; refreshToken?: string; expiresAt?: number };

export const saveToken = async (token: StoredToken): Promise<void> => {
  const keytar = await keychain();
  await keytar.setPassword(SERVICE, ACCESS, token.accessToken);
  if (token.refreshToken) await keytar.setPassword(SERVICE, REFRESH, token.refreshToken);
  if (token.expiresAt !== undefined)
    await keytar.setPassword(SERVICE, EXPIRES, String(token.expiresAt));
};

export const loadToken = async (): Promise<StoredToken | null> => {
  const keytar = await keychain();
  const accessToken = await keytar.getPassword(SERVICE, ACCESS);
  if (!accessToken) return null;
  const refreshToken = await keytar.getPassword(SERVICE, REFRESH);
  const expiresRaw = await keytar.getPassword(SERVICE, EXPIRES);
  const expiresAt = expiresRaw === null ? undefined : Number(expiresRaw);
  return {
    accessToken,
    ...(refreshToken === null ? {} : { refreshToken }),
    ...(expiresAt === undefined || !Number.isFinite(expiresAt) ? {} : { expiresAt }),
  };
};

export const clearToken = async (): Promise<void> => {
  const keytar = await keychain();
  await Promise.all(
    [ACCESS, REFRESH, EXPIRES].map((account) => keytar.deletePassword(SERVICE, account)),
  );
};
