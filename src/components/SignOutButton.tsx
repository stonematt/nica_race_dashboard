import { signOut } from '@/auth.ts';

export function SignOutButton() {
  return (
    <form
      action={async () => {
        'use server';
        await signOut({ redirectTo: '/signin' });
      }}
    >
      <button
        type="submit"
        className="cursor-pointer underline underline-offset-4 hover:text-white"
      >
        Sign out
      </button>
    </form>
  );
}
