import path from "path";
import { fileURLToPath } from "url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Monorepo: Next only loads .env from this app dir by default. Merge repo-root
// .env / .env.local so OPENAI_API_KEY and other secrets can live in agent-economy/.env
// (values in agentflow-frontend/.env.local still override when Next loads them after).
const monorepoRoot = path.resolve(__dirname, "..");
loadEnvConfig(monorepoRoot);

// distDir must NOT follow repo-root NODE_ENV. Root `.env` often sets
// NODE_ENV=development for the API; that leaked into `next start` and made Next
// look for a production build under `.next-dev`. Derive dev vs prod output from
// how Next was invoked (npm lifecycle or CLI subcommand) instead.
const npmLifecycle = process.env.npm_lifecycle_event || "";
const nextCliSubcommand = process.argv[2];
const useNextDevDist =
  npmLifecycle === "dev" || nextCliSubcommand === "dev";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: useNextDevDist ? ".next-dev" : ".next",
  experimental: {
    optimizePackageImports: [
      "@rainbow-me/rainbowkit",
      "wagmi",
      "viem",
      "@tanstack/react-query",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": path.resolve(
        __dirname,
        "lib/shims/async-storage.ts",
      ),
      "pino-pretty": path.resolve(__dirname, "lib/shims/pino-pretty.ts"),
    };

    return config;
  },
};

export default nextConfig;
