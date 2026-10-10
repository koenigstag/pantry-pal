import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  ASSISTANT_ACTION,
  ASSISTANT_ACTIONS,
  FULL_FILL_PERCENT,
  MAX_ASSISTANT_ACTIONS,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_CATEGORY_CODE_LENGTH,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_QUANTITY,
  MAX_PERIOD_AFTER_OPENING_DAYS,
  MAX_SIZE_VALUE,
  MAX_UNIT_CODE_LENGTH,
  MIN_FILL_PERCENT,
  SIZE_DECIMAL_PLACES,
} from '../constants';
import type { AssistantActionType } from '../constants';
import { IsIsoDate, IsNullable, Trim } from './decorators';

/*
 * The text assistant's actions, as the client sends back the ones the user kept.
 * The server validates the model's proposals with these same classes before
 * answering, and again on apply: a proposal is only ever a request.
 *
 * Nullable fields are always sent, `null` or a value (`@IsNullable`), as the
 * wire types say: `undefined` is refused, so no reader has to tell it apart.
 *
 * What a DTO cannot state is checked by the server: that every id belongs to
 * the household, that codes exist, that an item's units stay within
 * `MAX_ITEM_QUANTITY`, and that an `add-to-list` names an item or a new one.
 */

/** `POST .../assistant/interpret`. */
export class InterpretTextDto {
  @Trim()
  @IsString()
  @Length(1, MAX_ASSISTANT_TEXT_LENGTH)
  text!: string;
}

export class AssistantUnitGroupDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_QUANTITY)
  count!: number;

  @IsNullable()
  @IsIsoDate()
  expiresAt!: string | null;

  @IsNullable()
  @IsIsoDate()
  openedAt!: string | null;

  @IsNullable()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PERIOD_AFTER_OPENING_DAYS)
  periodAfterOpeningDays!: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(MIN_FILL_PERCENT)
  @Max(FULL_FILL_PERCENT)
  fillPercent!: number;
}

/** What every action has; the subclasses below add the rest, picked by `type`. */
export class AssistantActionDto {
  @IsIn([...ASSISTANT_ACTIONS])
  type!: AssistantActionType;

  @IsString()
  @MaxLength(MAX_ASSISTANT_TEXT_LENGTH)
  quote!: string;
}

/** A unit group list: at least one group, and never more groups than an item holds units. */
function UnitGroups(): PropertyDecorator {
  return (target, key) => {
    IsArray()(target, key);
    ArrayMinSize(1)(target, key);
    ArrayMaxSize(MAX_ITEM_QUANTITY)(target, key);
    ValidateNested({ each: true })(target, key);
    Type(() => AssistantUnitGroupDto)(target, key);
  };
}

export class AssistantAddItemDto extends AssistantActionDto {
  @IsUUID()
  locationId!: string;

  @Trim()
  @IsString()
  @Length(1, MAX_ITEM_NAME_LENGTH)
  name!: string;

  @IsString()
  @Length(1, MAX_CATEGORY_CODE_LENGTH)
  category!: string;

  @IsString()
  @Length(1, MAX_UNIT_CODE_LENGTH)
  unit!: string;

  @IsNullable()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: SIZE_DECIMAL_PLACES })
  @IsPositive()
  @Max(MAX_SIZE_VALUE)
  sizeValue!: number | null;

  @IsNullable()
  @IsString()
  @Length(1, MAX_UNIT_CODE_LENGTH)
  sizeUnit!: string | null;

  @UnitGroups()
  units!: AssistantUnitGroupDto[];
}

export class AssistantAddUnitsDto extends AssistantActionDto {
  @IsUUID()
  itemId!: string;

  @UnitGroups()
  units!: AssistantUnitGroupDto[];
}

export class AssistantSetQuantityDto extends AssistantActionDto {
  @IsUUID()
  itemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ITEM_QUANTITY)
  quantity!: number;
}

/** `use-up` and `discard`: `count` units, or the whole item when `null`. */
export class AssistantTakeDto extends AssistantActionDto {
  @IsUUID()
  itemId!: string;

  @IsNullable()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_QUANTITY)
  count!: number | null;
}

/** A `null` field is left as it is. */
export class AssistantUpdateUnitDto extends AssistantActionDto {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  subItemId!: string;

  @IsNullable()
  @IsIsoDate()
  expiresAt!: string | null;

  @IsNullable()
  @IsIsoDate()
  openedAt!: string | null;

  @IsNullable()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_FILL_PERCENT)
  @Max(FULL_FILL_PERCENT)
  fillPercent!: number | null;
}

export class AssistantMoveItemDto extends AssistantActionDto {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  locationId!: string;
}

export class AssistantNewListItemDto {
  @Trim()
  @IsString()
  @Length(1, MAX_ITEM_NAME_LENGTH)
  name!: string;

  @IsString()
  @Length(1, MAX_CATEGORY_CODE_LENGTH)
  category!: string;

  @IsString()
  @Length(1, MAX_UNIT_CODE_LENGTH)
  unit!: string;

  @IsUUID()
  locationId!: string;
}

export class AssistantAddToListDto extends AssistantActionDto {
  @IsUUID()
  listId!: string;

  @IsNullable()
  @IsUUID()
  itemId!: string | null;

  @IsNullable()
  @IsObject()
  @ValidateNested()
  @Type(() => AssistantNewListItemDto)
  newItem!: AssistantNewListItemDto | null;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(MAX_ITEM_QUANTITY)
  quantity!: number;
}

export class AssistantCheckEntryDto extends AssistantActionDto {
  @IsUUID()
  entryId!: string;

  @IsBoolean()
  checked!: boolean;
}

/** `buy-entry` and `remove-entry`. */
export class AssistantEntryDto extends AssistantActionDto {
  @IsUUID()
  entryId!: string;
}

/** Which class validates an action, by its `type`. */
export const ASSISTANT_ACTION_DTOS = [
  { name: ASSISTANT_ACTION.AddItem, value: AssistantAddItemDto },
  { name: ASSISTANT_ACTION.AddUnits, value: AssistantAddUnitsDto },
  { name: ASSISTANT_ACTION.SetQuantity, value: AssistantSetQuantityDto },
  { name: ASSISTANT_ACTION.UseUp, value: AssistantTakeDto },
  { name: ASSISTANT_ACTION.Discard, value: AssistantTakeDto },
  { name: ASSISTANT_ACTION.UpdateUnit, value: AssistantUpdateUnitDto },
  { name: ASSISTANT_ACTION.MoveItem, value: AssistantMoveItemDto },
  { name: ASSISTANT_ACTION.AddToList, value: AssistantAddToListDto },
  { name: ASSISTANT_ACTION.CheckEntry, value: AssistantCheckEntryDto },
  { name: ASSISTANT_ACTION.BuyEntry, value: AssistantEntryDto },
  { name: ASSISTANT_ACTION.RemoveEntry, value: AssistantEntryDto },
] satisfies Array<{ name: AssistantActionType; value: typeof AssistantActionDto }>;

/** `POST .../assistant/apply`: the actions the user kept, applied all or nothing. */
export class ApplyAssistantActionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ASSISTANT_ACTIONS)
  @ValidateNested({ each: true })
  @Type(() => AssistantActionDto, {
    discriminator: { property: 'type', subTypes: ASSISTANT_ACTION_DTOS },
    keepDiscriminatorProperty: true,
  })
  actions!: AssistantActionDto[];
}
