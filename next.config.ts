import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // §8 bandwidth: keep the client bundle small. Server Components are the default;
  // the only client components in this app are the ones that genuinely need state.
  experimental: {
    optimizePackageImports: [],
    /*
     * APP-04 accepts documents up to 5MB, and a server action's body defaults
     * to 1MB — so a scanned transcript from a phone camera, which is exactly
     * what this audience uploads, would have been refused by the framework
     * with a message no candidate could act on. The ceiling here is the
     * documented limit plus room for the multipart envelope; `uploadProblem`
     * is still what tells someone their file is too big, in words.
     *
     * Raised from 6mb to 25mb for the faculty application, which carries a
     * CV and several academic and professional certificates at up to 5MB
     * each. Each form still enforces its own limits in code (every file 5MB,
     * that application 24MB in total: faculty-files.ts); this is only the
     * framework's outer ceiling.
     */
    serverActions: { bodySizeLimit: '25mb' },
  },
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
