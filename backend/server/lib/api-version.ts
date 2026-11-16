// The API contract's version (`info.version` in api/openapi.yaml), served by /api/health and built into the app.
// Bumped only on a breaking change; `scripts/check-api.mjs` fails when the two differ.
export const API_VERSION = 1;
