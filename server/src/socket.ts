import { Gameserver } from ".";
import { Socket } from "engine.io";
import { Lobby, UnauthorisedException, NotReadyException } from "./lobby";
import { Player } from "./interfaces";
import { serialize } from "./helpers";
import ON_DEATH from "death";
import { GameListener, GameException } from "./games/gameState";

enum SocketEvents {
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

enum Opcodes {
  Identify = 0,
  ReadyUp = 1,
  Unready = 2,
  StartGame = 10,
  GameAction = 11
}

const GlobalAbbrevs: { [K: string]: string[] } = {
  opcode: ["op"],
  data: ["d"],
  operationId: ["oid", "opid"]
};

const OpAbbrevs: { [K1 in Opcodes]: { [K2: string]: string[] } } = {
  [Opcodes.Identify]: {
    sid: ["s"]
  },
  [Opcodes.StartGame]: {
    overrideNotReady: ["onr", "oNR", "o"]
  },
  [Opcodes.ReadyUp]: {},
  [Opcodes.Unready]: {},
  [Opcodes.GameAction]: {
    opcode: ["opcode", "op"],
    args: ["a", "d"]
  }
};

function deabbrev<T>(original: string, obj: any, op?: Opcodes): T | null {
  if (original in obj) {
    return obj[original];
  }
  if (typeof op !== "undefined") {
    const keys = OpAbbrevs[op];
    console.log(keys);
    console.log(original in keys);
    if (original in keys) {
      for (const attempt of keys[original]) {
        if (attempt in obj) {
          return obj[attempt];
        }
      }
    }
  }
  if (original in GlobalAbbrevs) {
    for (const attempt of GlobalAbbrevs[original]) {
      if (attempt in obj) {
        return obj[attempt];
      }
    }
  }
  return null;
}

function deabbrevOrDie<T>(original: string, obj: any, op?: Opcodes): T {
  const rez = deabbrev<T>(original, obj, op);
  if (rez === null) {
    throw new Error();
  }
  return rez;
}

export default class GameSocket {
  private authenticated = false;
  private lobby: Lobby | null = null;
  private player: Player | null = null;
  private unsub: (() => void) | null = null;

  constructor(
    private readonly server: Gameserver,
    private readonly sock: Socket
  ) {
    sock.on("message", this.handleMessage);
    sock.on("close", this.onDisconnect);
    ON_DEATH(() => {
      this.sendEvent(SocketEvents.ServerShutdown, {});
    });
  }

  private identify = async (sid: string, opid?: string) => {
    if (this.authenticated) {
      this.sendError(SocketEvents.InvalidState, {
        y: "already_authenticated"
      });
      return;
    }
    const sessTupple = await this.server.redis.hget("sessions", sid);
    if (!sessTupple) {
      this.sendError(SocketEvents.NoSuchSession, {}, opid);
      return;
    }
    const [lobbyId, playerId] = sessTupple.split("/");

    this.lobby = await Lobby.createFromRedis(this.server, lobbyId);
    this.player = await Player.createFromRedisWithId(
      this.server,
      this.lobby,
      playerId
    );
    this.authenticated = true;
    this.sendEvent(
      SocketEvents.Helo,
      {
        player: this.player,
        lobby: this.lobby
      },
      opid
    );

    this.handleLobbyEvents();
    this.lobby.players.forEach(player => {
      this.sendError(SocketEvents.LobbyPlayerJoin, player);
    });
    this.lobby.playerConnected(this.player.id);
    if (this.lobby.currentGame !== null) {
      this.lobby.currentGame.subscribe(this.onGameStateUpdate);
      console.log("SOCKET sending fresh state to new player");
      const state = await this.lobby.currentGame.getState();
      this.onGameStateUpdate(state);
    }
  };

  private readyUp = (opid?: string) => {
    console.log(this.lobby!.toJson());
    this.lobby!.readyUp(this.player!.id);
    this.sendEvent(SocketEvents.Ack, {}, opid);
  };

  private unready = (opid?: string) => {
    this.lobby!.unready(this.player!.id);
    this.sendEvent(SocketEvents.Ack, {}, opid);
  };

  private attemptToStartGame = async (override: boolean, opid?: string) => {
    try {
      await this.lobby!.attemptToStartGame(this.player!.id, override);
    } catch (e) {
      console.log(e);
      if (e instanceof UnauthorisedException) {
        this.sendError(SocketEvents.YouAreNotTheHost, {}, opid);
      } else if (e instanceof NotReadyException) {
        this.sendEvent(SocketEvents.NotEveryoneIsReady, {}, opid);
      } else {
        throw e;
      }
    }
  };

  private gameAction = async (opcode: string, args: any, opid?: string) => {
    try {
      console.debug("SOCKET gameAction", opcode, args);
      await this.lobby!.currentGame!.callMethod(this.player!.id, opcode, args);
      this.sendEvent(SocketEvents.Ack, {}, opid);
    } catch (e) {
      if (e instanceof GameException) {
        this.sendError(SocketEvents.ICantLetYouDoThat, {
          code: e.code,
          message: e.message
        });
      } else {
        throw e;
      }
    }
  };

  private onDisconnect = async () => {
    if (this.authenticated) {
      this.lobby!.playerDisconnected(this.player!.id);
    }
  };

  private onGameStateUpdate = async (state: any) => {
    console.debug("SOCKET: gameStateUpdate");
    const projection = this.lobby!.currentGame!.project(state, this.player!.id);
    console.log("projected", projection);
    this.sendEvent(SocketEvents.GameStateUpdate, projection);
  };

  private handleLobbyEvents = () => {
    this.lobby!.on("playerJoined", player => {
      this.sendEvent(SocketEvents.LobbyPlayerJoin, player);
    });
    this.lobby!.on("playerLeft", leaverId => {
      this.sendEvent(SocketEvents.LobbyPlayerLeave, { id: leaverId });
    });
    this.lobby!.on("playerUpdated", player => {
      this.sendEvent(SocketEvents.LobbyPlayerUpdate, player);
    });
    this.lobby!.on("gameStarting", () => {
      this.sendEvent(SocketEvents.GameStarting, {});
      console.log("Socket got gameStarting");
      this.unsub = this.lobby!.currentGame!.subscribe(this.onGameStateUpdate);
    });
    this.lobby!.on("gameEnded", () => {
      this.sendEvent(SocketEvents.GameEnded, {});
      this.sock.close();
      if (this.unsub) {
        this.unsub();
      }
    });
  };

  private sendEvent = (code: SocketEvents, data: any, opid?: string) => {
    console.debug(`DEBUG send ${code}@${opid || "nil"}`);
    this.sock.send(
      serialize({
        e: code,
        d: data,
        opid
      })
    );
  };

  private sendError = (
    code: SocketEvents,
    data: any,
    opid?: string,
    fatal = false
  ) => {
    this.sendEvent(code, data, opid);
    if (fatal) {
      this.sock.close();
    }
  };

  private handleMessage = (msg: string | Buffer) => {
    let data;
    if (msg instanceof Buffer) {
      this.sendError(
        SocketEvents.UnsupportedFormat,
        {
          msg: "only json supported for now"
        },
        undefined,
        true
      );
      return;
    } else {
      try {
        data = JSON.parse(msg);
      } catch (e) {
        this.sendError(SocketEvents.MalformedRequest, {});
        return;
      }
    }
    // TODO: robust
    const opid_t: string | null = deabbrev("operationId", data);
    const opid = opid_t === null ? undefined : opid_t;
    const opData = deabbrevOrDie<any>("data", data);
    console.debug(`DEBUG recv ${data.op}@${opid}`);
    if (data.op === Opcodes.Identify) {
      const sid: string = deabbrevOrDie("sid", opData, Opcodes.Identify);
      this.identify(sid, opid);
      return;
    }
    if (!this.authenticated) {
      this.sendError(SocketEvents.NotAuthenticated, {}, opid);
      return;
    }
    switch (data.op as Opcodes) {
      case Opcodes.StartGame:
        const overrideNotReady =
          deabbrev<boolean>("overrideNotReady", opData, Opcodes.StartGame) ||
          false;
        this.attemptToStartGame(overrideNotReady, opid);
        break;
      case Opcodes.ReadyUp:
        this.readyUp(opid);
        break;
      case Opcodes.Unready:
        this.unready(opid);
        break;
      case Opcodes.GameAction:
        const opcode = deabbrevOrDie<string>(
          "opcode",
          opData,
          Opcodes.GameAction
        );
        const args = deabbrevOrDie<any>("args", opData, Opcodes.GameAction);
        this.gameAction(opcode, args, opid);
        break;
      default:
        this.sendError(SocketEvents.WhatAreYouOnAbout, {
          msg: `no opcode ${data.op}`
        });
        break;
    }
  };
}
