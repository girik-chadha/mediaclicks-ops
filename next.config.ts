import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // The dev badge renders bottom-left, directly over the Rail's clock — the
  // one element that must always be legible.
  devIndicators: false,
  // An unrelated package-lock.json in the Windows home directory makes Next
  // infer the wrong workspace root, which breaks file tracing on build.
  outputFileTracingRoot: import.meta.dirname,
  eslint: {
    // CI runs lint as its own job; don't pay for it twice during build.
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
