/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Fonts are loaded from a <link> in the layout. Next's build-time stylesheet
  // inlining needs network access during `next build`, which some CI sandboxes
  // block, so it's turned off for a deterministic build everywhere.
  optimizeFonts: false,
};
export default nextConfig;
