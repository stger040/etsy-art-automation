import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time setup utility: kicks off the Canva Connect OAuth (PKCE) flow so
 * you don't have to hand-generate a code challenge yourself. Visit this URL
 * in a browser (logged into the Canva account you want the pipeline to use),
 * approve, and /api/canva/callback will hand you a CANVA_REFRESH_TOKEN.
 *
 * Only requests the scopes lib/canva.ts actually uses — enable at least
 * these in Canva's "Your integrations > Scopes" tab first:
 *   asset (read+write), brandtemplate:content (read), design:content (read+write), design:meta (read)
 */
const SCOPES = [
  "asset:read",
  "asset:write",
  "brandtemplate:content:read",
  "design:content:read",
  "design:content:write",
  "design:meta:read",
].join(" ");

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("secret") !== requireEnv("CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = requireEnv("CANVA_CLIENT_ID");
  const redirectUri = new URL("/api/canva/callback", request.url).toString();

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const authorizeUrl = new URL("https://www.canva.com/api/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "s256");
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set("canva_oauth_verifier", codeVerifier, {
    httpOnly: true,
    secure: true,
    maxAge: 600,
    path: "/api/canva",
  });
  res.cookies.set("canva_oauth_state", state, { httpOnly: true, secure: true, maxAge: 600, path: "/api/canva" });
  return res;
}
