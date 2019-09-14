import { Gameserver } from "..";
import { Lobby } from "../lobby";
import Chance from "chance";
import { includes } from "lodash";

export class GameException extends Error {
  constructor(public readonly code: string, message?: string) {
    super(typeof message === "string" ? `${code} (${message})` : code);
    this.name = "GameException[" + code + "]";
  }
}

export class NotAllowedException extends GameException {}
export class UnknownMethodException extends GameException {}

export type GameListener<TG, TGS> = (state: TGS, game: TG) => void;

export const EngineActions = {
  playerJoined: Symbol("playerJoined"),
  playerLeft: Symbol("playerLeft"),
  playerUpdated: Symbol("playerUpdated")
} as const;

type ValueOf<T> = T[keyof T];

export abstract class AbstractGame<
  TGameState extends {},
  TProjectedState extends {},
  TGameSettings extends {}
> {
  protected abstract readonly settings: TGameSettings;
  protected chance = new Chance();

  public debug_seedRandom(seed: number) {
    this.chance = new Chance(seed);
  }

  public abstract initialize(): TGameState;
  public abstract project(
    gameState: TGameState,
    playerId: string
  ): TProjectedState;
  public abstract subscribe(
    listener: GameListener<this, TGameState>
  ): () => void;

  /**
   * Get the current game state.
   *
   * YOU PROBABLY DO NOT NEED TO USE THIS METHOD!
   *
   * It is there for convenience!
   *
   * DO NOT use this method in your `update` handler - not only is it unnecessary,
   * as the current state is passed in for you, but it breaks the contract,
   * as it introduces a side effect. (It won't even work anyway, as `update`
   * is synchronous.)
   */
  public abstract getState(): Promise<TGameState>;

  protected abstract update(
    state: TGameState,
    playerId: string,
    action: string | ValueOf<typeof EngineActions>,
    args: any
  ): TGameState;

  public abstract callMethod(
    playerId: string,
    method: string | ValueOf<typeof EngineActions>,
    args: any
  ): Promise<void>;

  /**
   * Schedule a callback to be called by the engine.
   *
   * Due to the pure nature of the `update` function, it is not possible to use
   * setTimeout in it. Instead, use scheduleCallback.
   *
   * After the given time, the `update` function will be called again woth `key` and `args` as parameters.
   *
   * Note that, to ensure idempotency of the update cycle, a given (key, args) combination will only
   * be scheduled once per update cycle, no matter how many times it is called. (Objects are deeply compared
   * to determine equality.)
   * @param key will be passed back to `update` after the time
   * @param time time to wait, in milliseconds
   * @param args any arguments to pass `update` (otherwise {})
   */
  protected abstract scheduleCallback<K extends string>(
    key: K,
    time: number
  ): void;
  protected abstract scheduleCallback<K extends string, A extends {}>(
    key: K,
    args: A,
    time: number
  ): void;
}

export abstract class Game<
  TGameState extends {},
  TProjectedState extends {},
  TGameSettings extends {}
> extends AbstractGame<TGameState, TProjectedState, TGameSettings> {
  private listeners: Array<GameListener<this, TGameState>> = [];

  private callbacksThisLoop: null | Array<[string, any]> = null;

  constructor(
    private readonly server: Gameserver,
    protected readonly lobby: Lobby,
    protected readonly settings: TGameSettings
  ) {
    super();
    this.hookIntoLobbyForPlayerUpdates();
    this.listenForEvents();
  }

  public static async create<TGS, TPS, TS, T extends Game<TGS, TPS, TS>>(
    clazz: new (server: Gameserver, lobby: Lobby, settings: any) => T,
    server: Gameserver,
    lobby: Lobby,
    settings: TS
  ): Promise<T> {
    const game = new clazz(server, lobby, settings);
    return game;
  }

  public async callMethod(
    playerId: string,
    method: string | ValueOf<typeof EngineActions>,
    args: any
  ): Promise<void> {
    this.doUpdate(state => {
      return this.update(state, playerId, method, args);
    });
  }

  public subscribe(listener: (state: TGameState, game: this) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners.splice(this.listeners.indexOf(listener), 1);
    };
  }

  /**
   * Get the current game state.
   *
   * YOU PROBABLY DO NOT NEED TO USE THIS METHOD!
   *
   * It is there for convenience!
   *
   * DO NOT use this method in your `update` handler - not only is it unnecessary,
   * as the current state is passed in for you, but it breaks the contract,
   * as it introduces a side effect. (It won't even work anyway, as `update`
   * is synchronous.)
   */
  public async getState() {
    const stateJson = await this.server.redis.get(
      `lobbies:${this.lobby.id}:game_state`
    );
    if (stateJson === null) {
      throw new Error(`Game state not set! (for lobby ${this.lobby.id})`);
    }
    const state = JSON.parse(stateJson);
    return state as TGameState;
  }

  protected scheduleCallback<K extends string>(key: K, time: number): void;
  protected scheduleCallback<K extends string, A extends {}>(
    key: K,
    args: A,
    time: number
  ): void;
  protected scheduleCallback<K extends string, A extends {}>(
    key: K,
    argsOrTime: A | number,
    timeMaybe?: number
  ) {
    if (this.callbacksThisLoop === null) {
      throw new Error(
        "scheduleCallback may only be used inside an `update` function!"
      );
    }
    const args = typeof argsOrTime === "object" ? argsOrTime : {};
    const pair = [key, args] as [string, any];
    if (includes(this.callbacksThisLoop, pair)) {
      return;
    } else {
      this.callbacksThisLoop.push(pair);
    }

    const time = typeof argsOrTime === "number" ? argsOrTime : timeMaybe!;
    // TODO: make this better
    setTimeout(() => {
      this.callMethod("SYSTEM", key, args);
    }, time);
  }

  private async listenForEvents() {
    // console.debug("GAME subscribe");
    // We use the event bus for ALL state updates,
    // even for ones on this server.
    // See the comment at the end of this.update() for the explanation.
    // This is probably overkill, and could be optimised, but fuck it.
    this.server.eventBus.subscribe(
      `lobbies:${this.lobby.id}/game_state_update`,
      data => {
        // console.debug("GAME fire");
        const newState = JSON.parse(data);
        this.listeners.forEach(cb => cb(newState, this));
      }
    );
  }

  public async doUpdate(
    callback: (state: TGameState) => TGameState,
    ignoreNonexistentState = false
  ) {
    // Set up callback de-duping
    this.callbacksThisLoop = [];
    // Go into an infinite loop to ensure atomicity
    // If a concurrent update happens, this flush will be retried.
    // This is ensured by Redis WATCH.
    // (see https://redis.io/topics/transactions#a-hrefcommandswatchwatcha-explained)
    const r = this.server.redis;
    const key = `lobbies:${this.lobby.id}:game_state`;
    while (true) {
      await r.watch(key);
      // First, get the current game state.
      let currentStateJson = await r.get(key);
      if (currentStateJson === null) {
        if (!ignoreNonexistentState) {
          throw new Error(`Can't happen. (update currentStateJson null)`);
        } else {
          currentStateJson = "{}";
        }
      }
      const currentState = JSON.parse(currentStateJson);
      // Then, apply the state updates sequentially.
      const newState = callback(currentState);
      // Then, apply it to Redis.
      const multi = r.multi().set(key, JSON.stringify(newState));
      const result = await r.execMulti(multi);
      // result will be an array if the transaction successfully executed
      // or null if it didn't
      if (result !== null) {
        // Finally, emit an event
        // Note that we don't notify our listeners here.
        // This is to ensure consistency - some listeners may be on different servers,
        // so we would only notify the ones on this server.
        // Instead, we notify all Game instances (including this one), via the event bus.
        this.server.redis.publish(
          `lobbies:${this.lobby.id}/game_state_update`,
          JSON.stringify(newState)
        );
        // Reset callbacks
        this.callbacksThisLoop = null;
        return;
      }
    }
  }

  private hookIntoLobbyForPlayerUpdates() {
    this.lobby.on("playerJoined", async newPlayer => {
      try {
        await this.callMethod(newPlayer.id, EngineActions.playerJoined, newPlayer);
      } catch (e) {
        console.warn("Error while handling playerJoined event", e);
      }
    });
    this.lobby.on("playerLeft", async leaverId => {
      try {
        await this.callMethod(leaverId, EngineActions.playerLeft, {});
      } catch (e) {
        console.warn("Error while handling playerLeft event", e);
      }
    });
    this.lobby.on("playerUpdated", async updated => {
      try {
        await this.callMethod(updated.id, EngineActions.playerUpdated, updated);
      } catch (e) {
        console.warn("Error while handling playerUpdated event", e);
      }
    });
  }
}
