import {
  ASSISTANT_ACTION,
  MAX_ASSISTANT_ACTIONS,
  type AssistantActionType,
} from '@pantry-pal/shared';

import {
  boolean,
  date,
  integer,
  literal,
  nullable,
  number,
  object,
  string,
  uuid,
  type JsonSchema,
} from '../common/json-schema';

/*
 * `apply_changes`' input: the same actions the built-in assistant proposes
 * (`AssistantAction`), as the wire carries them, with real ids from
 * `get_pantry`. `ApplyAssistantActionsDto` validates what arrives; this schema
 * tells the client the shape, and its descriptions how to fill it.
 */

const described = (schema: JsonSchema, description: string): JsonSchema => ({
  ...schema,
  description,
});

function action(
  type: AssistantActionType,
  description: string,
  properties: Record<string, JsonSchema>,
): JsonSchema {
  return described(
    object({
      type: literal(type),
      quote: described(string, 'The words of the user the change comes from; "" if none.'),
      ...properties,
    }),
    description,
  );
}

const unitGroups = described(
  {
    type: 'array',
    minItems: 1,
    items: object({
      count: described(integer, 'How many units are in this state, 1 or more.'),
      expiresAt: described(nullable(date), 'Printed expiry date, YYYY-MM-DD, or null.'),
      openedAt: described(
        nullable(date),
        'When it was opened, or null. A unit below 100% with null is taken as opened today.',
      ),
      periodAfterOpeningDays: described(
        nullable(integer),
        'Days it keeps once opened (the "12M" symbol is 365), or null.',
      ),
      fillPercent: described(integer, 'How much is left, 1 to 100. 100 is full.'),
    }),
  },
  'Units alike, as groups: "3 packs plus one half used" is [{count: 3, fillPercent: 100, ...}, {count: 1, fillPercent: 50, ...}].',
);

const itemId = described(uuid, 'An item id from get_pantry.');

export const ACTIONS_SCHEMA: JsonSchema = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_ASSISTANT_ACTIONS,
  items: {
    anyOf: [
      action(
        ASSISTANT_ACTION.AddItem,
        'Something the household does not have in that storage space: a new item with its units. If an active item of that name is already in that space, its units are added to it instead.',
        {
          locationId: described(uuid, 'A storage space id from get_pantry.'),
          name: described(string, 'In the language the user wrote it, without amounts or dates.'),
          category: described(string, 'A category code from get_reference.'),
          unit: described(
            string,
            'A count unit code from get_reference (pcs, pack, bottle…): things are counted, never weighed.',
          ),
          sizeValue: described(
            nullable(number),
            'What one unit holds — 2 for a 2 kg bag — or null.',
          ),
          sizeUnit: described(
            nullable(string),
            'Any unit code for sizeValue (g, kg, ml, l…), or null.',
          ),
          units: unitGroups,
        },
      ),
      action(ASSISTANT_ACTION.AddUnits, 'More units of an item the household has.', {
        itemId,
        units: unitGroups,
      }),
      action(
        ASSISTANT_ACTION.SetQuantity,
        'How many there are now. More adds fresh units like the newest; fewer uses up the ones to go first.',
        { itemId, quantity: described(integer, '0 to 100.') },
      ),
      action(
        ASSISTANT_ACTION.UseUp,
        'Units used up — eaten, drunk, finished — the ones to go first: opened, then soonest to expire.',
        {
          itemId,
          count: described(
            nullable(integer),
            'How many; null, or as many as it has, for all of it.',
          ),
        },
      ),
      action(ASSISTANT_ACTION.Discard, 'Units thrown out, the ones to go first.', {
        itemId,
        count: described(nullable(integer), 'How many; null, or as many as it has, for all of it.'),
      }),
      action(
        ASSISTANT_ACTION.UpdateUnit,
        'One unit opened, partly used, or with a new printed date. A null field stays as it is.',
        {
          itemId,
          subItemId: described(uuid, "One of the item's unit ids from get_pantry."),
          expiresAt: nullable(date),
          openedAt: nullable(date),
          fillPercent: described(nullable(integer), '1 to 100.'),
        },
      ),
      action(ASSISTANT_ACTION.MoveItem, 'An item put in another storage space.', {
        itemId,
        locationId: described(uuid, 'A storage space id from get_pantry.'),
      }),
      action(
        ASSISTANT_ACTION.AddToList,
        'Something to buy, on a shopping list. Exactly one of itemId (an item the household has, any status) and newItem (something it has never had).',
        {
          listId: described(uuid, 'A shopping list id from get_pantry.'),
          itemId: nullable(uuid),
          newItem: nullable(
            object({
              name: string,
              category: described(string, 'A category code from get_reference.'),
              unit: described(string, 'A count unit code from get_reference.'),
              locationId: described(uuid, 'Where it goes once bought.'),
            }),
          ),
          quantity: described(integer, "How many to buy, in the item's count unit."),
        },
      ),
      action(
        ASSISTANT_ACTION.CheckEntry,
        'A list entry ticked off as in the basket, or back to buy.',
        {
          entryId: described(uuid, 'An entry id from get_pantry.'),
          checked: boolean,
        },
      ),
      action(
        ASSISTANT_ACTION.BuyEntry,
        "A list entry bought and brought home: its item gains the entry's quantity and the entry leaves the list.",
        { entryId: described(uuid, 'An entry id from get_pantry.') },
      ),
      action(ASSISTANT_ACTION.RemoveEntry, 'A list entry no longer to buy.', {
        entryId: described(uuid, 'An entry id from get_pantry.'),
      }),
    ],
  },
};
