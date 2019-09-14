import { useRef, useEffect, useState, useCallback, useReducer } from "react";
import EventEmitter from "eventemitter3";
import Engine, { Socket } from "engine.io-client";

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  isConnected: boolean;
}

export interface LobbySettings {
  code: string;
  game: string;
}

export interface Lobby {
  settings: LobbySettings;
  players: Player[];
  id: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (val: T) => void;
  reject: (reason?: any) => void;
}

function useForceUpdate(): () => void {
  const [, dispatch] = useState<{}>(Object.create(null));

  // Turn dispatch(required_parameter) into dispatch().
  const memoizedDispatch = useCallback((): void => {
    dispatch(Object.create(null));
  }, [dispatch]);
  return memoizedDispatch;
}

function defer<T>() {
  const deferred: Deferred<T> = {
    promise: null,
    resolve: null,
    reject: null
  };

  deferred.promise = new Promise<T>((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });

  return deferred;
}

export function useRawGameSocket() {
  const sock = useRef<Socket | null>(null);
  const force = useForceUpdate();
  useEffect(() => {
    sock.current = Engine("http://localhost:2000/engine.io", {
      
    });
    force();
  }, [force]);
  return sock.current;
}

// TODO: some better way than just copy-pasting this
export enum Opcodes {
  Identify = 0,
  ReadyUp = 1,
  Unready = 2,
  StartGame = 10,
  GameAction = 11
}
export enum SocketEvents {
  Ack = 0,
  Helo = 1,
  LobbyPlayerJoin = 10,
  LobbyPlayerLeave = 11,
  LobbyPlayerUpdate = 12,
  GameStarting = 100,
  GameEnded = 101,
  GameStateUpdate = 102,
  NotEveryoneIsReady = 3000,
  UnsupportedFormat = 4000,
  NotAuthenticated = 4001,
  WhatAreYouOnAbout = 4011,
  MalformedRequest = 4010,
  InvalidState = 4012,
  NoSuchSession = 4004,
  YouAreNotTheHost = 4020,
  ICantLetYouDoThat = 4050,
  ServerShutdown = 99998,
  InternalError = 99999
}

export class GameSocket extends EventEmitter {
  private lastOpid = 0;
  private callbacks: { [K: number]: Deferred<any> } = {};
  private authenticated = false;
  private sockState: "open" | "closed" = "closed";
  private stateCallbacks: Array<(state: string) => void> = [];

  constructor(private readonly sock: Socket, sid: string) {
    super();
    sock.on("open", () => {
      console.debug("SOCKET open");
      this.sockState = "open";
      this.fireCallbacks();
    });
    sock.on("close", reason => {
      console.debug("SOCKET closed!", reason);
      this.sockState = "closed";
      this.authenticated = false;
      this.fireCallbacks();
    });
    sock.on("message", data => {
      if (data instanceof ArrayBuffer) {
        // todo
        return;
      }
      const payload = JSON.parse(data);
      console.debug("SOCKET message", payload);
      if ("opid" in payload) {
        // method call
        const callback = this.callbacks[payload.opid];
        if (payload.e >= 4000) {
          callback.reject({ code: payload.e, data: payload.d });
        } else {
          callback.resolve(payload.d);
        }
        // avoid memory leak
        delete this.callbacks[payload.opid];
      } else {
        // event
        this.emit(this.resolveEventType(payload.e), payload.d);
      }
    });

    this.identify(sid);
  }

  public get state() {
    if (this.sockState === "closed") {
      return "closed";
    }
    if (this.authenticated) {
      return "ready";
    } else {
      return "pending";
    }
  }

  public onStateChange(cb: (state: string) => void) {
    this.stateCallbacks.push(cb);
    this.fireCallbacks();
    return () => {
      this.stateCallbacks.splice(this.stateCallbacks.indexOf(cb), 1);
    };
  }

  public callMethod<TArgs extends {}, TRes>(
    opcode: Opcodes,
    args: TArgs
  ): Promise<TRes> {
    console.debug(`[debug] calling opcode ${opcode} with`, args);
    const result = defer<TRes>();

    const opid = this.lastOpid++;
    this.callbacks[opid] = result;

    const payload = {
      op: opcode,
      opid,
      d: args
    };
    console.debug("SOCKET send", payload);

    this.sock.send(JSON.stringify(payload));

    return result.promise;
  }

  public close() {
    this.sock.close();
  }

  private async identify(sid: string) {
    console.log("identify", sid, this.state);
    const { lobby, player } = await this.callMethod(Opcodes.Identify, {
      sid
    });
    console.debug("SOCKET authenticated!", lobby, player);
    this.emit("identified", {
      lobby,
      player
    });
    this.authenticated = true;
    this.fireCallbacks();
  }

  private fireCallbacks() {
    const state = this.state;
    this.stateCallbacks.forEach(cb => cb(state));
  }

  private resolveEventType(opcode: number): string {
    switch (opcode) {
      case SocketEvents.Ack:
        return "ack";
      case SocketEvents.Helo:
        return "helo";
      case SocketEvents.LobbyPlayerJoin:
        return "lobbyPlayerJoin";
      case SocketEvents.LobbyPlayerLeave:
        return "lobbyPlayerLeave";
      case SocketEvents.LobbyPlayerUpdate:
        return "lobbyPlayerUpdate";
      case SocketEvents.GameStarting:
        return "gameStarting";
      case SocketEvents.GameEnded:
        return "gameEnded";
      case SocketEvents.GameStateUpdate:
        return "gameStateUpdate";
      case SocketEvents.NotEveryoneIsReady:
        return "notEveryoneIsReady";
      default:
        if (opcode >= 4000) {
          return "error";
        }
        console.warn(`UNKNOWN OPCODE ${opcode}`);
        return "$$UNKNOWN$$";
    }
  }
}

function playersReducer(
  state: Player[],
  action:
    | {
        t: "join";
        p: Player;
      }
    | {
        t: "update";
        p: Player;
      }
    | {
        t: "leave";
        p: string;
      }
) {
  switch (action.t) {
    case "join":
      return [...state, action.p];
    case "update": {
      const index = state.findIndex(x => x.id === action.p.id);
      const data = state.slice(0);
      if (index === -1) {
        return [...state, action.p];
      }
      data[index] = Object.assign(state[index], action.p);
      return data;
    }
    case "leave": {
      const index = state.findIndex(x => x.id === action.p);
      state.splice(index, 1);
      return state;
    }
    default:
      throw new Error();
  }
}

export function useGameSocket(
  sid: string
): [GameSocket | null, string, Lobby | null, Player | null, Player[]] {
  const sock = useRawGameSocket();
  const clazz = useRef<GameSocket | null>(null);
  const [sockState, setSockState] = useState<string>();
  const lobbyRef = useRef<Lobby | null>(null);
  const playerRef = useRef<Player | null>(null);
  const [players, dispatchPlayers] = useReducer(playersReducer, []);
  const force = useForceUpdate();
  useEffect(() => {
    console.debug("useGameSocket", sock, sid);
    if (sock && !(clazz.current)) {
      clazz.current = new GameSocket(sock, sid);
      clazz.current.onStateChange(setSockState);
      clazz.current.on(
        "identified",
        ({ lobby, player }: { lobby: Lobby; player: Player }) => {
          lobbyRef.current = lobby;
          playerRef.current = player;
          force();
        }
      );
      clazz.current.on("lobbyPlayerJoin", d =>
        dispatchPlayers({ t: "join", p: d })
      );
      clazz.current.on("lobbyPlayerLeave", d =>
        dispatchPlayers({ t: "leave", p: d })
      );
      clazz.current.on("lobbyPlayerUpdate", d => {
        dispatchPlayers({ t: "update", p: d });
        if (playerRef.current && d.id === playerRef.current.id) {
          playerRef.current = Object.assign({}, playerRef.current, d);
          force();
        }
      });
      return () => {
        clazz.current.close();
      };
    }
  }, [sock, sid, force]);
  return [clazz.current, sockState, lobbyRef.current, playerRef.current, players];
}
