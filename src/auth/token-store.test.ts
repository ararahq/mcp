import { afterEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const fakeKeytar = {
  getPassword: vi.fn((service: string, account: string) =>
    Promise.resolve(store.get(`${service}:${account}`) ?? null),
  ),
  setPassword: vi.fn((service: string, account: string, value: string) => {
    store.set(`${service}:${account}`, value);
    return Promise.resolve();
  }),
  deletePassword: vi.fn((service: string, account: string) =>
    Promise.resolve(store.delete(`${service}:${account}`)),
  ),
};

afterEach(() => {
  store.clear();
  vi.resetModules();
  vi.doUnmock("keytar");
});

describe("token store", () => {
  it("should round-trip a token through the OS keychain", async () => {
    vi.doMock("keytar", () => ({ default: fakeKeytar }));
    const { clearToken, loadToken, saveToken } = await import("./token-store.js");

    await saveToken({ accessToken: "a", refreshToken: "r", expiresAt: 42 });
    expect(await loadToken()).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: 42 });

    await clearToken();
    expect(await loadToken()).toBeNull();
  });

  it("should load without keytar and fail only when the keychain is used", async () => {
    vi.doMock("keytar", () => {
      throw new Error("libsecret-1.so.0: cannot open shared object file");
    });
    const { loadToken } = await import("./token-store.js");

    await expect(loadToken()).rejects.toThrow(/OS keychain is unavailable/);
  });
});
