import { getSessionToken } from "./session.server";
import { decodeDemoToken } from "./demo";

export type CurrentUser = { email: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  return decodeDemoToken(token);
}
