import type { JWTVerifyGetKey } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";

import { createUser, findUserByEmail } from "../db/users.js";
import type { AppEnv, Env } from "../env.js";
import { fail } from "../lib/response.js";

const jwksCache = new Map<string, JWTVerifyGetKey>();

function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  const cached = jwksCache.get(teamDomain);
  if (cached) return cached;

  const jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  jwksCache.set(teamDomain, jwks);
  return jwks;
}

function allowedEmails(env: Env): string[] {
  return env.ACCESS_ALLOWED_EMAILS.split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Cloudflare Access が付与する JWT を検証し、users の行を c.var.user に載せる。
 *
 * Cf-Access-Authenticated-User-Email ヘッダは Access を経由しないリクエストで
 * 詐称できるため使わない。必ず Cf-Access-Jwt-Assertion の署名を検証する。
 */
export function accessAuth(options: { keyResolver?: JWTVerifyGetKey } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const env = c.env;
    const allowed = allowedEmails(env);
    let email: string;

    if (env.DEV_BYPASS_EMAIL) {
      email = env.DEV_BYPASS_EMAIL.trim().toLowerCase();
    } else {
      const token = c.req.header("Cf-Access-Jwt-Assertion");
      if (!token) {
        return c.json(fail("FORBIDDEN", "アクセス権がありません"), 403);
      }

      try {
        const keyResolver = options.keyResolver ?? remoteJwks(env.ACCESS_TEAM_DOMAIN);
        const { payload } = await jwtVerify(token, keyResolver, {
          issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
          audience: env.ACCESS_AUD,
        });

        const claim = payload.email;
        if (typeof claim !== "string" || claim.length === 0) {
          return c.json(fail("FORBIDDEN", "アクセス権がありません"), 403);
        }
        email = claim.trim().toLowerCase();
      } catch {
        return c.json(fail("FORBIDDEN", "アクセス権がありません"), 403);
      }
    }

    if (!allowed.includes(email)) {
      return c.json(fail("FORBIDDEN", "アクセス権がありません"), 403);
    }

    const existing = await findUserByEmail(env.DB, email);
    const row = existing ?? (await createUser(env.DB, email, email.split("@")[0] ?? email));

    c.set("user", { id: row.id, email: row.email, displayName: row.display_name });
    await next();
  };
}
