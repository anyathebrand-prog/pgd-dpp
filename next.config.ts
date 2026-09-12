import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // §8 bandwidth: keep the client bundle small. Server Components are the default;
  // the only client components in this app are the ones that genuinely need state.
  experimental: { optimizePackageImports: [] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default config;
