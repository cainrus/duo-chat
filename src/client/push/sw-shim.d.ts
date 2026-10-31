// Type-only shim for type-checking the service worker (tsconfig.sw.json).
// The SW imports the device config, whose Profile type lives next to the UI contract
// (session/types.ts), and that file mentions MediaStream, which worker typings lack.
// The SW never touches media.
interface MediaStream {}
