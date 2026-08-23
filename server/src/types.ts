export interface User {
  userId: string;
  username: string;
  avatar: string | null;
  socketId: string;
}

export interface RollEntry {
  id: string;
  userId: string;
  username: string;
  dice: string;
  results: number[];
  total: number;
  isHidden: boolean;
  timestamp: string;
}

export interface PendingRoll {
  rollId: string;
  userId: string;
  username: string;
  dice: string;
  results: number[];
  total: number;
  isHidden: boolean;
  timestamp: string;
  watcherIds: Set<string>;
  // How many of the 3 reveal taps have landed so far.
  tapCount: number;
  // Decided once at roll_start, only relevant when the roll is a clean
  // natural 20 (no natural 1 among the other dice) — 50% chance the
  // reveal teases a bad roll (red) before flipping to the real gold
  // result on the final tap.
  isFaked: boolean;
}

export interface ParsedDice {
  count: number;
  sides: number;
}

export interface ClientToServerEvents {
  join: (payload: {
    instanceId: string;
    channelId: string;
    user: Omit<User, 'socketId'>;
  }) => void;
  roll_start: (payload: {
    instanceId: string;
    dice: string;
    isHidden: boolean;
  }) => void;
  roll_tap: (payload: {
    instanceId: string;
    rollId: string;
    wasInterrupted: boolean;
  }) => void;
  roll_join: (payload: { instanceId: string; rollId: string }) => void;
  music_change: (payload: {
    instanceId: string;
    category: string;
    songIndex: number;
  }) => void;
  music_change_custom: (payload: {
    instanceId: string;
    youtubeId: string;
    offsetSeconds: number;
  }) => void;
  sfx_change: (payload: {
    instanceId: string;
    sfxId: string;
    volume: number;
  }) => void;
}

export interface ServerToClientEvents {
  session_users: (payload: { users: User[] }) => void;
  roll_history: (payload: { entries: RollEntry[] }) => void;
  user_joined: (payload: { user: User }) => void;
  user_left: (payload: { userId: string }) => void;
  roll_started: (payload: {
    rollId: string;
    userId: string;
    username: string;
    dice: string;
  }) => void;
  watcher_joined: (payload: {
    rollId: string;
    userId: string;
    username: string;
  }) => void;
  roll_revealed: (payload: { entry: RollEntry; watcherIds: string[] }) => void;
  roll_advance: (payload: {
    rollId: string;
    stage: 1 | 2 | 3;
    variant?: 'normal' | 'gold' | 'red' | 'red-fake';
    frame40?: boolean;
  }) => void;
  roll_cancelled: (payload: { rollId: string; userId: string }) => void;
  error: (payload: { message: string }) => void;
  session_music: (payload: {
    category: string;
    songIndex: number;
    customYoutubeId: string | null;
    customOffsetSeconds: number;
    startedAt: number;
    sfxVolumes: Record<string, number>;
  }) => void;
  music_sync: (payload: {
    category: string;
    songIndex: number;
    customYoutubeId: string | null;
    customOffsetSeconds: number;
    startedAt: number;
  }) => void;
  sfx_sync: (payload: { sfxId: string; volume: number }) => void;
}
