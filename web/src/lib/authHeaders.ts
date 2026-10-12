import { getAccessToken } from "@privy-io/react-auth";

// JSON headers + the Privy access token, so the server can tell who is
// calling (lib/auth.ts) instead of trusting the posted wallet. Logged out →
// no Authorization header; the server decides what that may still do.
export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) return headers;
  const token = await getAccessToken().catch(() => null);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
