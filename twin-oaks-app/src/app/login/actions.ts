"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionTokenFor } from "@/lib/session";

export async function login(formData: FormData) {
  const password = process.env.APP_PASSWORD;
  const attempt = formData.get("password");

  if (!password || typeof attempt !== "string" || attempt !== password) {
    redirect("/login?error=1");
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, await sessionTokenFor(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  redirect("/");
}
