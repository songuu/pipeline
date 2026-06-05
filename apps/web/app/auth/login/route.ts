import { NextResponse } from "next/server";

/**
 * 控制台登录校验：比对 CONSOLE_LOGIN_PASSWORD，成功则下发 dm_session cookie
 * （值为 CONSOLE_SESSION_SECRET，nginx 用它做边缘门禁）。密码只在服务端比对，
 * 不进前端包。
 */
export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.CONSOLE_LOGIN_PASSWORD ?? "";
  const secret = process.env.CONSOLE_SESSION_SECRET ?? "";

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    password = "";
  }

  if (!expected || !secret || !timingSafeEqual(password, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("dm_session", secret, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

// Length-independent constant-time comparison to avoid leaking the password via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
