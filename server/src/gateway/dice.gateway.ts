import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { SessionStoreService } from '../state/session-store.service';
import { parseDice, rollDice } from '../utils/dice';
import { ClientToServerEvents, ServerToClientEvents, User } from '../types';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

@WebSocketGateway({ cors: { origin: '*' } })
export class DiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: TypedServer;

  private readonly logger = new Logger(DiceGateway.name);

  constructor(private readonly sessionStore: SessionStoreService) {}

  handleConnection(socket: TypedSocket) {
    this.logger.log(`Socket connected: ${socket.id}`);
  }

  handleDisconnect(socket: TypedSocket) {
    const found = this.sessionStore.findBySocketId(socket.id);
    if (!found) {
      this.logger.log(`Socket disconnected (no session): ${socket.id}`);
      return;
    }

    const { session, user } = found;
    this.logger.log(
      `User disconnected: ${user.username} (${user.userId}) from session ${session.instanceId}`,
    );

    session.users.delete(user.userId);
    this.server
      .to(session.instanceId)
      .emit('user_left', { userId: user.userId });

    for (const [rollId, pending] of session.pendingRolls) {
      if (pending.userId === user.userId) {
        this.logger.log(
          `Cancelling pending roll ${rollId} for disconnected user ${user.username}`,
        );
        session.pendingRolls.delete(rollId);
        for (const [, u] of session.users) {
          if (pending.watcherIds.has(u.userId)) {
            this.server
              .to(u.socketId)
              .emit('roll_cancelled', { rollId, userId: user.userId });
          }
        }
      }
    }

    if (session.users.size === 0) {
      this.logger.log(`Session ${session.instanceId} is empty — destroying`);
      this.sessionStore.delete(session.instanceId);
    }
  }

  @SubscribeMessage('join')
  handleJoin(
    @MessageBody()
    payload: {
      instanceId: string;
      channelId: string;
      user: Omit<User, 'socketId'>;
    },
    @ConnectedSocket() socket: TypedSocket,
  ) {
    this.logger.log(
      `join: ${payload.user.username} (${payload.user.userId}) → session ${payload.instanceId}`,
    );

    const session = this.sessionStore.getOrCreate(
      payload.instanceId,
      payload.channelId,
    );
    const user: User = { ...payload.user, socketId: socket.id };
    session.users.set(user.userId, user);
    void socket.join(payload.instanceId);

    this.logger.log(
      `Session ${payload.instanceId} now has ${session.users.size} user(s)`,
    );

    socket.emit('session_users', { users: Array.from(session.users.values()) });
    socket.emit('roll_history', { entries: session.rollHistory });
    this.server.to(payload.instanceId).emit('user_joined', { user });
  }

  @SubscribeMessage('roll_start')
  handleRollStart(
    @MessageBody()
    payload: { instanceId: string; dice: string; isHidden: boolean },
    @ConnectedSocket() socket: TypedSocket,
  ) {
    const session = this.sessionStore.get(payload.instanceId);
    if (!session) {
      this.logger.warn(`roll_start: session not found (${payload.instanceId})`);
      socket.emit('error', { message: 'Session not found' });
      return;
    }

    const user = Array.from(session.users.values()).find(
      (u) => u.socketId === socket.id,
    );
    if (!user) {
      this.logger.warn(`roll_start: socket ${socket.id} not in session`);
      socket.emit('error', { message: 'User not in session' });
      return;
    }

    let parsed: { count: number; sides: number };
    try {
      parsed = parseDice(payload.dice);
    } catch (e) {
      this.logger.warn(
        `roll_start: invalid dice "${payload.dice}" — ${(e as Error).message}`,
      );
      socket.emit('error', { message: (e as Error).message });
      return;
    }

    const { results, total } = rollDice(parsed.count, parsed.sides);
    const rollId = randomUUID();

    this.logger.log(
      `roll_start: ${user.username} rolls ${payload.dice}${payload.isHidden ? ' [hidden]' : ''} → [${results.join(', ')}] = ${total} (rollId: ${rollId})`,
    );

    session.pendingRolls.set(rollId, {
      rollId,
      userId: user.userId,
      username: user.username,
      dice: payload.dice,
      results,
      total,
      isHidden: payload.isHidden,
      timestamp: new Date().toISOString(),
      watcherIds: new Set([user.userId]),
    });

    const rollStartedPayload = {
      rollId,
      userId: user.userId,
      username: user.username,
      dice: payload.dice,
    };
    if (payload.isHidden) {
      socket.emit('roll_started', rollStartedPayload);
    } else {
      this.server
        .to(payload.instanceId)
        .emit('roll_started', rollStartedPayload);
    }
  }

  @SubscribeMessage('roll_join')
  handleRollJoin(
    @MessageBody() payload: { instanceId: string; rollId: string },
    @ConnectedSocket() socket: TypedSocket,
  ) {
    const session = this.sessionStore.get(payload.instanceId);
    if (!session) return;

    const pending = session.pendingRolls.get(payload.rollId);
    if (!pending) return;

    const joiner = Array.from(session.users.values()).find(
      (u) => u.socketId === socket.id,
    );
    if (!joiner) return;

    pending.watcherIds.add(joiner.userId);
    this.logger.log(
      `roll_join: ${joiner.username} watching roll ${payload.rollId} (${pending.watcherIds.size} watcher(s))`,
    );

    for (const [, u] of session.users) {
      if (pending.watcherIds.has(u.userId)) {
        this.server.to(u.socketId).emit('watcher_joined', {
          rollId: payload.rollId,
          userId: joiner.userId,
          username: joiner.username,
        });
      }
    }
  }

  @SubscribeMessage('roll_reveal')
  handleRollReveal(
    @MessageBody() payload: { instanceId: string; rollId: string },
    @ConnectedSocket() socket: TypedSocket,
  ) {
    const session = this.sessionStore.get(payload.instanceId);
    if (!session) return;

    const pending = session.pendingRolls.get(payload.rollId);
    if (!pending) return;

    const user = Array.from(session.users.values()).find(
      (u) => u.socketId === socket.id,
    );
    if (!user || user.userId !== pending.userId) return;

    session.pendingRolls.delete(payload.rollId);

    const entry = {
      id: payload.rollId,
      userId: pending.userId,
      username: pending.username,
      dice: pending.dice,
      results: pending.results,
      total: pending.total,
      isHidden: pending.isHidden,
      timestamp: pending.timestamp,
    };

    const watcherIds = Array.from(pending.watcherIds);

    this.logger.log(
      `roll_reveal: ${user.username} reveals ${pending.dice} → ${pending.total}` +
        (pending.isHidden
          ? ' [hidden, not stored]'
          : ` (broadcasting to ${watcherIds.length} watcher(s))`),
    );

    if (pending.isHidden) {
      socket.emit('roll_revealed', { entry, watcherIds });
    } else {
      session.rollHistory.push(entry);
      this.server
        .to(payload.instanceId)
        .emit('roll_revealed', { entry, watcherIds });
    }
  }
}
