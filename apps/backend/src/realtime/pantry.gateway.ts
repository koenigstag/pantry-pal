import { HttpException, Logger, UseFilters, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import {
  DEV_USER_HANDSHAKE_KEY,
  DEV_USER_HEADER,
  PANTRY_COMMAND,
  PANTRY_EVENT,
  PANTRY_WS_NAMESPACE,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@pantry-pal/shared';
import {
  CreatePantryItemCommandDto,
  DeletePantryItemCommandDto,
  SyncPantryDto,
} from '@pantry-pal/shared/dto';
import type { Subscription } from 'rxjs';
import type { DefaultEventsMap, ExtendedError, Namespace, Socket } from 'socket.io';

import { IdentityService } from '../auth/identity.service';
import type { AuthenticatedUser } from '../common/request-context';
import { HouseholdsService } from '../households/households.service';
import { MembershipService } from '../households/membership.service';
import { ItemsService } from '../items/items.service';
import { LocationsService } from '../locations/locations.service';
import { ChangeFeed } from './change-feed';
import type { DomainChange } from './domain-change';
import { WsExceptionFilter } from './ws-exception.filter';

interface SocketData {
  user: AuthenticatedUser;
}

type PantryNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SocketData
>;
type PantrySocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SocketData
>;

/** Every member's sockets are in their household's room; broadcasts go to the room. */
const householdRoom = (householdId: string): string => `household:${householdId}`;

/** Each user's sockets, across tabs and devices, so membership changes can move them all at once. */
const userRoom = (userId: string): string => `user:${userId}`;

/**
 * The single subscriber to `ChangeFeed`, and the only place socket events are
 * emitted.
 *
 * Identity is established once, at the handshake: a socket that cannot
 * authenticate never connects. Commands then resolve membership per call —
 * joining a room grants receiving, never acting.
 *
 * CORS is not configured here: it is applied once in `PantryIoAdapter`, which
 * reads the allowed origins from config at bootstrap. Decorator options are
 * evaluated at import time, before `.env` has been loaded.
 */
@UseFilters(WsExceptionFilter)
@WebSocketGateway({ namespace: PANTRY_WS_NAMESPACE })
export class PantryGateway
  implements OnGatewayInit<PantryNamespace>, OnGatewayConnection<PantrySocket>, OnModuleDestroy
{
  private readonly logger = new Logger(PantryGateway.name);
  private subscription?: Subscription;

  @WebSocketServer()
  private readonly server!: PantryNamespace;

  constructor(
    private readonly changes: ChangeFeed,
    private readonly identity: IdentityService,
    private readonly membership: MembershipService,
    private readonly households: HouseholdsService,
    private readonly items: ItemsService,
    private readonly locations: LocationsService,
  ) {}

  afterInit(server: PantryNamespace): void {
    server.use((socket, next) => {
      void this.admit(socket, next);
    });

    this.subscription = this.changes.changes$.subscribe((change) => {
      // RxJS rethrows a subscriber's error asynchronously, which would take the
      // process down. A failed broadcast is logged instead: clients recover on
      // their next sync.
      try {
        this.broadcast(server, change);
      } catch (error) {
        this.logger.error(`Broadcasting ${change.type} failed`, errorStack(error));
      }
    });

    this.logger.log(`WebSocket namespace ready at ${PANTRY_WS_NAMESPACE}`);
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /**
   * Joins the user's room first and lists households second, so a membership
   * granted in between is still picked up by `member.added` moving the user room.
   */
  async handleConnection(client: PantrySocket): Promise<void> {
    try {
      const { user } = client.data;
      await client.join(userRoom(user.id));

      const households = await this.households.listForUser(user.id);
      if (households.length > 0) {
        await client.join(households.map((household) => householdRoom(household.id)));
      }

      this.logger.debug(`Client ${client.id} connected as ${user.email}`);
    } catch (error) {
      this.logger.error(`Could not set up socket ${client.id}`, errorStack(error));
      client.disconnect(true);
    }
  }

  /** Replies with a snapshot of one household. Clients send it on every (re)connect. */
  @SubscribeMessage(PANTRY_COMMAND.Sync)
  async handleSync(
    @ConnectedSocket() client: PantrySocket,
    @MessageBody() dto: SyncPantryDto,
  ): Promise<void> {
    const membership = await this.membership.resolve(dto.householdId, client.data.user.id);
    const [items, locations] = await Promise.all([
      this.items.list(membership, {}),
      this.locations.list(membership),
    ]);

    client.emit(PANTRY_EVENT.Snapshot, {
      householdId: membership.householdId,
      items,
      locations,
      serverTime: new Date().toISOString(),
    });
  }

  @SubscribeMessage(PANTRY_COMMAND.CreateItem)
  async handleCreate(
    @ConnectedSocket() client: PantrySocket,
    @MessageBody() dto: CreatePantryItemCommandDto,
  ): Promise<void> {
    const { householdId, ...item } = dto;
    const membership = await this.membership.resolve(householdId, client.data.user.id);

    // No direct emit: `ChangeFeed` drives the broadcast.
    await this.items.create(membership, item);
  }

  @SubscribeMessage(PANTRY_COMMAND.DeleteItem)
  async handleDelete(
    @ConnectedSocket() client: PantrySocket,
    @MessageBody() dto: DeletePantryItemCommandDto,
  ): Promise<void> {
    const membership = await this.membership.resolve(dto.householdId, client.data.user.id);
    await this.items.remove(membership, dto.id);
  }

  /** Handshake middleware: a socket that cannot authenticate never connects. */
  private async admit(socket: PantrySocket, next: (error?: ExtendedError) => void): Promise<void> {
    try {
      await this.authenticate(socket);
    } catch (error) {
      next(this.toHandshakeError(error));
      return;
    }

    // Outside the try: an error thrown by a later middleware must not be
    // reported as a failed authentication, nor call `next` a second time.
    next();
  }

  private async authenticate(socket: PantrySocket): Promise<void> {
    // Browsers cannot set headers on a WebSocket, hence the handshake `auth`
    // payload; the header is accepted for non-browser clients.
    const auth = socket.handshake.auth as Record<string, unknown>;
    const claim = auth[DEV_USER_HANDSHAKE_KEY] ?? socket.handshake.headers[DEV_USER_HEADER];

    socket.data.user = await this.identity.authenticate(claim);
  }

  /** Reaches the client as `connect_error`, with the HTTP-style body in `data`. */
  private toHandshakeError(error: unknown): ExtendedError {
    if (error instanceof HttpException) {
      return Object.assign(new Error(error.message), { data: error.getResponse() });
    }

    this.logger.error('Socket handshake failed', errorStack(error));
    return new Error('Authentication failed');
  }

  private broadcast(server: PantryNamespace, change: DomainChange): void {
    switch (change.type) {
      case 'item.created':
        server
          .to(householdRoom(change.item.householdId))
          .emit(PANTRY_EVENT.ItemCreated, { item: change.item });
        break;

      case 'item.updated':
        server
          .to(householdRoom(change.item.householdId))
          .emit(PANTRY_EVENT.ItemUpdated, { item: change.item });
        break;

      case 'item.deleted':
        server
          .to(householdRoom(change.householdId))
          .emit(PANTRY_EVENT.ItemDeleted, { householdId: change.householdId, id: change.id });
        break;

      case 'location.created':
        server
          .to(householdRoom(change.location.householdId))
          .emit(PANTRY_EVENT.LocationCreated, { location: change.location });
        break;

      case 'location.updated':
        server
          .to(householdRoom(change.location.householdId))
          .emit(PANTRY_EVENT.LocationUpdated, { location: change.location });
        break;

      case 'location.deleted':
        server
          .to(householdRoom(change.householdId))
          .emit(PANTRY_EVENT.LocationDeleted, { householdId: change.householdId, id: change.id });
        break;

      case 'locations.reordered':
        server.to(householdRoom(change.householdId)).emit(PANTRY_EVENT.LocationsReordered, {
          householdId: change.householdId,
          locations: change.locations,
        });
        break;

      case 'locations.upserted':
        server.to(householdRoom(change.householdId)).emit(PANTRY_EVENT.LocationsUpserted, {
          householdId: change.householdId,
          locations: change.locations,
        });
        break;

      case 'household.updated':
        server
          .to(householdRoom(change.household.id))
          .emit(PANTRY_EVENT.HouseholdUpdated, { household: change.household });
        break;

      case 'household.deleted': {
        const room = householdRoom(change.householdId);
        server.to(room).emit(PANTRY_EVENT.HouseholdDeleted, { householdId: change.householdId });
        server.in(room).socketsLeave(room);
        break;
      }

      case 'member.added': {
        const room = householdRoom(change.member.householdId);
        // Join before emitting, so the new member's own sockets hear it too.
        server.in(userRoom(change.member.userId)).socketsJoin(room);
        server.to(room).emit(PANTRY_EVENT.MemberAdded, { member: change.member });
        break;
      }

      case 'member.updated':
        server
          .to(householdRoom(change.member.householdId))
          .emit(PANTRY_EVENT.MemberUpdated, { member: change.member });
        break;

      case 'member.removed': {
        const room = householdRoom(change.householdId);
        // Emit before leaving, so the removed member learns they were removed.
        server.to(room).emit(PANTRY_EVENT.MemberRemoved, {
          householdId: change.householdId,
          userId: change.userId,
        });
        server.in(userRoom(change.userId)).socketsLeave(room);
        break;
      }
    }
  }
}

function errorStack(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
