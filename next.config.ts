import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // A stray package-lock.json at C:\Users\user\ (two directories above this
  // project) makes Turbopack infer the wrong workspace root, which surfaced
  // as an "Expected workStore to be initialized" invariant while
  // prerendering /_not-found. Pinning the root explicitly to this project
  // directory removes the ambiguity regardless of what lockfiles exist
  // elsewhere on disk.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
