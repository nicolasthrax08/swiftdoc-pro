import type { NextConfig } from "next";

const isPreviewOrStaging =
  process.env.VERCEL_TARGET_ENV === "preview" ||
  process.env.VERCEL_TARGET_ENV === "staging" ||
  process.env.VERCEL_ENV === "preview" ||
  process.env.RAILWAY_ENVIRONMENT_NAME === "staging";

const browserProxyBaseUrls = [
  process.env.PROXY_BASE_URL,
  process.env.GIC_PROXY_BASE_URL,
  process.env.BROWSER_PROXY_BASE_URL,
  process.env.GIC_BROWSER_PROXY_BASE_URL,
  process.env.BROWSER_CDP_PROXY_BASE_URL,
  process.env.GIC_BROWSER_CDP_PROXY_BASE_URL,
  process.env.LOCAL_NGROK_URL,
];

const toAllowedDevOrigin = (value: string | undefined): string | null => {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  const normalizedValue = trimmedValue.includes("://")
    ? trimmedValue
    : `https://${trimmedValue}`;
  try {
    return new URL(normalizedValue).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const allowedDevOrigins = Array.from(
  new Set([
    "127.0.0.1",
    ...browserProxyBaseUrls
      .map(toAllowedDevOrigin)
      .filter((origin): origin is string => origin !== null),
  ]),
);

const defaultPreviewFrameAncestors = [
  "'self'",
  "https://app.cofounder.co",
  "https://staging.app.cofounder.co",
  "https://cto.cofounder.co",
  "https://staging.cto.cofounder.co",
];

const previewFrameAncestors = Array.from(
  new Set([
    ...defaultPreviewFrameAncestors,
    ...(process.env.COFOUNDER_PREVIEW_FRAME_ANCESTORS ?? "")
      .split(/[\s,]+/)
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]),
);

const nextConfig: NextConfig = {
  allowedDevOrigins,
  turbopack: {},
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${previewFrameAncestors.join(" ")};`,
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    if (isPreviewOrStaging) {
      config.optimization = {
        ...config.optimization,
        minimize: false,
      };
    }

    return config;
  },
};

export default nextConfig;
