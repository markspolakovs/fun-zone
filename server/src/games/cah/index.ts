import { zipObject, chain, includes, range, findKey, values } from "lodash";
import {
  Game,
  NotAllowedException,
  UnknownMethodException
} from "../gameState";

import { cards, BlackCard } from "@cards/shared/src/cah/cards";
import { CAHGameState, CAHProjectedState, CAHSettings } from "@cards/shared/src/cah/state";

interface DiscardRef {
  discards: string[];
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
      playerHands: this.fillHands(discardsRef, 7),
      playerPlayedCards: zipObject(
        this.lobby.players.map(x => x.id),
        range(this.lobby.players.length).map(_ => null)
      ),
      scores: zipObject(
        this.lobby.players.map(x => x.id),
        range(this.lobby.players.length).map(_ => 0)
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
    const stack = chain(cards.black)
      .filter(x => !includes(dr.discards, x.id))
      .value();
    const chosen = this.chance.pickone(stack);
    dr.discards.push(chosen.id);
    return chosen;
  }

  private fillHands(
    dr: DiscardRef,
    howMany: number
  ): { [Player: string]: string[] } {
    const result: { [K: string]: string[] } = {};
    for (const player of this.lobby.players) {
      const stack = cards.white.filter(card => !includes(dr.discards, card.id));
      const picked = this.chance.pickset(stack, howMany);
      picked.forEach(x => dr.discards.push(x.id));
      result[player.id] = picked.map(x => x.id);
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
          ? (values(state.playerPlayedCards) as string[])
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
        const playerHand = newState.playerHands[playerId];
        const playerHandIndex = playerHand.indexOf(args.cardId);
        if (playerHandIndex === -1) {
          throw new NotAllowedException("not_in_hand");
        }
        playerHand.splice(playerHandIndex, 1);
        newState.playerPlayedCards = {
          ...newState.playerPlayedCards,
          [playerId]: args.cardId
        };
        newState.playerHands = {
          ...newState.playerHands,
          [playerId]: playerHand
        };
        if (
          Object.keys(newState.playerPlayedCards).every(
            x => newState.playerPlayedCards[x] !== null
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
        const chosenBy = findKey(
          newState.playerPlayedCards,
          x => x === args.cardId
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
        newState.playerHands = this.fillHands(newState, 7);
        newState.blackCard = this.chooseRandomBlackCard(newState).id;
        newState.cardCzar = this.chooseNextCardCzar(newState);
        newState.playerPlayedCards = zipObject(
          this.lobby.players.map(x => x.id),
          range(this.lobby.players.length).map(_ => null)
        );
        newState.round = newState.round + 1;
        newState.roundWinner = null;
        return newState;
      default:
        throw new UnknownMethodException("unrecognised_method");
    }
  }
}
