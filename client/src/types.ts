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
  roll_reveal: (payload: { instanceId: string; rollId: string }) => void;
  roll_join: (payload: { instanceId: string; rollId: string }) => void;
  music_change: (payload: {
    instanceId: string;
    category: string;
    songIndex: number;
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
  roll_cancelled: (payload: { rollId: string; userId: string }) => void;
  error: (payload: { message: string }) => void;
  session_music: (payload: {
    category: string;
    songIndex: number;
    sfxVolumes: Record<string, number>;
  }) => void;
  music_sync: (payload: { category: string; songIndex: number }) => void;
  sfx_sync: (payload: { sfxId: string; volume: number }) => void;
}
