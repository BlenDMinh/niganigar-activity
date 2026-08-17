import { Injectable } from '@nestjs/common';
import { User, RollEntry, PendingRoll } from '../types';

export interface Session {
  instanceId: string;
  channelId: string;
  users: Map<string, User>;
  rollHistory: RollEntry[];
  pendingRolls: Map<string, PendingRoll>;
  musicCategory: string;
  musicSongIndex: number;
  // Set when someone plays a pasted YouTube link instead of a catalog
  // track. Takes precedence over musicCategory/musicSongIndex for
  // playback while set; cleared when a catalog category is picked again.
  customYoutubeId: string | null;
  // Start-time offset (seconds) parsed from the custom link's t=/start=
  // param, if any.
  customOffsetSeconds: number;
  // Server epoch ms when the current track started — clients derive their
  // playback position from this so everyone stays in sync.
  musicStartedAt: number;
  sfxVolumes: Record<string, number>;
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
        musicCategory: 'tavern',
        musicSongIndex: 0,
        customYoutubeId: null,
        customOffsetSeconds: 0,
        musicStartedAt: Date.now(),
        sfxVolumes: {},
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
