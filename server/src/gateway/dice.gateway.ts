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

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

// reveal3 clips are 24fps — the client's own dramatic-reveal moment lands
// at frame 40 (see client/src/utils/rollAnimations.ts). The numeric result
// (roll_revealed — history/toast) is held back until that same moment so
// nobody in the room sees the number before the video itself reveals it,
// whether or not they're the one watching it play out.
const REVEAL3_FRAME40_MS = Math.round((40 / 24) * 1000);

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
  async handleJoin(
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

    // Must await so the socket is in the room before the broadcast below.
    // Without this, server.to(room).emit fires before the socket adapter
    // registers membership, causing user_joined to reach nobody.
    await socket.join(payload.instanceId);

    this.logger.log(
      `Session ${payload.instanceId} now has ${session.users.size} user(s)`,
    );

    socket.emit('session_users', { users: Array.from(session.users.values()) });
    socket.emit('roll_history', { entries: session.rollHistory });
    socket.emit('session_music', {
      category: session.musicCategory,
      songIndex: session.musicSongIndex,
      customYoutubeId: session.customYoutubeId,
      customOffsetSeconds: session.customOffsetSeconds,
      startedAt: session.musicStartedAt,
      sfxVolumes: session.sfxVolumes,
    });
    // Broadcast to the full room — the joining socket is now included,
    // so they see themselves too (the store deduplicates by userId).
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

    // "Faking" a reveal only makes sense for a clean natural 20 (no
    // natural 1 among the other dice muddying whether it's actually
    // good) — decided once, here, so every client (roller included, who
    // doesn't know their own result yet either) sees the same tease.
    const isD20 = payload.dice.endsWith('d20');
    const hasNat1 = isD20 && results.includes(1);
    const hasNat20 = isD20 && results.includes(20);
    const isFaked = hasNat20 && !hasNat1 && Math.random() < 0.5;

    this.logger.log(
      `roll_start: ${user.username} rolls ${payload.dice}${payload.isHidden ? ' [hidden]' : ''} → [${results.join(', ')}] = ${total}${isFaked ? ' (faked reveal)' : ''} (rollId: ${rollId})`,
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
      tapCount: 0,
      isFaked,
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

  @SubscribeMessage('roll_tap')
  handleRollTap(
    @MessageBody()
    payload: { instanceId: string; rollId: string; wasInterrupted: boolean },
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

    // Already at 3 (or a stray extra tap raced in) — nothing further to
    // advance to.
    if (pending.tapCount >= 3) return;
    pending.tapCount += 1;
    const stage = pending.tapCount as 1 | 2 | 3;

    const isD20 = pending.dice.endsWith('d20');
    const hasNat1 = isD20 && pending.results.includes(1);
    const hasNat20 = isD20 && pending.results.includes(20);

    let variant: 'normal' | 'gold' | 'red' | 'red-fake' | undefined;
    if (stage === 2) {
      variant = hasNat1 ? 'red' : hasNat20 ? (pending.isFaked ? 'red' : 'gold') : 'normal';
    } else if (stage === 3) {
      variant = hasNat1
        ? 'red'
        : hasNat20
          ? pending.isFaked
            ? 'red-fake'
            : 'gold'
          : 'normal';
    }

    const frame40 = stage === 3 ? payload.wasInterrupted : undefined;

    this.logger.log(
      `roll_tap: ${user.username} tap ${stage}/3 on ${pending.dice}` +
        (variant ? ` (variant=${variant})` : '') +
        (frame40 ? ' [frame40]' : ''),
    );

    const advancePayload = { rollId: payload.rollId, stage, variant, frame40 };
    if (pending.isHidden) {
      // A hidden roll never broadcasts roll_started to the room, so no one
      // else has watchingRollId set for it — but sending this to everyone
      // regardless would still leak the roll's existence and outcome tease
      // to anyone inspecting their own socket traffic.
      socket.emit('roll_advance', advancePayload);
    } else {
      this.server.to(payload.instanceId).emit('roll_advance', advancePayload);
    }

    if (stage < 3) return;

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

    const announce = () => {
      this.logger.log(
        `roll_tap: ${user.username} reveals ${pending.dice} → ${pending.total}` +
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
    };

    // frame40 already true means this tap itself skipped straight to
    // frame 40 (the video is already at the reveal moment) — announce
    // right away. Otherwise the clip is starting from 0, so hold the
    // number back until it would naturally reach frame 40.
    if (frame40) {
      announce();
    } else {
      setTimeout(announce, REVEAL3_FRAME40_MS);
    }
  }

  @SubscribeMessage('music_change')
  handleMusicChange(
    @MessageBody()
    payload: { instanceId: string; category: string; songIndex: number },
    @ConnectedSocket() socket: TypedSocket,
  ) {
    const session = this.sessionStore.get(payload.instanceId);
    if (!session) return;

    const user = Array.from(session.users.values()).find(
      (u) => u.socketId === socket.id,
    );
    if (!user) return;

    session.musicCategory = payload.category;
    session.musicSongIndex = payload.songIndex;
    // Picking a catalog category always exits custom-link playback.
    session.customYoutubeId = null;
    session.customOffsetSeconds = 0;
    session.musicStartedAt = Date.now();

    this.logger.log(
      `music_change: category=${payload.category} songIndex=${payload.songIndex} in ${payload.instanceId}`,
    );

    socket.to(payload.instanceId).emit('music_sync', {
      category: payload.category,
      songIndex: payload.songIndex,
      customYoutubeId: null,
      customOffsetSeconds: 0,
      startedAt: session.musicStartedAt,
    });
  }

  @SubscribeMessage('music_change_custom')
  handleMusicChangeCustom(
    @MessageBody()
    payload: { instanceId: string; youtubeId: string; offsetSeconds: number },
    @ConnectedSocket() socket: TypedSocket,
  ) {
    const session = this.sessionStore.get(payload.instanceId);
    if (!session) return;

    const user = Array.from(session.users.values()).find(
      (u) => u.socketId === socket.id,
    );
    if (!user) return;

    if (!VIDEO_ID_RE.test(payload.youtubeId)) {
      this.logger.warn(
        `music_change_custom: invalid video id "${payload.youtubeId}"`,
      );
      socket.emit('error', { message: 'Invalid YouTube video id' });
      return;
    }

    session.customYoutubeId = payload.youtubeId;
    session.customOffsetSeconds = Math.max(0, payload.offsetSeconds || 0);
    session.musicStartedAt = Date.now();

    this.logger.log(
      `music_change_custom: ${user.username} played ${payload.youtubeId} (offset=${session.customOffsetSeconds}s) in ${payload.instanceId}`,
    );

    socket.to(payload.instanceId).emit('music_sync', {
      category: session.musicCategory,
      songIndex: session.musicSongIndex,
      customYoutubeId: session.customYoutubeId,
      customOffsetSeconds: session.customOffsetSeconds,
      startedAt: session.musicStartedAt,
    });
  }

  @SubscribeMessage('sfx_change')
  handleSfxChange(
    @MessageBody()
    payload: { instanceId: string; sfxId: string; volume: number },
    @ConnectedSocket() socket: TypedSocket,
  ) {
    const session = this.sessionStore.get(payload.instanceId);
    if (!session) return;

    const user = Array.from(session.users.values()).find(
      (u) => u.socketId === socket.id,
    );
    if (!user) return;

    session.sfxVolumes[payload.sfxId] = payload.volume;

    this.logger.log(
      `sfx_change: sfxId=${payload.sfxId} volume=${payload.volume} in ${payload.instanceId}`,
    );

    socket.to(payload.instanceId).emit('sfx_sync', {
      sfxId: payload.sfxId,
      volume: payload.volume,
    });
  }
}
