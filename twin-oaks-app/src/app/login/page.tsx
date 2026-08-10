import { Card, btnPrimaryCls, inputCls, labelCls } from "@/components/ui";
import { login } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-oak-700 text-xl font-bold text-white">
          TO
        </span>
        <h1 className="text-2xl font-bold text-stone-900">Twin Oaks OS</h1>
        <p className="text-sm text-stone-500">Owner sign-in</p>
      </div>
      <Card>
        <form action={login} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              className={inputCls}
            />
            {error ? (
              <p className="mt-1 text-sm font-medium text-red-600">
                Wrong password — try again.
              </p>
            ) : null}
          </div>
          <button type="submit" className={`${btnPrimaryCls} w-full`}>
            Sign in
          </button>
        </form>
      </Card>
      <p className="mt-4 text-center text-xs text-stone-400">
        30-day session on this device. Face ID / passkeys planned.
      </p>
    </div>
  );
}
