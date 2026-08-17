import React, { createContext, useContext, useReducer } from "react";
import type { User, RollEntry } from "../types";

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => k !== key),
  ) as T;
}

interface PendingRollInfo {
  rollId: string;
  userId: string;
  username: string;
  dice: string;
}

export interface State {
  currentUser: Omit<User, "socketId"> | null;
  instanceId: string | null;
  channelId: string | null;
  users: User[];
  rollHistory: RollEntry[];
  // Ids appended only on a live ROLL_REVEALED (never on the ROLL_HISTORY
  // sync sent at join) — this is what RollToast watches so it doesn't
  // replay the whole history as toasts when a player joins.
  newRollIds: string[];
  pendingRolls: Record<string, PendingRollInfo>;
  musicCategory: string;
  musicSongIndex: number;
  // Set when someone plays a pasted YouTube link instead of a catalog
  // track. Takes precedence over musicCategory/musicSongIndex for
  // playback while set.
  customYoutubeId: string | null;
  // Start-time offset (seconds) parsed from the custom link's t=/start=
  // param, if any.
  customOffsetSeconds: number;
  // Server epoch ms when the current track started — used to compute a
  // synced playback position so every client hears the same moment.
  musicStartedAt: number;
  sfxVolumes: Record<string, number>;
}

export type Action =
  | {
      type: "SET_AUTH";
      payload: {
        user: Omit<User, "socketId">;
        instanceId: string;
        channelId: string;
      };
    }
  | { type: "SESSION_USERS"; payload: { users: User[] } }
  | { type: "ROLL_HISTORY"; payload: { entries: RollEntry[] } }
  | { type: "USER_JOINED"; payload: { user: User } }
  | { type: "USER_LEFT"; payload: { userId: string } }
  | {
      type: "ROLL_STARTED";
      payload: {
        rollId: string;
        userId: string;
        username: string;
        dice: string;
      };
    }
  | {
      type: "ROLL_REVEALED";
      payload: { entry: RollEntry; watcherIds: string[] };
    }
  | { type: "ROLL_CANCELLED"; payload: { rollId: string; userId: string } }
  | {
      type: "SESSION_MUSIC";
      payload: {
        category: string;
        songIndex: number;
        customYoutubeId: string | null;
        customOffsetSeconds: number;
        startedAt: number;
        sfxVolumes: Record<string, number>;
      };
    }
  | {
      type: "MUSIC_SYNC";
      payload: {
        category: string;
        songIndex: number;
        customYoutubeId: string | null;
        customOffsetSeconds: number;
        startedAt: number;
      };
    }
  | {
      type: "SFX_SYNC";
      payload: { sfxId: string; volume: number };
    };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_AUTH":
      return {
        ...state,
        currentUser: action.payload.user,
        instanceId: action.payload.instanceId,
        channelId: action.payload.channelId,
      };
    case "SESSION_USERS":
      return { ...state, users: action.payload.users };
    case "ROLL_HISTORY":
      return { ...state, rollHistory: action.payload.entries };
    case "USER_JOINED":
      return {
        ...state,
        users: [
          ...state.users.filter((u) => u.userId !== action.payload.user.userId),
          action.payload.user,
        ],
      };
    case "USER_LEFT":
      return {
        ...state,
        users: state.users.filter((u) => u.userId !== action.payload.userId),
      };
    case "ROLL_STARTED": {
      const { rollId, userId, username, dice } = action.payload;
      return {
        ...state,
        pendingRolls: {
          ...state.pendingRolls,
          [rollId]: { rollId, userId, username, dice },
        },
      };
    }
    case "ROLL_REVEALED": {
      const rest = omit(state.pendingRolls, action.payload.entry.id);
      const isMyRoll =
        action.payload.entry.userId === state.currentUser?.userId;
      // Hidden rolls are excluded from history for everyone except the roller
      if (action.payload.entry.isHidden && !isMyRoll) {
        return { ...state, pendingRolls: rest };
      }
      return {
        ...state,
        pendingRolls: rest,
        rollHistory: [action.payload.entry, ...state.rollHistory],
        newRollIds: [...state.newRollIds, action.payload.entry.id],
      };
    }
    case "ROLL_CANCELLED": {
      return {
        ...state,
        pendingRolls: omit(state.pendingRolls, action.payload.rollId),
      };
    }
    case "SESSION_MUSIC":
      return {
        ...state,
        musicCategory: action.payload.category,
        musicSongIndex: action.payload.songIndex,
        customYoutubeId: action.payload.customYoutubeId,
        customOffsetSeconds: action.payload.customOffsetSeconds,
        musicStartedAt: action.payload.startedAt,
        sfxVolumes: action.payload.sfxVolumes,
      };
    case "MUSIC_SYNC":
      return {
        ...state,
        musicCategory: action.payload.category,
        musicSongIndex: action.payload.songIndex,
        customYoutubeId: action.payload.customYoutubeId,
        customOffsetSeconds: action.payload.customOffsetSeconds,
        musicStartedAt: action.payload.startedAt,
      };
    case "SFX_SYNC":
      return {
        ...state,
        sfxVolumes: {
          ...state.sfxVolumes,
          [action.payload.sfxId]: action.payload.volume,
        },
      };
    default:
      return state;
  }
}

const initialState: State = {
  currentUser: null,
  instanceId: null,
  channelId: null,
  users: [],
  rollHistory: [],
  newRollIds: [],
  pendingRolls: {},
  musicCategory: "tavern",
  musicSongIndex: 0,
  customYoutubeId: null,
  customOffsetSeconds: 0,
  musicStartedAt: Date.now(),
  sfxVolumes: {},
};

interface StoreContextValue {
  state: State;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
