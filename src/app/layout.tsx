import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import Providers from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Managed Next.js Starter",
  description: "A seeded Next.js starter with Supabase SSR and React Query.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const isPreviewEnvironment =
    process.env.NODE_ENV !== "development" &&
    (process.env.VERCEL_TARGET_ENV === "preview" ||
      process.env.VERCEL_ENV === "preview");

  return (
    <html lang="en">
      <body className="min-h-screen">
        {isPreviewEnvironment ? (
          <Script
            src="https://app.cofounder.co/agentation/widget.js"
            strategy="afterInteractive"
          />
        ) : null}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
