"use client";

import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();

  async function logout() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button type="button" onClick={logout} className="text-sm text-muted hover:text-text">
      {label}
    </button>
  );
}
