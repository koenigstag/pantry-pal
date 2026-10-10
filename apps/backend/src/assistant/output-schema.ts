import { ASSISTANT_ACTION, type AssistantActionType } from '@pantry-pal/shared';

import {
  boolean,
  date,
  integer,
  literal,
  nullable,
  number,
  object,
  string,
  type JsonSchema,
} from '../common/json-schema';

/*
 * The JSON the model answers with, held to this schema by structured outputs.
 *
 * It never varies — ids are plain strings the server checks, never
 * per-household enums — so it compiles once and stays cached. Ranges and
 * lengths are not expressible in structured outputs' schemas; the shared DTOs
 * check them once the answer is read.
 *
 * Ids here are the prompt's short aliases (L1, I1, U1, S1, E1), which the
 * server maps back to the household's ids. A unit alias names its item too, so
 * `update-unit` takes the unit alone.
 */

function action(type: AssistantActionType, properties: Record<string, JsonSchema>): JsonSchema {
  return object({ type: literal(type), quote: string, ...properties });
}

const unitGroups: JsonSchema = {
  type: 'array',
  items: object({
    count: integer,
    expiresAt: nullable(date),
    openedAt: nullable(date),
    periodAfterOpeningDays: nullable(integer),
    fillPercent: integer,
  }),
};

export const OUTPUT_SCHEMA: JsonSchema = object({
  actions: {
    type: 'array',
    items: {
      anyOf: [
        action(ASSISTANT_ACTION.AddItem, {
          locationId: string,
          name: string,
          category: string,
          unit: string,
          sizeValue: nullable(number),
          sizeUnit: nullable(string),
          units: unitGroups,
        }),
        action(ASSISTANT_ACTION.AddUnits, { itemId: string, units: unitGroups }),
        action(ASSISTANT_ACTION.SetQuantity, { itemId: string, quantity: integer }),
        action(ASSISTANT_ACTION.UseUp, { itemId: string, count: nullable(integer) }),
        action(ASSISTANT_ACTION.Discard, { itemId: string, count: nullable(integer) }),
        action(ASSISTANT_ACTION.UpdateUnit, {
          unitId: string,
          expiresAt: nullable(date),
          openedAt: nullable(date),
          fillPercent: nullable(integer),
        }),
        action(ASSISTANT_ACTION.MoveItem, { itemId: string, locationId: string }),
        action(ASSISTANT_ACTION.AddToList, {
          listId: string,
          itemId: nullable(string),
          newItem: nullable(
            object({ name: string, category: string, unit: string, locationId: string }),
          ),
          quantity: integer,
        }),
        action(ASSISTANT_ACTION.CheckEntry, { entryId: string, checked: boolean }),
        action(ASSISTANT_ACTION.BuyEntry, { entryId: string }),
        action(ASSISTANT_ACTION.RemoveEntry, { entryId: string }),
      ],
    },
  },
  unresolved: { type: 'array', items: object({ quote: string, reason: string }) },
});
