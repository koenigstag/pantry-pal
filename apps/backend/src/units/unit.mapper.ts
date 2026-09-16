import type { UnitRow } from '@pantry-pal/db';
import type { Unit } from '@pantry-pal/shared';

export function toUnit(row: UnitRow): Unit {
  return {
    code: row.code,
    label: row.label,
    kind: row.kind,
    system: row.system,
    factor: row.factor,
  };
}
