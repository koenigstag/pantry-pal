import { searchText } from '@pantry-pal/shared';
import { count, eq, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { ingredientNames, ingredients } from '../schema';

/** An ingredient as a reader of one language sees it. */
export interface IngredientView {
  readonly id: string;
  /** In the reader's language, else English. */
  readonly name: string;
}

export interface IngredientMatch extends IngredientView {
  /**
   * The name the query matched, when that is not `name`: a synonym, or a name in
   * another language. A picker shows it beside the name, so "scallion" explains
   * why "green onion" came up.
   */
  readonly matchedName: string | null;
}

/** `%`, `_` and the escape character itself, taken literally by `LIKE`. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export class IngredientsRepository {
  constructor(private readonly db: Database) {}

  async exists(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(eq(ingredients.id, id))
      .limit(1);
    return row !== undefined;
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(ingredients);
    return row?.total ?? 0;
  }

  /**
   * The named ingredients, in `language`. Ids that name none are left out, in no
   * particular order.
   */
  async findByIds(ids: readonly string[], language: string): Promise<IngredientView[]> {
    if (ids.length === 0) return [];

    const result = await this.db.execute<{ id: string; name: string }>(sql`
      select i.id, coalesce(d.name, i.name) as name
      from ${ingredients} i
      left join ${ingredientNames} d
        on d.ingredient_id = i.id and d.locale = ${language} and d.is_primary
      where i.id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`);

    return result.rows;
  }

  /**
   * Ingredients any of whose names, in any language stored, contain the query or
   * resemble it (trigram similarity), best first: the whole name, then its start,
   * then a later word's start, then anywhere, then only alike; within each, names
   * in `language`, then English, then the closest and shortest. Each ingredient once, by its best-matching name.
   *
   * Every language is searched, not only the reader's: a household may type in
   * two, and the taxonomy's translations have gaps that English fills.
   */
  async search(query: string, language: string, limit: number): Promise<IngredientMatch[]> {
    const folded = searchText(query);
    if (folded === '') return [];
    const contains = `%${escapeLike(folded)}%`;
    const startsWith = `${escapeLike(folded)}%`;
    const wordStartsWith = `% ${escapeLike(folded)}%`;

    const result = await this.db.execute<{
      id: string;
      name: string;
      matched_name: string;
    }>(sql`
      with matches as (
        select
          n.ingredient_id,
          n.name,
          case
            when n.search_name = ${folded} then 0
            when n.search_name like ${startsWith} then 1
            when n.search_name like ${wordStartsWith} then 2
            when n.search_name like ${contains} then 3
            else 4
          end as match_rank,
          case n.locale when ${language} then 0 when 'en' then 1 else 2 end as language_rank,
          n.is_primary,
          similarity(n.search_name, ${folded}) as closeness
        from ${ingredientNames} n
        where n.search_name like ${contains} or n.search_name % ${folded}
      ),
      best as (
        select distinct on (ingredient_id) *
        from matches
        order by ingredient_id, match_rank, language_rank, is_primary desc, closeness desc
      )
      select b.ingredient_id as id, coalesce(d.name, i.name) as name, b.name as matched_name
      from best b
      join ${ingredients} i on i.id = b.ingredient_id
      left join ${ingredientNames} d
        on d.ingredient_id = b.ingredient_id and d.locale = ${language} and d.is_primary
      order by b.match_rank, b.language_rank, b.closeness desc, length(coalesce(d.name, i.name)), b.ingredient_id
      limit ${limit}`);

    return result.rows.map(({ id, name, matched_name }) => ({
      id,
      name,
      matchedName: searchText(matched_name) === searchText(name) ? null : matched_name,
    }));
  }
}
