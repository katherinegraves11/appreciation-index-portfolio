import { NextResponse } from "next/server";
import { ACCESS_COOKIE, isValidCode } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const code = String(form.get("code") ?? "").trim();
  const next = String(form.get("next") ?? "/");

  // a relative address, so a visitor on the public link stays on it (2026-10-26: through the tunnel the redirect went to localhost)
  const go = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });
  if (!isValidCode(code)) return go(`/enter?error=1&next=${encodeURIComponent(next)}`);

  const res = go(/^\/(?![\/\\])/.test(next) ? next : "/");
  res.cookies.set(ACCESS_COOKIE, code, {
    httpOnly: true,
    sameSite: "lax",
    // secure only over https (the tunnel); on the home Wi-Fi address (plain http) a secure cookie would never stick
    secure: req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
