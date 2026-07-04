import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return new NextResponse(`Canva returned an error: ${oauthError}`, { status: 400 });
  }

  const cookieStore = cookies();
  const codeVerifier = cookieStore.get("canva_oauth_verifier")?.value;
  const cookieState = cookieStore.get("canva_oauth_state")?.value;

  if (!code || !codeVerifier || !state || state !== cookieState) {
    return new NextResponse(
      "Missing or mismatched OAuth state/code/verifier — the flow must start at /api/canva/authorize (don't open this URL directly).",
      { status: 400 }
    );
  }

  const clientId = requireEnv("CANVA_CLIENT_ID");
  const clientSecret = requireEnv("CANVA_CLIENT_SECRET");
  const redirectUri = new URL("/api/canva/callback", request.url).toString();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: { authorization: `Basic ${basicAuth}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    return new NextResponse(`Token exchange failed (${tokenRes.status}): ${text}`, { status: 500 });
  }

  const json = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number };

  return new NextResponse(
    "Canva connected.\n\n" +
      "Copy this into the CANVA_REFRESH_TOKEN Vercel env var, then redeploy:\n\n" +
      `${json.refresh_token}\n\n` +
      "This page isn't stored anywhere and won't be shown again — copy it now.\n" +
      "(The app will keep it fresh on its own after that; see lib/oauth-store.ts.)",
    { headers: { "content-type": "text/plain" } }
  );
}
