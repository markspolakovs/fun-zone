import React, { useState, useEffect, useMemo, useReducer } from "react";
import { Player, GameSocket, Opcodes } from "../gameSocket";
import { includes } from "lodash";
import { CAHProjectedState } from "@cards/shared/src/cah/state";
import { cards, WhiteCard } from "@cards/shared/src/cah/cards";

interface CAHGameProps {
  initialState: CAHProjectedState;
  socket: GameSocket;
  players: Player[];
  player: Player;
}

function chosenCardsReducer(state: string[], action: string) {
  if (state.indexOf(action) === -1) {
    return [...state, action];
  } else {
    const rez = state.slice(0);
    rez.splice(rez.indexOf(action), 1);
    return rez;
  }
}

export default function CAHGame({
  initialState,
  socket,
  players,
  player
}: CAHGameProps) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    const handler = (state: CAHProjectedState) => {
      setState(state);
    };
    socket.on("gameStateUpdate", handler);
    return () => socket.off("gameStateUpdate", handler);
  }, [socket]);

  const blackCard = useMemo(
    () => cards.black.find(x => state.blackCard === x.id)!,
    [state.blackCard]
  );

  const playedCards = useMemo(
    () =>
      state.allPlayerCards === null
        ? null
        : state.allPlayerCards.map(x =>
            x.map(y => cards.white.find(z => y === z.id))
          ),
    [state.allPlayerCards]
  );

  const isCardCzar = useMemo(() => player && state.cardCzar === player.id, [
    player,
    state.cardCzar
  ]);

  const [chosenCards, playCard] = useReducer(chosenCardsReducer, []);

  useEffect(() => {
    if (chosenCards.length === parseInt(blackCard.pick, 10)) {
      socket.callMethod(Opcodes.GameAction, {
        op: "playCard",
        d: {
          cardIds: chosenCards
        }
      });
    }
  }, [chosenCards, blackCard, socket]);

  function chooseWinner(combo: WhiteCard[]) {
    socket.callMethod(Opcodes.GameAction, {
      op: "chooseWinner",
      d: {
        cardIds: combo.map(x => x.id)
      }
    });
  }

  return (
    <div>
      <div>
        <b>Black Card: </b> {blackCard.text}
        {parseInt(blackCard.pick, 10) > 1 && ` (pick ${blackCard.pick})`}
      </div>
      <div>
        {state.state === "waitingForNextRound" && (
          <b>
            The winner is {players.find(x => x.id === state.roundWinner)!.name}!
            The next round will begin shortly...
          </b>
        )}
        {state.state === "choosing" && (
          <>
            {!isCardCzar ? (
              <b>Wait for the Card Czar to pick the funniest card!</b>
            ) : (
              <b>Pick the funniest card!</b>
            )}
            {playedCards !== null &&
              playedCards.map((combo, i) => (
                <div key={i}>
                  {combo.map(card => (
                    <div key={card.id}>
                      <em>{card.text}</em>
                    </div>
                  ))}
                  {isCardCzar && (
                    <button onClick={() => chooseWinner(combo)}>Choose</button>
                  )}
                </div>
              ))}
          </>
        )}
        {state.state === "playing" &&
          (isCardCzar ? (
            <b>
              You are the Card Czar. Wait for the other players to play their
              cards, then pick your favourite!
            </b>
          ) : (
            <>
              <b>Your Hand</b>
              <ul>
                {cards.white
                  .filter(x => includes(state.ourHand, x.id))
                  .map(x => (
                    <li key={x.id}>
                      <button
                        style={{
                          backgroundColor:
                            chosenCards.indexOf(x.id) > -1
                              ? "orange"
                              : "initial"
                        }}
                        onClick={() => playCard(x.id)}
                        disabled={
                          player && !!state.playerPlayedCards[player.id]
                        }
                      >
                        {x.text}
                        {<>&nbsp;</>}
                        {parseInt(blackCard.pick, 10) > 1 &&
                          chosenCards.indexOf(x.id) > -1 && (
                            <b>{chosenCards.indexOf(x.id) + 1}</b>
                          )}
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          ))}
      </div>
    </div>
  );
}
