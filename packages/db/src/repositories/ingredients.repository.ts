import { searchText } from '@pantry-pal/shared';
import { count, eq, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { ingredientNames, ingredientParents, ingredients } from '../schema';

/** An ingredient as a reader of one language sees it. */
export interface IngredientView {
  readonly id: string;
  /** In the reader's language, else English. */
  readonly name: string;
  /** The category its items most likely belong in, or `null`. */
  readonly category: string | null;
}

export interface IngredientMatch extends IngredientView {
  /**
   * The name the query matched, when that is not `name`: a synonym, or a name in
   * another language. A picker shows it beside the name, so "scallion" explains
   * why "green onion" came up.
   */
  readonly matchedName: string | null;
}

/**
 * A name to resolve to one ingredient, as `resolveName` takes it: folded by
 * `searchText`, and each of its words cut to a stem, so that an inflected
 * form (`яйца`, `сливочным маслом`) still finds `яйцо`, `сливочное масло`.
 */
export interface IngredientNameQuery {
  readonly folded: string;
  /** One per word, each at least three letters; empty to match by the whole name only. */
  readonly stems: readonly string[];
}

/** How alike a name must be, by trigrams, to be taken without matching whole or by stems. */
const RESOLVE_MIN_SIMILARITY = 0.55;

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

    const result = await this.db.execute<{ id: string; name: string; category: string | null }>(sql`
      select i.id, coalesce(d.name, i.name) as name, i.category
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
   * The one ingredient a recipe means by a name, or `null`: a name equal to it,
   * else one whose words start with its stems (as many words, any order), else
   * one alike by trigrams. Names in `language` win over English, which wins
   * over the rest; then the closer, then the more general — the one more
   * entries sit under, so `молоко` is milk rather than grade A milk.
   */
  async resolveName(query: IngredientNameQuery, language: string): Promise<string | null> {
    if (query.folded === '') return null;

    const byStems =
      query.stems.length === 0
        ? sql`false`
        : sql`(array_length(string_to_array(n.search_name, ' '), 1) = ${query.stems.length} and ${sql.join(
            query.stems.map((stem) => sql`(' ' || n.search_name) like ${`% ${escapeLike(stem)}%`}`),
            sql` and `,
          )})`;

    const result = await this.db.execute<{ id: string }>(sql`
      with candidates as (
        select
          n.ingredient_id,
          n.locale,
          n.is_primary,
          case when n.search_name = ${query.folded} then 0 when ${byStems} then 1 else 2 end as how,
          similarity(n.search_name, ${query.folded}) as closeness
        from ${ingredientNames} n
        where n.search_name = ${query.folded} or n.search_name % ${query.folded} or ${byStems}
      )
      select c.ingredient_id as id
      from candidates c
      where c.how < 2 or c.closeness >= ${RESOLVE_MIN_SIMILARITY}
      order by
        c.how,
        case c.locale when ${language} then 0 when 'en' then 1 else 2 end,
        c.closeness desc,
        (select count(*) from ${ingredientParents} p where p.parent_id = c.ingredient_id) desc,
        c.is_primary desc,
        c.ingredient_id
      limit 1`);

    return result.rows[0]?.id ?? null;
  }

  /**
   * Ingredients any of whose names, in any language stored, contain the query or
   * resemble it (trigram similarity), best first: the whole name, then its start,
   * then a later word's start, then anywhere, then only alike; within each, names
   * in `language`, then English, then the closest and shortest. Each ingredient once, by its best-matching name.
   *
   * Ingredients the reader's language names alike appear once.
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
      category: string | null;
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
      select b.ingredient_id as id, coalesce(d.name, i.name) as name, i.category,
        b.name as matched_name
      from best b
      join ${ingredients} i on i.id = b.ingredient_id
      left join ${ingredientNames} d
        on d.ingredient_id = b.ingredient_id and d.locale = ${language} and d.is_primary
      order by b.match_rank, b.language_rank, b.closeness desc, length(coalesce(d.name, i.name)), b.ingredient_id
      limit ${limit * 2}`);

    // The taxonomy has near twins (whiskey and whisky, veal and veal meat), which
    // a language may name alike: one of each name, the better ranked.
    const seen = new Set<string>();
    return result.rows
      .filter(({ name }) => {
        const key = searchText(name);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit)
      .map(({ id, name, category, matched_name }) => ({
        id,
        name,
        category,
        matchedName: searchText(matched_name) === searchText(name) ? null : matched_name,
      }));
  }
}
