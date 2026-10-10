import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { CategoriesRepository, UnitsRepository, UsersRepository } from '@pantry-pal/db';
import { ITEM_STATUS, type PantryItem } from '@pantry-pal/shared';
import { ApplyAssistantActionsDto, validateDto } from '@pantry-pal/shared/dto';

import { toAuthenticatedUser } from '../auth/identity.service';
import { ChangesService, type HouseholdSnapshot } from '../changes/changes.service';
import { todayIn } from '../common/today';
import { translateDatabaseError } from '../database/database-errors';
import { HouseholdsService } from '../households/households.service';
import { MembershipService } from '../households/membership.service';
import type { PantryAuthExtra } from '../oauth/oauth-provider';
import { ACTIONS_SCHEMA } from './action-schema';
import { MCP_INSTRUCTIONS } from './instructions';

const householdId = {
  type: 'string',
  format: 'uuid',
  description: 'A household id from list_households.',
};

const TOOLS: Tool[] = [
  {
    name: 'list_households',
    title: 'List households',
    description: "The households the user belongs to, with their ids and the user's role.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_pantry',
    title: 'Read a household',
    description:
      "Everything in one household as it is now: storage spaces; active items with each unit's dates and how much is left; shopping lists in use with their entries; and items off the shelf that an entry names. Also today's date where the user is. Read it before apply_changes: every id comes from here.",
    inputSchema: {
      type: 'object',
      properties: { householdId },
      required: ['householdId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_reference',
    title: 'Units and categories',
    description:
      'The unit codes (count units for quantities, any unit for sizes) and category codes items use. The same for every household.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'apply_changes',
    title: 'Change the pantry',
    description:
      'Applies changes to one household — items added, used up, thrown out, opened, moved; shopping list entries added, ticked, bought, removed — all or nothing. If any change is refused, none is applied and the answer says why. Nothing is ever deleted.',
    inputSchema: {
      type: 'object',
      properties: { householdId, actions: ACTIONS_SCHEMA },
      required: ['householdId', 'actions'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

const text = (value: string): CallToolResult => ({ content: [{ type: 'text', text: value }] });
const json = (value: unknown): CallToolResult => text(JSON.stringify(value));
const refused = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/**
 * The MCP server an assistant elsewhere talks to, one per request, acting as
 * the user its OAuth token names. Its tools read a household and apply changes
 * to it through `ChangesService`, the same path as the built-in assistant's
 * Apply, so every rule, lock, history entry and broadcast holds, and the
 * user's devices pull the result.
 *
 * Membership is checked on every call, as the REST routes check it: a token
 * names a user, never a household, and losing a household loses its access.
 */
@Injectable()
export class McpToolsService {
  constructor(
    private readonly households: HouseholdsService,
    private readonly membership: MembershipService,
    private readonly changes: ChangesService,
    private readonly users: UsersRepository,
    private readonly units: UnitsRepository,
    private readonly categories: CategoriesRepository,
  ) {}

  createServer(): Server {
    const server = new Server(
      { name: 'pantry-pal', title: 'Pantry Pal', version: '1.0.0' },
      { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS },
    );

    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const userId = userOf(extra.authInfo);
      const args = request.params.arguments ?? {};
      try {
        return await this.call(request.params.name, userId, args);
      } catch (error) {
        // A refusal the assistant can act on: what was wrong, in the services' words.
        const http = error instanceof HttpException ? error : translateDatabaseError(error);
        if (http !== undefined) return refused(messageOf(http));
        throw error;
      }
    });
    return server;
  }

  private async call(
    tool: string,
    userId: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (tool) {
      case 'list_households': {
        const households = await this.households.listForUser(userId);
        return json(households.map(({ id, name, role }) => ({ id, name, role })));
      }

      case 'get_pantry': {
        const membership = await this.membership.resolve(stringArg(args, 'householdId'), userId);
        const user = await this.user(userId);
        return json({
          today: todayIn(user.timezone),
          ...compact(await this.changes.snapshot(membership)),
        });
      }

      case 'get_reference': {
        const units = await this.units.list();
        const categories = await this.categories.list();
        return json({
          units: units.map(({ code, label, kind }) => ({ code, label, kind })),
          categories: categories.map(({ code, label }) => ({ code, label })),
        });
      }

      case 'apply_changes': {
        const membership = await this.membership.resolve(stringArg(args, 'householdId'), userId);
        const dto = validateDto(ApplyAssistantActionsDto, { actions: args.actions });
        if (!dto.ok) {
          return refused(
            `Nothing was changed. ${dto.errors
              .map((error) => `${error.property}: ${error.messages.join('; ')}`)
              .join('\n')}`,
          );
        }
        const result = await this.changes.apply(membership, await this.user(userId), dto.value);
        return text(
          `Applied ${result.applied} change${result.applied === 1 ? '' : 's'}. The user's devices show them now.`,
        );
      }

      default:
        return refused(`Unknown tool: ${tool}`);
    }
  }

  private async user(userId: string) {
    const row = await this.users.findById(userId);
    if (row === undefined) throw new UnauthorizedException('The account no longer exists');
    return toAuthenticatedUser(row);
  }
}

/** Whose token it is; the bearer middleware has verified it before the server runs. */
function userOf(authInfo: AuthInfo | undefined): string {
  const extra = authInfo?.extra as Partial<PantryAuthExtra> | undefined;
  if (typeof extra?.userId !== 'string') throw new UnauthorizedException('No user for this token');
  return extra.userId;
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value === '') {
    throw new HttpException(`${name} is required`, 400);
  }
  return value;
}

function messageOf(error: HttpException): string {
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('\n');
  return typeof message === 'string' ? message : error.message;
}

/** An item as `get_pantry` lists it, with its units while it is on the shelf. */
function listedItem(row: PantryItem) {
  return {
    id: row.id,
    name: row.name,
    locationId: row.locationId,
    category: row.category,
    status: row.status,
    quantity: row.quantity,
    unit: row.unit,
    size:
      row.sizeValue === null || row.sizeUnit === null ? null : `${row.sizeValue} ${row.sizeUnit}`,
    ...(row.notes !== null && { notes: row.notes }),
    units:
      row.status === ITEM_STATUS.Active
        ? row.subItems.map((unit) => ({
            id: unit.id,
            expiresAt: unit.expiresAt,
            openedAt: unit.openedAt,
            periodAfterOpeningDays: unit.periodAfterOpeningDays,
            effectiveExpiresAt: unit.effectiveExpiresAt,
            fillPercent: unit.fillPercent,
          }))
        : [],
  };
}

/**
 * The household in the shape an assistant reads best: no timestamps or
 * household ids, units under their item, entries under their list, sizes as one
 * phrase. Items off the shelf appear only when an entry names them.
 */
function compact(snapshot: HouseholdSnapshot) {
  const onShelf = new Set(snapshot.items.map((item) => item.id));

  return {
    storageSpaces: snapshot.locations.map(({ id, name, isFallback }) => ({ id, name, isFallback })),
    items: [
      ...snapshot.items.map(listedItem),
      ...snapshot.listedItems.filter((row) => !onShelf.has(row.id)).map(listedItem),
    ],
    shoppingLists: snapshot.lists.map((list) => ({
      id: list.id,
      name: list.name,
      entries: snapshot.entries
        .filter((entry) => entry.listId === list.id)
        .map((entry) => ({
          id: entry.id,
          itemId: entry.itemId,
          quantity: entry.quantity,
          checked: entry.checkedAt !== null,
        })),
    })),
  };
}
