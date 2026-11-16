import { z } from "zod";
import { useDb } from "../../../db";
import { createMovieLinkStore } from "../../../lib/movie-link-store";

const params = z.object({ id: z.coerce.number().int().positive() });

// Undoes a movie link you made (#17). Nothing at the sources changes.
export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, (v) => params.parse(v));
  if (!createMovieLinkStore(useDb()).remove(id))
    throw createError({ statusCode: 404, statusMessage: "No such link" });
  return { ok: true };
});
