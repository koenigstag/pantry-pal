import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type {
  AssistantApplyResult,
  AssistantInterpretation,
  AssistantStatus,
} from '@pantry-pal/shared';
import { ApplyAssistantActionsDto, InterpretTextDto } from '@pantry-pal/shared/dto';

import { ASSISTANT_REQUESTS } from '../auth/rate-limits';
import {
  CurrentMembership,
  CurrentUser,
  type AuthenticatedUser,
  type Membership,
} from '../common/request-context';
import { HouseholdAccessGuard } from '../households/household-access.guard';
import { AssistantService } from './assistant.service';

/**
 * The text assistant. Interpreting only reads and proposes; applying writes
 * what the user kept. Both answer 404 while the server has no
 * `ANTHROPIC_API_KEY`, which `GET /assistant` tells clients up front.
 */
@Controller()
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('assistant')
  status(): AssistantStatus {
    return { enabled: this.assistant.enabled };
  }

  /** The changes a text describes, for the user to confirm. Nothing is written. */
  @Post('households/:householdId/assistant/interpret')
  @HttpCode(HttpStatus.OK)
  @UseGuards(HouseholdAccessGuard, ThrottlerGuard)
  @Throttle(ASSISTANT_REQUESTS)
  interpret(
    @CurrentMembership() membership: Membership,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InterpretTextDto,
  ): Promise<AssistantInterpretation> {
    return this.assistant.interpret(membership, user, dto);
  }

  /** The actions the user kept, applied in one transaction. */
  @Post('households/:householdId/assistant/apply')
  @HttpCode(HttpStatus.OK)
  @UseGuards(HouseholdAccessGuard)
  apply(
    @CurrentMembership() membership: Membership,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApplyAssistantActionsDto,
  ): Promise<AssistantApplyResult> {
    return this.assistant.apply(membership, user, dto);
  }
}
