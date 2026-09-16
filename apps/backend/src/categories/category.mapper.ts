import type { CategoryRow } from '@pantry-pal/db';
import type { Category } from '@pantry-pal/shared';

export function toCategory(row: CategoryRow): Category {
  return {
    code: row.code,
    label: row.label,
    sortOrder: row.sortOrder,
    isEdible: row.isEdible,
  };
}
