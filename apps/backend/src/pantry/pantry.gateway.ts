import { Logger, UseFilters, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import {
  PANTRY_COMMAND,
  PANTRY_EVENT,
  PANTRY_WS_NAMESPACE,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@pantry-pal/shared';
import { CreatePantryItemDto, DeletePantryItemDto } from '@pantry-pal/shared/dto';
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';

import { PantryService, type PantryChange } from './pantry.service';
import { WsExceptionFilter } from './ws-exception.filter';

type PantryServer = Server<ClientToServerEvents, ServerToClientEvents>;
type PantrySocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * CORS is not configured here: it is applied once in `PantryIoAdapter`, which
 * reads the allowed origins from config at bootstrap. Decorator options are
 * evaluated at import time, before `.env` has been loaded.
 */
@UseFilters(WsExceptionFilter)
@WebSocketGateway({ namespace: PANTRY_WS_NAMESPACE })
export class PantryGateway
  implements OnGatewayInit<PantryServer>, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(PantryGateway.name);
  private subscription?: Subscription;

  @WebSocketServer()
  private readonly server!: PantryServer;

  constructor(private readonly pantry: PantryService) {}

  afterInit(server: PantryServer): void {
    // One subscription for the whole namespace: every mutation, regardless of
    // whether it arrived over HTTP or the socket, fans out to all clients.
    this.subscription = this.pantry.changes$.subscribe((change) => {
      this.broadcast(server, change);
    });
    this.logger.log(`WebSocket namespace ready at ${PANTRY_WS_NAMESPACE}`);
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  handleConnection(client: PantrySocket): void {
    this.logger.debug(`Client connected: ${client.id}`);
    this.sendSnapshot(client);
  }

  handleDisconnect(client: PantrySocket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(PANTRY_COMMAND.Sync)
  handleSync(@ConnectedSocket() client: PantrySocket): void {
    this.sendSnapshot(client);
  }

  @SubscribeMessage(PANTRY_COMMAND.CreateItem)
  handleCreate(@MessageBody() dto: CreatePantryItemDto): void {
    // No direct emit: `changes$` drives the broadcast.
    this.pantry.create(dto);
  }

  @SubscribeMessage(PANTRY_COMMAND.DeleteItem)
  handleDelete(@MessageBody() payload: DeletePantryItemDto): void {
    this.pantry.remove(payload.id);
  }

  private sendSnapshot(client: PantrySocket): void {
    client.emit(PANTRY_EVENT.Snapshot, {
      items: this.pantry.findAll(),
      serverTime: new Date().toISOString(),
    });
  }

  private broadcast(server: PantryServer, change: PantryChange): void {
    switch (change.type) {
      case 'created':
        server.emit(PANTRY_EVENT.ItemCreated, { item: change.item });
        break;
      case 'updated':
        server.emit(PANTRY_EVENT.ItemUpdated, { item: change.item });
        break;
      case 'deleted':
        server.emit(PANTRY_EVENT.ItemDeleted, { id: change.id });
        break;
    }
  }
}
