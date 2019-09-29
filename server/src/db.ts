import { IHandyRedis } from "handy-redis";
import crypto from "crypto";
import { Player } from "./interfaces";
import { serialize } from "./helpers";

export class PlayerAlreadyInLobbyException extends Error {}
export class NotFoundException extends Error {}

const CODE_CHARSET = "ABCDEFGHJKLMNPQRSTWXYZ123456789";
function makeRandomCode(length = 4) {
  let str = "";
  for (let i = 0; i < length; i++) {
    str += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)];
  }
  return str;
}

function r(op: string, cb: () => Promise<any>) {
  return cb().catch(err => {
    console.error(`ERROR in Redis op ${op}`, err);
  });
}

export default class Database {
  constructor(private readonly redis: IHandyRedis) {}

  public Lobbies = {
    Events: {
      // We JSON serialize EVERYTHING, for consistency, even simple strings.
      playerJoined: async (lobby: string, data: Player) => {
        await r("playerJoined", async () => {
          await this.redis.publish(
            `lobbies:${lobby}/player_joined`,
            serialize(data)
          );
        });
      },
      playerLeft: async (lobby: string, playerId: string) => {
        await r("playerLeft", async () => {
          await this.redis.publish(
            `lobbies:${lobby}/player_left`,
            serialize(playerId)
          );
        });
      },
      playerUpdated: async (lobby: string, playerData: Partial<Player>) => {
        await r("playerUpdated", async () => {
          await this.redis.publish(
            `lobbies:${lobby}/player_updated`,
            serialize(playerData)
          );
        });
      },
      gameStarting: async (lobby: string) => {
        await this.redis.publish(`lobbies:${lobby}/game_starting`, "{}");
      },
      gameEarlyStarting: async (lobby: string) => {
        await this.redis.publish(`lobbies:${lobby}/game_early_starting`, "{}");
      },
      gameEnded: async (lobby: string) => {
        await this.redis.publish(`lobbies:${lobby}/game_ended`, "{}");
      }
    },
    create: async (settings: any) => {
      return await r("create game", async () => {
        const lobbyId = (await this.redis.incr("id:lobbies")).toString(10);
        await this.redis.sadd("lobbies", lobbyId);
        const code = await this.Lobbies.allocateLobbyCode(lobbyId);

        const lobbyData = {
          code,
          ...settings
        };
        await this.redis.set(
          `lobbies:${lobbyId}:settings`,
          JSON.stringify(lobbyData)
        );
        return {
          id: lobbyId,
          code,
          settings
        } as {
          id: string;
          code: string;
          settings: any;
        };
      });
    },
    updatePlayer: async (
      lobby: string,
      player: string,
      data: Partial<Player>
    ) => {
      while (true) {
        this.redis.watch(`lobbies:${lobby}:players`);
        const currentJson = await this.redis.hget(
          `lobbies:${lobby}:players`,
          player
        );
        if (currentJson === null) {
          throw new Error("No such player");
        }
        const current = JSON.parse(currentJson);
        const update = Object.assign({}, current, data);
        const multi = this.redis
          .multi()
          .hset(`lobbies:${lobby}:players`, player, JSON.stringify(update));
        const rez = await this.redis.execMulti(multi);
        if (rez !== null) {
          this.Lobbies.Events.playerUpdated(lobby, data);
          break;
        }
      }
    },
    getSettings: async (id: string) => {
      const json = await this.redis.get(`lobbies:${id}:settings`);
      if (json === null) {
        throw new Error(`Cannot find lobby ${id}`);
      }
      const data = JSON.parse(json);
      return data;
    },
    getPlayers: async (id: string) => {
      const allPlayersA = await this.redis.hvals(`lobbies:${id}:players`);
      const allPlayers = allPlayersA.map(x => JSON.parse(x));
      return allPlayers;
    },
    allocateLobbyCode: async (id: string) => {
      while (true) {
        const code = makeRandomCode();
        const result = await this.redis.hsetnx("lobbyCodes", code, id);
        if (result > 0) {
          return code;
        }
      }
    },
    allocatePlayerIdAndSid: async (
      lobbyId: string
    ): Promise<[string, string]> => {
      // Player ID
      const playerId = (await this.redis.incr(
        `id:lobbies:${lobbyId}:player`
      )).toString(10);
      // SID
      while (true) {
        const bytes = crypto.randomBytes(16);
        const sid = bytes.toString("hex");
        const insertResult = await this.redis.sadd("sids", sid);
        if (insertResult > 0) {
          return [playerId, sid];
        }
      }
    },
    addPlayer: async (
      playerId: string,
      sid: string,
      lobbyId: string,
      playerData: any,
      continueEvenIfAlreadyInLobby = false
    ) => {
      // 1. Check if they're already in the lobby
      const result = await this.redis.hexists(
        `lobbies:${lobbyId}:players`,
        playerId
      );
      if (result && !continueEvenIfAlreadyInLobby) {
        throw new PlayerAlreadyInLobbyException();
      }
      // 2. Update the player data
      // we may need to do a merge here
      // TODO: concurrency? may want to do this in a transaction
      const oldJson = await this.redis.hget(
        `lobbies:${lobbyId}:players`,
        playerId
      );
      if (oldJson) {
        const oldData = JSON.parse(oldJson);
        playerData = Object.assign({}, oldData, playerData);
      }
      await this.redis.hset(
        `lobbies:${lobbyId}:players`,
        playerId,
        JSON.stringify(playerData)
      );
      // 3. Set the sessions hash, for the WS server
      await this.redis.hset("sessions", sid, lobbyId + "/" + playerId);
      // 4. Send an event for all the other players
      this.Lobbies.Events.playerJoined(lobbyId, playerData);
    },
    removePlayer: async (lobby: string, player: string) => {
      await this.redis.srem(`lobbies:${lobby}:players`, player);
      await this.Lobbies.Events.playerLeft(lobby, player);
    },
    findByCode: async (code: string) => {
      const lobbyId = await this.redis.hget("lobbyCodes", code);
      if (lobbyId === null) {
        throw new NotFoundException(`Lobby ${code} not exists`);
      }

      const settingsJson = await this.redis.get(`lobbies:${lobbyId}:settings`);
      if (settingsJson === null) {
        throw new Error(`Lobby settings are null! ${lobbyId}`);
      }
      const settings = JSON.parse(settingsJson);

      return {
        id: lobbyId,
        settings
      };
    },
    doWeHaveAGameState: async (lobbyId: string) => {
      return await this.redis.exists(`lobbies:${lobbyId}:game_state`);
    },
    getGameState: async (lobbyId: string) => {
      const stateJson = await this.redis.get(`lobbies:${lobbyId}:game_state`);
      if (stateJson === null) {
        throw new Error(`No game state for ${lobbyId}!`);
      }
      return JSON.parse(stateJson);
    }
  };
}
