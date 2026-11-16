import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { movieLinks } from "../db/schema";
import type { MovieLink } from "./movies";
import { USER_ID } from "./user";

// The movie links you confirmed (#17). Each holds IDs read from the sources; nothing here makes one up.
export function createMovieLinkStore(db: Db, userId = USER_ID) {
  function all(): (MovieLink & { title: string })[] {
    return db.select().from(movieLinks).where(eq(movieLinks.userId, userId)).all();
  }

  function add(link: Omit<typeof movieLinks.$inferInsert, "id" | "userId" | "createdAt">) {
    return db
      .insert(movieLinks)
      .values({ ...link, userId })
      .returning()
      .get();
  }

  function remove(id: number) {
    return (
      db
        .delete(movieLinks)
        .where(and(eq(movieLinks.userId, userId), eq(movieLinks.id, id)))
        .run().changes > 0
    );
  }

  return { all, add, remove };
}
