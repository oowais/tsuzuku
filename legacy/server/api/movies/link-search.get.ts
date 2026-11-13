import { z } from "zod";
import { MovieLinkError, searchCandidates } from "../../lib/movie-links";
import { useSourceWrapper } from "../../lib/source-wrapper";
import { movieEntriesFrom, type MovieLists } from "../../lib/movies";

const query = z.object({
  target: z.enum(["trakt", "mal"]),
  q: z.string().trim().min(2).max(200),
  year: z.coerce.number().int().optional(),
});

// Movies to link a row to (#17): real results of a Trakt movie search or AniList's anime movies, best first.
// Read-only.
export default defineEventHandler(async (event) => {
  const { target, q, year } = await getValidatedQuery(event, (v) => query.parse(v));
  const wrapper = useSourceWrapper();
  const { entries } = movieEntriesFrom({
    trakt: wrapper.readCache("trakt", "movies"),
    mal: wrapper.readCache("mal", "movies"),
  } as MovieLists);
  const listed = {
    trakt: new Set(
      entries.flatMap((e) => (e.source === "trakt" && e.ids.trakt ? [e.ids.trakt] : [])),
    ),
    mal: new Set(entries.flatMap((e) => (e.source === "mal" && e.ids.mal ? [e.ids.mal] : []))),
  };
  try {
    return await searchCandidates(target, q, year ?? null, listed);
  } catch (err) {
    if (err instanceof MovieLinkError)
      throw createError({ statusCode: 502, statusMessage: err.message });
    throw err;
  }
});
