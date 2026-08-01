/**
 * Stub for the `server-only` package.
 *
 * That package is a build-time marker: its default entry throws, and bundlers
 * swap it for an empty module under the `react-server` condition. Vitest is
 * not a bundler, so importing a server module in a test hits the throwing
 * entry. Aliasing it here keeps the marker doing its real job in the app
 * while letting server-side logic be unit tested.
 */
export {}
