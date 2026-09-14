import { signUp } from "@/lib/auth/actions";
import { PrimaryButton } from "@/components/ui/primitives";

export function SignupForm({
  next,
  error,
}: {
  next: string;
  error?: string;
}) {
  return (
    <form action={signUp} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">
        Email
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
        />
      </label>
      <label className="block text-sm">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-3"
        />
      </label>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <PrimaryButton className="w-full" type="submit">
        Create account
      </PrimaryButton>
    </form>
  );
}
