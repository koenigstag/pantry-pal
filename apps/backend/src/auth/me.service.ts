import { Injectable, NotFoundException } from '@nestjs/common';
import { HouseholdMembersRepository, Transactional, UsersRepository } from '@pantry-pal/db';
import type { UpdateMeDto } from '@pantry-pal/shared/dto';

import type { AuthenticatedUser } from '../common/request-context';
import { toHouseholdMember } from '../households/household.mapper';
import { ChangeFeed } from '../realtime/change-feed';
import { toAuthenticatedUser } from './identity.service';

/**
 * The caller's own settings: name, units, date of birth and language.
 *
 * Only a new name is broadcast, as `member.updated` to each of the caller's
 * households, since members see each other by name. The rest is the caller's
 * alone, and their other tabs pick it up when they next load it.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly users: UsersRepository,
    private readonly members: HouseholdMembersRepository,
    private readonly changes: ChangeFeed,
  ) {}

  @Transactional()
  async update(user: AuthenticatedUser, dto: UpdateMeDto): Promise<AuthenticatedUser> {
    const row = await this.users.update(user.id, {
      displayName: dto.displayName,
      unitSystem: dto.unitSystem,
      birthDate: dto.birthDate,
      locale: dto.locale,
    });
    if (row === undefined) throw new NotFoundException('User not found');

    if (dto.displayName !== undefined && dto.displayName !== user.displayName) {
      // Read after the update, in the same transaction, so each carries the new name.
      for (const member of await this.members.listForUser(user.id)) {
        this.changes.publish({ type: 'member.updated', member: toHouseholdMember(member) });
      }
    }

    return toAuthenticatedUser(row);
  }
}
