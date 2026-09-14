import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";
import { Card } from "@/components/ui/primitives";

export default async function SignupPage({
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
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create account</h1>
      <p className="mt-2 text-sm text-muted">
        If confirmation email is enabled in Supabase Auth, confirm before signing
        in.
      </p>
      <Card className="mt-6">
        <SignupForm next={next ?? "/onboarding"} error={error} />
        <p className="mt-4 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
