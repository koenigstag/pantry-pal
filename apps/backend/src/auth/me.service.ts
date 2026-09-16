import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from '@pantry-pal/db';
import type { UpdateMeDto } from '@pantry-pal/shared/dto';

import type { AuthenticatedUser } from '../common/request-context';
import { toAuthenticatedUser } from './identity.service';

/**
 * The caller's own settings. Nothing is broadcast: other members never see
 * them, and the caller's other tabs pick a new language up when they reload.
 */
@Injectable()
export class MeService {
  constructor(private readonly users: UsersRepository) {}

  async update(user: AuthenticatedUser, dto: UpdateMeDto): Promise<AuthenticatedUser> {
    const row = await this.users.update(user.id, { locale: dto.locale });
    if (row === undefined) throw new NotFoundException('User not found');
    return toAuthenticatedUser(row);
  }
}
