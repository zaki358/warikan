import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../src/env.js";
import { accessAuth } from "../src/middleware/auth.js";
import { ALLOWED_EMAIL, anonFetch, authedFetch, jsonBody, resetDb } from "./helpers.js";

type Envelope = { ok: boolean; error?: { code: string } };

describe("Access 認証", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("Cf-Access-Jwt-Assertion が無ければ 403", async () => {
    const res = await anonFetch("/api/me");

    expect(res.status).toBe(403);
    const body = await jsonBody<Envelope>(res);
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  it("署名が検証できないトークンは 403", async () => {
    const res = await anonFetch("/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": "not.a.valid.jwt" },
    });

    expect(res.status).toBe(403);
  });

  it("許可リストに無いメールは 403", async () => {
    const res = await authedFetch("/api/me", {}, "stranger@example.com");

    expect(res.status).toBe(403);
  });

  it("許可されたメールなら 200 で、users に行が自動作成される", async () => {
    const res = await authedFetch("/api/me");

    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?")
      .bind(ALLOWED_EMAIL)
      .first<{ display_name: string }>();
    expect(row?.display_name).toBe("me");
  });

  it("2回目のアクセスで重複した users 行を作らない", async () => {
    await authedFetch("/api/me");
    await authedFetch("/api/me");

    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it("エラーレスポンスに内部情報を含めない", async () => {
    const res = await anonFetch("/api/me");
    const text = await res.text();

    expect(text).not.toContain("jwt");
    expect(text).not.toContain("JWKS");
    expect(text).toContain("アクセス権がありません");
  });

});

describe("JWT の検証", () => {
  beforeEach(async () => {
    await resetDb();
  });

  /** 鍵を差し替えたミドルウェアだけを載せた最小アプリを組み立てる。 */
  async function probeApp() {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "RS256" }] });

    const app = new Hono<AppEnv>();
    app.use("*", accessAuth({ keyResolver: jwks }));
    app.get("/probe", (c) => c.json({ email: c.get("user").email }));

    const call = (token: string) =>
      app.fetch(new Request("https://warikan.test/probe", { headers: { "Cf-Access-Jwt-Assertion": token } }), {
        ...env,
        DEV_BYPASS_EMAIL: undefined,
      });

    return { privateKey, call };
  }

  const sign = (privateKey: CryptoKey, overrides: { issuer?: string; audience?: string; expiresIn?: string }) =>
    new SignJWT({ email: ALLOWED_EMAIL })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(overrides.issuer ?? `https://${env.ACCESS_TEAM_DOMAIN}`)
      .setAudience(overrides.audience ?? env.ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime(overrides.expiresIn ?? "5m")
      .sign(privateKey);

  it("正しく署名された JWT を受理する", async () => {
    const { privateKey, call } = await probeApp();
    const res = await call(await sign(privateKey, {}));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ email: ALLOWED_EMAIL });
  });

  it("issuer が違う JWT は 403", async () => {
    const { privateKey, call } = await probeApp();
    const res = await call(await sign(privateKey, { issuer: "https://evil.example.com" }));

    expect(res.status).toBe(403);
  });

  it("audience が違う JWT は 403", async () => {
    const { privateKey, call } = await probeApp();
    const res = await call(await sign(privateKey, { audience: "someone-elses-app" }));

    expect(res.status).toBe(403);
  });

  it("期限切れの JWT は 403", async () => {
    const { privateKey, call } = await probeApp();
    const res = await call(await sign(privateKey, { expiresIn: "-1m" }));

    expect(res.status).toBe(403);
  });

  it("別の鍵で署名された JWT は 403", async () => {
    const { call } = await probeApp();
    const { privateKey: otherKey } = await generateKeyPair("RS256", { extractable: true });
    const res = await call(await sign(otherKey, {}));

    expect(res.status).toBe(403);
  });
});
