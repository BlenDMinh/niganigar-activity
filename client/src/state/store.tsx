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
  pendingRolls: Record<string, PendingRollInfo>;
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
  | { type: "ROLL_CANCELLED"; payload: { rollId: string; userId: string } };

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
      };
    }
    case "ROLL_CANCELLED": {
      return {
        ...state,
        pendingRolls: omit(state.pendingRolls, action.payload.rollId),
      };
    }
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
  pendingRolls: {},
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
