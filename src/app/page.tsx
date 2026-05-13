import { Sparkles } from "lucide-react";

import { MeasuredTextBlock } from "@/components/MeasuredTextBlock";

const starterDescription =
  "This starter ships with Bun, Next.js App Router, Tailwind CSS, " +
  "lucide-react, React Query, and Pretext text measurement so your team " +
  "can move straight into product and marketing work instead of " +
  "re-scaffolding the basics.";

const COFOUNDER_APP_URL = "https://app.cofounder.co";

function repositoryDetailsFromVercelEnv() {
  const provider =
    process.env.NEXT_PUBLIC_VERCEL_GIT_PROVIDER?.trim() ||
    process.env.VERCEL_GIT_PROVIDER?.trim();
  const owner =
    process.env.NEXT_PUBLIC_VERCEL_GIT_REPO_OWNER?.trim() ||
    process.env.VERCEL_GIT_REPO_OWNER?.trim();
  const slug =
    process.env.NEXT_PUBLIC_VERCEL_GIT_REPO_SLUG?.trim() ||
    process.env.VERCEL_GIT_REPO_SLUG?.trim();

  if (!owner || !slug || (provider && provider.toLowerCase() !== "github")) {
    return null;
  }

  return {
    label: `${owner}/${slug}`,
    url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`,
  };
}

export default function HomePage() {
  const repositoryDetails = repositoryDetailsFromVercelEnv();

  return (
    <main className="grid min-h-screen place-items-center p-6 sm:p-10">
      <section className="w-full max-w-4xl overflow-hidden rounded-[32px] border border-white/70 bg-white/85 p-8 shadow-soft backdrop-blur md:p-12">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700">
          <Sparkles className="h-4 w-4" />
          Managed Repo Starter
        </div>
        <div className="grid gap-8 lg:grid-cols-[1.5fr_0.9fr] lg:items-end">
          <div>
            <h1 className="max-w-2xl text-5xl font-semibold text-ink">
              Your app is ready for the real build.
            </h1>
            <MeasuredTextBlock
              className="mt-5 max-w-2xl text-slate-600"
              text={starterDescription}
            />
          </div>
          <div className="rounded-3xl bg-slate-950 p-6 text-slate-50">
            <p className="text-sm uppercase text-blue-200">
              Included
            </p>
            <ul className="mt-4 space-y-3 text-sm text-slate-200">
              <li>Exact-version Bun install with a committed lockfile</li>
              <li>Next.js App Router and strict TypeScript config</li>
              <li>Tailwind, PostCSS, and autoprefixer ready to extend</li>
              <li>React Query provider wired at the app root</li>
              <li>Pretext ready for responsive text measurement</li>
            </ul>
            <div className="mt-6 border-t border-white/10 pt-5 text-sm leading-6 text-blue-100">
              <p>
                Get started in{" "}
                <a
                  className="font-semibold text-blue-200 underline underline-offset-4 transition hover:text-blue-100"
                  href={COFOUNDER_APP_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  Cofounder
                </a>
                ; this deployment will update as your team changes the repo.
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Source:{" "}
                {repositoryDetails ? (
                  <a
                    className="text-slate-300 underline underline-offset-4 transition hover:text-white"
                    href={repositoryDetails.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {repositoryDetails.label}
                  </a>
                ) : (
                  "edit src/app/page.tsx"
                )}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
