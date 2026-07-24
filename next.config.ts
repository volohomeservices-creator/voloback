import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: true,
  transpilePackages: ["@volo/shared-lib", "@volo/shared-types"],
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
  images: {
    loader: "custom",
    loaderFile: "./packages/shared-lib/src/lib/image-loader.ts",
  },
};

const withBundleAnalyzer = process.env.ANALYZE === "true"
  ? require("@next/bundle-analyzer")({ enabled: true })
  : (config: NextConfig) => config;

export default withBundleAnalyzer(nextConfig);
