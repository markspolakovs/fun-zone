import { Controller, ClassWrapper, Post } from "@overnightjs/core";
import Async from "express-async-handler";
import { Gameserver } from "..";
import { Request, Response } from "express";
import crypto from "crypto";
import { Player } from "../interfaces";
import { EventEmitter } from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import { AbstractGame, Game } from "../games/gameState";
import { CAHGame } from "../games/cah";
import { NotFoundException } from "../db";

interface LobbyEvents {
  playerJoined: Player;
  playerLeft: string;
  playerUpdated: Player;
  gameStarting: void;
  gameEnded: void;
  gameStateUpdate: any;
}

type LobbyEmitter = StrictEventEmitter<EventEmitter, LobbyEvents>;

export class UnauthorisedException extends Error {}
export class NotReadyException extends Error {}

interface LobbySettings {
  game: string;
}

const PLAYER_DISCONNECT_KICK_TIMEOUT = 30 * 1000;

/**
 * Represents a game lobby.
 */
export class Lobby extends (EventEmitter as ({ new (): LobbyEmitter })) {
  /* Implementation note:
     It is considered bad practice to manually modify the fields of the Lobby,
     except on receipt of an event from the event bus. This is to maintain application
     consistency.

     So, to update the lobby, update its state in Redis and emit a `lobbies:{id}/lobby_settings_changed` or similar.
    */

  /**
   * The game state of the game being played, or null if the game hasn't started yet.
   */
  public currentGame: AbstractGame<any, any, any> | null = null;
  constructor(
    private readonly server: Gameserver,
    public readonly id: string,
    private settings: LobbySettings,
    public players: Player[]
  ) {
    super();

    this.initEvents();
  }

  public toJson() {
    return {
      settings: this.settings,
      id: this.id,
      players: this.players
    };
  }

  public async playerConnected(playerId: string) {
    this.updatePlayer(playerId, { isConnected: true });
  }

  public async playerDisconnected(playerId: string) {
    this.updatePlayer(playerId, { isConnected: false });
    setTimeout(() => {
      const playerNow = this.players.find(x => x.id === playerId);
      if (!playerNow || playerNow.isConnected === false) {
        this.playerLeft(playerId);
      }
    }, PLAYER_DISCONNECT_KICK_TIMEOUT);
  }

  public async playerLeft(playerId: string) {}

  public async attemptToStartGame(playerId: string, overrideNotReady = false) {
    const player = this.players.find(x => x.id === playerId);
    if (!player) {
      throw new Error(
        `Player ${playerId} does not exist (in attemptToStartGame)`
      );
    }
    if (!player.isHost) {
      throw new UnauthorisedException();
    }
    const allReady = this.players.every(x => x.isReady);
    if (!allReady && !overrideNotReady) {
      throw new NotReadyException();
    }
    // TODO support other games
    this.currentGame = await Game.create(CAHGame as any, this.server, this, {
      gameLength: 10
    });
    this.server.DB.Lobbies.Events.gameStarting(this.id);
    await (this.currentGame as any).doUpdate(() => {
      return this.currentGame!.initialize();
    }, true);
  }

  public readyUp(playerId: string) {
    try {
      this.updatePlayer(playerId, { isReady: true });
    } catch (e) {
      console.error("ERROR in Lobby.readyUp", e);
    }
  }

  public unready(playerId: string) {
    this.updatePlayer(playerId, { isReady: false });
  }

  // TODO: keep track of winners, scores etc.
  public async endGame() {
    await this.server.DB.Lobbies.Events.gameEnded(this.id);
  }

  private async updatePlayer(id: string, data: Partial<Player>) {
    await this.server.DB.Lobbies.updatePlayer(this.id, id, {
      id,
      ...data
    });
  }

  private initEvents = () => {
    this.server.eventBus.psubscribe(
      `lobbies:${this.id}/*`,
      async (dataJson, channel) => {
        try {
          console.log("lobby event", channel, typeof dataJson, dataJson);
          const data = JSON.parse(dataJson); // we json-stringify everything, so json-parse everything too
          const [_, event] = channel.split("/");
          switch (event) {
            case "player_joined": {
              const player = await Player.createFromRedisWithId(
                this.server,
                this,
                data.id
              );
              this.players.push(player);
              this.emit("playerJoined", player);
              break;
            }
            case "player_left": {
              const index = this.players.findIndex(x => x.id === data);
              this.players.splice(index, 1);
              this.emit("playerLeft", data);
              break;
            }
            case "player_updated": {
              const parsed: Partial<Player> = data;
              const index = this.players.findIndex(x => x.id === parsed.id);
              if (index === -1) {
                throw new Error(
                  `Lobby internal state doesn't include player with id ${parsed.id}!`
                );
              }
              Object.assign(this.players[index], parsed);
              this.emit("playerUpdated", this.players[index]);
              break;
            }
            case "game_starting": {
              this.emit("gameStarting");
              break;
            }
            case "game_ended": {
              this.emit("gameEnded");
              break;
            }
            case "game_state_update":
              this.emit("gameStateUpdate", data);
            default:
              console.warn(`WARN unknown lobby event type ${event}`);
          }
        } catch (e) {
          console.error(
            `CATASTROPHE while handling event\r\nType: ${channel}\r\n`,
            e
          );
        }
      }
    );
  };

  static async createFromRedis(server: Gameserver, id: string) {
    const data = await server.DB.Lobbies.getSettings(id);
    const allPlayers = await server.DB.Lobbies.getPlayers(id);
    const result = new Lobby(server, id, data, allPlayers);
    if (await server.DB.Lobbies.doWeHaveAGameState(id)) {
      result.currentGame = await Game.create(CAHGame as any, server, result, {
        gameLength: 10
      });
    }
    return result;
  }
}

@Controller("lobbies")
@ClassWrapper(Async)
export default class LobbyController {
  constructor(private readonly server: Gameserver) {}

  @Post("startNew")
  public async startNew(req: Request, res: Response) {
    const game = req.body.game; // TODO
    const name = req.body.name;
    const rtcConnectionString = req.body.rtcConnectionString;
    // TODO: consider recycling IDs
    const { id, code, settings } = await this.server.DB.Lobbies.create({
      game
    });

    const [playerId, sid] = await this.server.DB.Lobbies.allocatePlayerIdAndSid(
      id
    );
    const playerData = {
      id: playerId,
      name,
      rtcConnectionString,
      isHost: true,
      isReady: false,
      isConnected: false
    };
    await this.server.DB.Lobbies.addPlayer(playerId, sid, id, playerData);

    res.status(200).json({
      ok: true,
      you: playerData,
      yourSid: sid,
      lobbyCode: code
    });
  }

  @Post("join")
  public async joinLobby(req: Request, res: Response) {
    const lobbyCode = req.body.lobbyCode;
    const name = req.body.name;
    const rtcConnectionString = req.body.rtcConnectionString;
    let id, settings;
    try {
      const lobby = await this.server.DB.Lobbies.findByCode(lobbyCode);
      id = lobby.id;
      settings = lobby.settings;
    } catch (e) {
      if (e instanceof NotFoundException) {
        res.status(404).json({
          ok: false,
          message: "Lobby not found"
        });
      } else {
        throw e;
      }
    }

    const [playerId, sid] = await this.server.DB.Lobbies.allocatePlayerIdAndSid(
      id as string
    );

    const playerData = {
      id: playerId,
      name,
      rtcConnectionString,
      isHost: false,
      isReady: false,
      isConnected: false
    };
    await this.server.DB.Lobbies.addPlayer(
      playerId,
      sid,
      id as string,
      playerData
    );

    res.status(200).json({
      ok: true,
      you: playerData,
      yourSid: sid,
      lobbySettings: settings
    });
  }
}
