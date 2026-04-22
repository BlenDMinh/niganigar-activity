import { Injectable } from '@nestjs/common';
import { User, RollEntry, PendingRoll } from '../types';

export interface Session {
  instanceId: string;
  channelId: string;
  users: Map<string, User>;
  rollHistory: RollEntry[];
  pendingRolls: Map<string, PendingRoll>;
}

@Injectable()
export class SessionStoreService {
  private readonly sessions = new Map<string, Session>();

  getOrCreate(instanceId: string, channelId: string): Session {
    if (!this.sessions.has(instanceId)) {
      this.sessions.set(instanceId, {
        instanceId,
        channelId,
        users: new Map(),
        rollHistory: [],
        pendingRolls: new Map(),
      });
    }
    return this.sessions.get(instanceId)!;
  }

  get(instanceId: string): Session | undefined {
    return this.sessions.get(instanceId);
  }

  delete(instanceId: string): void {
    this.sessions.delete(instanceId);
  }

  findBySocketId(
    socketId: string,
  ): { session: Session; user: User } | undefined {
    for (const session of this.sessions.values()) {
      for (const user of session.users.values()) {
        if (user.socketId === socketId) {
          return { session, user };
        }
      }
    }
    return undefined;
  }
}
