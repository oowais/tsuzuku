// An unknown API path is a 404 (JSON), as it has been since #108 step 4.3.
export default defineEventHandler(() => {
  throw createError({ statusCode: 404, statusMessage: "Not Found" });
});
