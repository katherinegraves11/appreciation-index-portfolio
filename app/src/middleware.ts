import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth";

// Simple passcode gate for the pilot. Set ACCESS_CODE in the environment to turn it on.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // The partner API (for a Lovable front end) uses its own key, "Authorization: Bearer <PUBLIC_API_KEY>", checked in each route.
  if (pathname.startsWith("/api/v1/")) return NextResponse.next();
  const expected = process.env.ACCESS_CODE;
  if (!expected) return NextResponse.next();

  if (pathname.startsWith("/enter") || pathname.startsWith("/api/enter")) return NextResponse.next();

  const cookie = req.cookies.get(ACCESS_COOKIE)?.value;
  if (cookie && cookie.trim() === expected.trim()) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Access code required." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/enter";
  url.search = ""; // a shared answer link (?brief=…&h=10) survives the passcode page
  url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
