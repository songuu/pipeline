import { NextResponse } from "next/server";

/** 退出登录：清除 dm_session cookie 并回到登录页。 */
export async function GET(request: Request): Promise<NextResponse> {
  const origin = new URL(request.url).origin;
  const response = NextResponse.redirect(`${origin}/login`);
  response.cookies.set("dm_session", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
