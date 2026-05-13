import { ServerClient } from "postmark";

let cachedClient: ServerClient | null = null;

export function getPostmarkClient(): ServerClient {
  if (cachedClient) return cachedClient;
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    throw new Error(
      "POSTMARK_SERVER_TOKEN is not set. Assign a domain in your admin panel to enable email.",
    );
  }
  cachedClient = new ServerClient(token);
  return cachedClient;
}
