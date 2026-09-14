import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { Card } from "@/components/ui/primitives";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wider text-accent">
        Lifetime Athlete
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted">
        Your training data syncs to Supabase when you are online.
      </p>
      <Card className="mt-6">
        <LoginForm next={next ?? "/today"} error={error} />
        <p className="mt-4 text-center text-sm text-muted">
          No account?{" "}
          <Link href="/signup" className="font-medium text-accent">
            Create one
          </Link>
        </p>
      </Card>
    </div>
  );
}
