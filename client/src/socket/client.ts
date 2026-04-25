import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../types";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(import.meta.env.VITE_SERVER_URL as string, {
      path: "/socket.io",
      autoConnect: true,
    });
  }
  return socket;
}
