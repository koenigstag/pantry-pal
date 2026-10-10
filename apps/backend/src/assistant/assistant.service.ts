import { Injectable } from '@nestjs/common';
import { CategoriesRepository, UnitsRepository } from '@pantry-pal/db';
import type { AssistantInterpretation } from '@pantry-pal/shared';
import type { InterpretTextDto } from '@pantry-pal/shared/dto';

import { toCategory } from '../categories/category.mapper';
import { ChangesService } from '../changes/changes.service';
import type { AuthenticatedUser, Membership } from '../common/request-context';
import { todayIn } from '../common/today';
import { toUnit } from '../units/unit.mapper';
import { AssistantModel } from './assistant-model';
import { describeHousehold } from './household-context';
import { readInterpretation } from './interpretation';
import { INSTRUCTIONS, referenceData } from './prompt';

/**
 * The text assistant: what someone writes becomes changes they confirm.
 *
 * `interpret` only reads: it sends the household and the text to the model and
 * answers with the actions it proposes, checked against the household. The
 * actions the user keeps are applied by `ChangesService`, which MCP clients
 * use too.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly model: AssistantModel,
    private readonly changes: ChangesService,
    private readonly units: UnitsRepository,
    private readonly categories: CategoriesRepository,
  ) {}

  get enabled(): boolean {
    return this.model.enabled;
  }

  /** 404 while the assistant is off. */
  assertEnabled(): void {
    this.model.assertEnabled();
  }

  async interpret(
    membership: Membership,
    user: AuthenticatedUser,
    dto: InterpretTextDto,
  ): Promise<AssistantInterpretation> {
    this.model.assertEnabled();

    // Read first, outside any transaction the model's answer would hold open.
    const snapshot = await this.changes.snapshot(membership);
    const units = (await this.units.list()).map(toUnit);
    const categories = (await this.categories.list()).map(toCategory);
    const { text: household, aliases } = describeHousehold(snapshot);
    const today = todayIn(user.timezone);

    const answer = await this.model.propose({
      instructions: INSTRUCTIONS,
      reference: referenceData(units, categories),
      user: [
        `Today is ${today} (${weekday(today)}). The person's language is ${user.locale}.`,
        '',
        '<household>',
        household,
        '</household>',
        '',
        '<text>',
        dto.text.replaceAll('</text>', '< /text>'),
        '</text>',
      ].join('\n'),
    });

    if (answer.kind === 'refused') {
      return { actions: [], unresolved: [{ quote: dto.text, reason: null }] };
    }
    return readInterpretation(answer.json, aliases, {
      unitKinds: new Map(units.map((unit) => [unit.code, unit.kind])),
      categories: new Set(categories.map((category) => category.code)),
    });
  }
}

/** The English name of a `YYYY-MM-DD` day's weekday, which "until Friday" is resolved against. */
function weekday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}
