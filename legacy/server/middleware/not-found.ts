// Nothing but the API, the demo posters and the Flutter web build's static files (#108, step 4.3): any other path
// is a 404, instead of Nuxt's page renderer, which has no pages left. Static files are served before middleware;
// access.ts (earlier by name) still refuses requests without an Access token first.
export default defineEventHandler((event) => {
  const p = event.path;
  if (p.startsWith("/api/") || p.startsWith("/_demo/")) return;
  throw createError({ statusCode: 404, statusMessage: "Not Found" });
});
