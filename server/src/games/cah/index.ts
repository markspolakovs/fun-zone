import {
  zipObject,
  chain,
  includes,
  range,
  findKey,
  values,
  filter
} from "lodash";
import {
  Game,
  NotAllowedException,
  UnknownMethodException,
  EngineActions
} from "../gameState";

import { cards, BlackCard } from "@cards/shared/src/cah/cards";
import {
  CAHGameState,
  CAHProjectedState,
  CAHSettings
} from "@cards/shared/src/cah/state";

interface DiscardRef {
  discards: string[];
}

function arraysEqual<T>(a: T[], b: T[]) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length != b.length) return false;

  // If you don't care about the order of the elements inside
  // the array, you should sort both arrays here.
  // Please note that calling sort on an array will modify that array.
  // you might want to clone your array first.

  for (var i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class CAHGame extends Game<
  CAHGameState,
  CAHProjectedState,
  CAHSettings
> {
  initialize(): CAHGameState {
    const discardsRef = {
      discards: []
    };
    return {
      state: "playing",
      playerHands: zipObject(
        this.lobby.players.map(x => x.id),
        this.lobby.players.map(_ => this.dealHand(discardsRef, 7))
      ),
      playerPlayedCards: zipObject(
        this.lobby.players.map(x => x.id),
        this.lobby.players.map(_ => null)
      ),
      scores: zipObject(
        this.lobby.players.map(x => x.id),
        this.lobby.players.map(_ => 0)
      ),
      cardCzar: this.chooseRandomPlayer().id,
      blackCard: this.chooseRandomBlackCard(discardsRef).id,
      discards: discardsRef.discards,
      round: 1,
      roundWinner: null
    };
  }

  private chooseRandomPlayer() {
    return this.chance.pickone(this.lobby.players);
  }

  private chooseRandomBlackCard(dr: DiscardRef): BlackCard {
    let stack = chain(cards.black)
      .filter(x => !includes(dr.discards, x.id))
      .value();
    if (stack.length === 0) {
      dr.discards = [];
      stack = cards.black;
    }
    const chosen = this.chance.pickone(stack);
    dr.discards.push(chosen.id);
    return chosen;
  }

  private dealHand(dr: DiscardRef, howMany: number) {
    let stack = cards.white.filter(card => !includes(dr.discards, card.id));
    if (stack.length < howMany) {
      stack = cards.white;
      dr.discards = [];
    }
    const picked = this.chance.pickset(stack, howMany);
    picked.forEach(x => dr.discards.push(x.id));
    return picked.map(x => x.id);
  }

  private fillHands(
    hands: { [k: string]: string[] },
    dr: DiscardRef,
    howMany: number
  ): { [Player: string]: string[] } {
    const result: { [K: string]: string[] } = {};
    for (const player of this.lobby.players) {
      result[player.id] = [
        ...hands[player.id],
        ...this.dealHand(dr, howMany - hands[player.id].length)
      ];
    }
    return result;
  }

  private chooseNextCardCzar(state: CAHGameState) {
    const indexOfCzar = this.lobby.players.findIndex(
      x => x.id === state.cardCzar
    );
    let nextIndex = indexOfCzar + 1;
    if (nextIndex === this.lobby.players.length) {
      nextIndex = 0;
    }
    return this.lobby.players[nextIndex].id;
  }

  project(state: CAHGameState, playerId: string): CAHProjectedState {
    return {
      state: state.state, // ha ha
      cardCzar: state.cardCzar,
      blackCard: state.blackCard,
      scores: state.scores,
      ourHand: state.playerHands[playerId],
      playerPlayedCards: zipObject(
        this.lobby.players.map(x => x.id),
        this.lobby.players.map(x => state.playerPlayedCards[x.id] !== null)
      ),
      ourPlayedCard: state.playerPlayedCards[playerId],
      round: state.round,
      allPlayerCards:
        state.state === "choosing" || state.state === "waitingForNextRound"
          ? (values(
              filter(state.playerPlayedCards, (_, k) => k !== state.cardCzar)
            ) as string[][])
          : null,
      roundWinner: state.roundWinner
    };
  }

  update(
    state: CAHGameState,
    playerId: string,
    method: string | symbol,
    args: any
  ): CAHGameState {
    const newState = Object.assign({}, state);
    switch (method) {
      case "playCard":
        if (newState.state !== "playing") {
          throw new NotAllowedException("not_playing");
        }
        if (newState.playerPlayedCards[playerId] !== null) {
          throw new NotAllowedException("already_played");
        }
        const playedCards = args.cardIds;
        if (!Array.isArray(playedCards) || typeof playedCards[0] !== "string") {
          throw new NotAllowedException(
            "only_array_of_strings_please",
            `we got a ${typeof playedCards}`
          );
        }
        const blackCard = cards.black.find(x => x.id === state.blackCard);
        if (playedCards.length !== parseInt(blackCard!.pick, 10)) {
          throw new NotAllowedException("mismatched_count");
        }
        const playerHand = newState.playerHands[playerId];
        if (!playedCards.every(x => playerHand.indexOf(x) > -1)) {
          console.debug("bollocks not_in_hand", playedCards, playerHand);
          throw new NotAllowedException("not_in_hand");
        }
        playedCards.forEach(x => {
          playerHand.splice(playerHand.indexOf(x), 1);
        });
        newState.playerPlayedCards = {
          ...newState.playerPlayedCards,
          [playerId]: playedCards
        };
        newState.playerHands = {
          ...newState.playerHands,
          [playerId]: playerHand
        };
        if (
          Object.keys(newState.playerPlayedCards).every(
            x =>
              newState.cardCzar === x || newState.playerPlayedCards[x] !== null
          )
        ) {
          // everyone has played, transition to "choosing"
          newState.state = "choosing";
        }
        return newState;
      case "chooseWinner":
        if (playerId !== newState.cardCzar) {
          throw new NotAllowedException("you_are_not_the_card_czar");
        }
        if (newState.state !== "choosing") {
          throw new NotAllowedException("not_choosing");
        }
        const chosenCards = args.cardIds;
        if (!Array.isArray(chosenCards) || typeof chosenCards[0] !== "string") {
          throw new NotAllowedException(
            "only_array_of_strings_please",
            `we got a ${typeof chosenCards}`
          );
        }
        const chosenBy = findKey(
          newState.playerPlayedCards,
          x => x !== null && arraysEqual(x, chosenCards)
        );
        if (typeof chosenBy === "undefined") {
          // that card wasn't actually played
          throw new NotAllowedException("that_card_was_not_played");
        }
        newState.scores[chosenBy]++;
        newState.roundWinner = chosenBy;
        this.scheduleCallback("newRound", 5000);
        newState.state = "waitingForNextRound";
        return newState;
      case "newRound":
        newState.state = "playing";
        newState.playerHands = this.fillHands(newState.playerHands, newState, 7);
        newState.blackCard = this.chooseRandomBlackCard(newState).id;
        newState.cardCzar = this.chooseNextCardCzar(newState);
        newState.playerPlayedCards = zipObject(
          this.lobby.players.map(x => x.id),
          this.lobby.players.map(_ => null)
        );
        newState.round = newState.round + 1;
        newState.roundWinner = null;
        return newState;
      case EngineActions.playerJoined:
        newState.playerHands[playerId] = this.dealHand(newState, 7);
        newState.scores[playerId] = 0;
        newState.playerPlayedCards[playerId] = null;
        return newState;
      case EngineActions.playerLeft:
        delete newState.playerHands[playerId];
        delete newState.scores[playerId];
        delete newState.playerPlayedCards[playerId];
        if (
          Object.keys(newState.playerPlayedCards).every(
            x =>
              newState.cardCzar === x || newState.playerPlayedCards[x] !== null
          )
        ) {
          newState.state = "choosing";
        }
        return newState;
      case EngineActions.playerUpdated:
        // nothing to do
        return newState;
      default:
        throw new UnknownMethodException(
          "unrecognised_method",
          method.toString()
        );
    }
  }
}
