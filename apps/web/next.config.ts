import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The monorepo root, so tracing does not pick up an unrelated parent lockfile.
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  // Workspace packages ship TypeScript source and are compiled by Next.
  transpilePackages: [
    "@culture-shock/ui",
    "@culture-shock/config",
    "@culture-shock/contracts",
  ],
  // Server state never includes secrets; the API Worker owns all credentials.
  env: {
    NEXT_PUBLIC_API_BASE_PATH: "/api/v1",
  },
  webpack(config) {
    // Those packages use ESM-correct `.js` specifiers that resolve to `.ts` source.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  // In development the API Worker runs on its own port. Deployed, both sit
  // behind the same origin and this rewrite does nothing.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const target = process.env.DEV_API_ORIGIN ?? "http://localhost:8788";
    return [
      { source: "/api/v1/:path*", destination: `${target}/api/v1/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-content-type-options", value: "nosniff" },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          { key: "x-frame-options", value: "DENY" },
          {
            key: "permissions-policy",
            value:
              "geolocation=(), camera=(), microphone=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
