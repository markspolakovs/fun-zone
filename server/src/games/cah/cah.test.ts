import { CAHGame, CAHGameState } from ".";
import { Gameserver } from "../../";
import { Lobby } from "../../lobby";
import { Player } from "../../interfaces";
import { range } from "lodash";
import { createClient as mockCreateClient } from "redis-mock";
import { NotAllowedException, UnknownMethodException } from "../gameState";
jest.mock("redis", () => ({
  createClient: jest.fn((...args) => mockCreateClient(...args))
}));

const players = range(4).map(i => {
  const rez = new Player();
  rez.id = i.toString(10);
  rez.name = "Player" + i;
  rez.isHost = i === 0;
  return rez;
});

let server: Gameserver, lobby: Lobby;
beforeEach(() => {
  server = new Gameserver();
  lobby = new Lobby(server, "TEST", { game: "cah" }, players);
  jest.useFakeTimers();
});

test("Initial state is set up correctly", () => {
  // console.log(server, lobby);
  const game = new CAHGame(server, lobby, {
    gameLength: 10
  });
  game.debug_seedRandom(12345);
  const state = game.initialize();
  expect(state.blackCard).toMatchInlineSnapshot(`"73"`);
  expect(state.cardCzar).toEqual("1");
  expect(state.discards).toHaveLength(players.length * 7 + 1);
  expect(state.round).toEqual(1);
  expect(state.scores).toEqual({
    "0": 0,
    "1": 0,
    "2": 0,
    "3": 0
  });
  expect(state.playerHands).toMatchInlineSnapshot(`
    Object {
      "0": Array [
        "427",
        "408",
        "144",
        "59",
        "83",
        "18",
        "92",
      ],
      "1": Array [
        "379",
        "261",
        "244",
        "272",
        "436",
        "439",
        "211",
      ],
      "2": Array [
        "300",
        "422",
        "341",
        "170",
        "297",
        "70",
        "337",
      ],
      "3": Array [
        "407",
        "442",
        "11",
        "3",
        "131",
        "47",
        "179",
      ],
    }
  `);
  expect(state.state).toBe("playing");
  expect(state.playerPlayedCards).toEqual({
    "0": null,
    "1": null,
    "2": null,
    "3": null
  });
  expect(state.discards).toContain("18"); // smoke - white
  expect(state.discards).toContain("73"); // smoke - black
});

describe("CAH state", () => {
  let game: CAHGame;
  let state: CAHGameState;
  beforeEach(() => {
    game = new CAHGame(server, lobby, {
      gameLength: 2
    });
    game.debug_seedRandom(12345);
    state = game.initialize();
    (game as any).callbacksThisLoop = [];
  });

  it("throws if an unknown method is called", () => {
    expect(() => {
      game.update(state, "0", Symbol(), {});
    }).toThrowError(UnknownMethodException);
  });

  describe("playCard", () => {
    it("throws if state is not playing", () => {
      state.state = "choosing";
      expect(() => {
        game.update(state, "0", "playCard", { cardId: "18" });
      }).toThrow(NotAllowedException);
    });

    it("throws if we play a card we do not have in our hand", () => {
      expect(() => {
        game.update(state, "0", "playCard", { cardId: "NOT_A_REAL_CARD" });
      }).toThrow(NotAllowedException);
    });

    it("throws if we have already played a card", () => {
      state.playerPlayedCards[0] = "18";
      state.playerHands[0].splice(state.playerHands[0].indexOf("18"), 1);
      expect(() => {
        game.update(state, "0", "playCard", { cardId: "18" });
      }).toThrow(NotAllowedException);
    });

    it("works in the normal case", () => {
      const newState = game.update(state, "0", "playCard", { cardId: "18" });
      expect(newState.playerPlayedCards["0"]).toBe("18");
      expect(newState.playerHands["0"]).toHaveLength(6);
      expect(newState.playerHands["0"]).not.toContain("18");
    });

    it("transitions to choosing state if we are the last player", () => {
      state.playerPlayedCards = {
        "0": null,
        "1": "244",
        "2": "70",
        "3": "3"
      };
      const newState = game.update(state, "0", "playCard", { cardId: "18" });
      expect(newState.state).toBe("choosing");
    });
  });

  describe("chooseWinner", () => {
    it("only lets the card czar fire", () => {
      expect(() => {
        game.update(state, "0", "chooseWinner", { cardId: "244" });
      }).toThrow(NotAllowedException);
    });
    it("throws if the state is not choosing", () => {
      expect(() => {
        game.update(state, "1", "chooseWinner", { cardId: "244" });
      }).toThrow(NotAllowedException);
    });

    it("throws if the chosen card was not actually played", () => {
      state.state = "choosing";
      state.playerPlayedCards = {
        "0": "18",
        "1": "244",
        "2": "70",
        "3": "3"
      };
      expect(() => {
        game.update(state, "1", "chooseWinner", { cardId: "bollocks" });
      }).toThrow(NotAllowedException);
    });

    it("transitions to waitingForNextRound", () => {
      state.state = "choosing";
      state.playerPlayedCards = {
        "0": "18",
        "1": "244",
        "2": "70",
        "3": "3"
      };
      const newState = game.update(state, "1", "chooseWinner", {
        cardId: "244"
      });
      expect(newState.state).toEqual("waitingForNextRound");
    });

    it("increases the score properly", () => {
      state.state = "choosing";
      state.playerPlayedCards = {
        "0": "18",
        "1": "244",
        "2": "70",
        "3": "3"
      };
      const newState = game.update(state, "1", "chooseWinner", {
        cardId: "244"
      });
      expect(newState.scores).toEqual({
        "0": 0,
        "1": 1,
        "2": 0,
        "3": 0
      });
    });

    it("schedules a callback for a state transition", () => {
      (game as any).scheduleCallback = jest.fn();
      state.state = "choosing";
      state.playerPlayedCards = {
        "0": "18",
        "1": "244",
        "2": "70",
        "3": "3"
      };
      game.update(state, "1", "chooseWinner", { cardId: "244" });

      expect((game as any).scheduleCallback).toHaveBeenCalledWith(
        "newRound",
        5000
      );
    });
  });

  describe("newRound callback", () => {
    beforeEach(() => {
      state.state = "choosing";
      state.playerHands = {
        "0": ["427", "408", "144", "59", "83", "92"],
        "1": ["379", "261", "272", "436", "439", "211"],
        "2": ["300", "422", "341", "170", "297", "337"],
        "3": ["407", "442", "11", "131", "47", "179"]
      };
    });
    it("resets state to playing", () => {
      const newState = game.update(state, "SYSTEM", "newRound", {});
      expect(newState.state).toEqual("playing");
    });
    it("refills all players' hands", () => {
      const newState = game.update(state, "SYSTEM", "newRound", {});
      lobby.players.forEach(player => {
        expect(newState.playerHands[player.id]).toHaveLength(7);
      });
    });
    it("chooses a new black card", () => {
      const newState = game.update(state, "SYSTEM", "newRound", {});
      expect(newState.blackCard).not.toEqual(state.blackCard);
    });
    it("chooses a new card czar", () => {
      const newState = game.update(state, "SYSTEM", "newRound", {});
      expect(newState.cardCzar).toEqual("2");
    });
    it("increments the round", () => {
      const newState = game.update(state, "SYSTEM", "newRound", {});
      expect(newState.round).toEqual(2);
    });
    it("resets players' hands", () => {
      const newState = game.update(state, "SYSTEM", "newRound", {});
      expect(newState.playerPlayedCards).toEqual({
        "0": null,
        "1": null,
        "2": null,
        "3": null
      });
    });
  });

  describe("state projection", () => {
    test("state, cardCzar, scores, round, and blackCard match", () => {
      lobby.players.forEach(player => {
        const projection = game.project(state, player.id);
        expect(projection.state).toEqual(state.state);
        expect(projection.cardCzar).toEqual(state.cardCzar);
        expect(projection.scores).toEqual(state.scores);
        expect(projection.round).toEqual(state.round);
        expect(projection.blackCard).toEqual(state.blackCard);
      });
    });

    test("the current player's hand matches", () => {
      lobby.players.forEach(player => {
        const projection = game.project(state, player.id);
        expect(projection.ourHand).toEqual(state.playerHands[player.id]);
      });
    });

    test("playerPlayedHands matches", () => {
      state.playerPlayedCards = {
        "0": null,
        "1": "244",
        "2": "70",
        "3": "3"
      };
      lobby.players.forEach(player => {
        const projection = game.project(state, player.id);
        expect(projection.playerPlayedCards).toEqual({
          "0": false,
          "1": true,
          "2": true,
          "3": true
        });
      });
    });

    test("ourPlayedCard matches", () => {
      state.playerPlayedCards = {
        "0": null,
        "1": "244",
        "2": "70",
        "3": "3"
      };
      lobby.players.forEach(player => {
        const projection = game.project(state, player.id);
        expect(projection.ourPlayedCard).toEqual(
          state.playerPlayedCards[player.id]
        );
      });
    });

    it("reveals played cards in the choosing state...", () => {
      state.playerPlayedCards = {
        "0": "18",
        "1": "244",
        "2": "70",
        "3": "3"
      };
      state.state = "choosing";
      const projection = game.project(state, "0");
      expect(projection.allPlayerCards).toContain("18");
      expect(projection.allPlayerCards).toContain("244");
      expect(projection.allPlayerCards).toContain("70");
      expect(projection.allPlayerCards).toContain("3");
    });
    test("... but not in the playing state", () => {
      state.playerPlayedCards = {
        "0": "18",
        "1": "244",
        "2": "70",
        "3": "3"
      };
      state.state = "playing";
      const projection = game.project(state, "0");
      expect(projection.allPlayerCards).toBe(null);
    });
  });
});
