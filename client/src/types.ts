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

export interface ParsedDice {
  count: number;
  sides: number;
}

export interface ClientToServerEvents {
  join: (payload: {
    instanceId: string;
    channelId: string;
    user: Omit<User, "socketId">;
  }) => void;
  roll_start: (payload: {
    instanceId: string;
    dice: string;
    isHidden: boolean;
  }) => void;
  // Fired on every one of the 3 taps (not just the last) so the server can
  // track progression and tell everyone (roller included — the roller
  // doesn't know their own result until the final tap either) which stage
  // to jump to next.
  roll_tap: (payload: {
    instanceId: string;
    rollId: string;
    // Whether the tapper's own current-stage video hadn't finished yet —
    // only meaningful for the 3rd tap, where it decides whether reveal3
    // starts at frame 0 or skips ahead to frame 40.
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
  // Broadcast to the whole room (roller included) on every tap — tells
  // every client watching this roll which stage to hard-cut to, since a
  // tap always interrupts whatever's currently playing rather than
  // waiting for it to finish.
  roll_advance: (payload: {
    rollId: string;
    stage: 1 | 2 | 3;
    // Only stages 2 and 3 have more than one version of the clip.
    variant?: "normal" | "gold" | "red" | "red-fake";
    // Only meaningful on stage 3 — start the clip at frame 40 instead of 0.
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
