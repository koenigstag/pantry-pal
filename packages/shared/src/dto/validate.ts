import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';

export interface FieldError {
  /** Dotted path, e.g. `name` or `address.city`. */
  property: string;
  messages: string[];
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: FieldError[] };

function flatten(errors: readonly ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const property = parent === '' ? error.property : `${parent}.${error.property}`;
    const own =
      error.constraints === undefined
        ? []
        : [{ property, messages: Object.values(error.constraints) }];
    const nested =
      error.children === undefined || error.children.length === 0
        ? []
        : flatten(error.children, property);

    return [...own, ...nested];
  });
}

/**
 * Validates a plain payload against a DTO class.
 *
 * The options mirror the backend's global `ValidationPipe`, so a payload the
 * client accepts is one the server will accept too — that equivalence is the
 * whole reason for sharing the DTOs rather than restating the rules.
 */
export function validateDto<T extends object>(
  dto: ClassConstructor<T>,
  payload: unknown,
): ValidationResult<T> {
  const instance = plainToInstance(dto, payload);
  const errors = validateSync(instance, { whitelist: true, forbidNonWhitelisted: true });

  return errors.length === 0
    ? { ok: true, value: instance }
    : { ok: false, errors: flatten(errors) };
}

/** Collapses errors to one message per field, for rendering beside inputs. */
export function toFieldMessages(errors: readonly FieldError[]): Record<string, string> {
  return Object.fromEntries(
    errors.map((error) => [error.property, error.messages[0] ?? 'Invalid value']),
  );
}
