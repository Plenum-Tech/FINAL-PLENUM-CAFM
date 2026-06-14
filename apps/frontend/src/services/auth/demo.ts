export function createDemoToken(email: string): string {
  return `demo:${Buffer.from(email).toString("base64url")}`;
}

export function decodeDemoToken(token: string): { email: string } | null {
  if (!token.startsWith("demo:")) return null;
  const encoded = token.slice("demo:".length);
  const email = Buffer.from(encoded, "base64url").toString("utf8").trim();
  if (!email) return null;
  return { email };
}
