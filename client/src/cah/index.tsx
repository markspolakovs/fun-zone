import React, { useState, useEffect } from "react";
import { Player, GameSocket } from "../gameSocket";
import { includes } from "lodash";
import { CAHProjectedState } from "@cards/shared/src/cah/state";
import { cards } from "@cards/shared/src/cah/cards";

console.log(cards.black);

interface CAHGameProps {
  initialState: CAHProjectedState;
  socket: GameSocket;
  players: Player[];
  player: Player;
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

  const blackCard = cards.black.find(x => state.blackCard === x.id)!;

  return (
    <div>
      <div>
        <b>Black Card: </b> {blackCard.text} (pick {blackCard.pick})
      </div>
      <div>
        <b>Your Hand</b>
        <ul>
          {cards.white
            .filter(x => includes(state.ourHand, x.id))
            .map(x => (
              <li key={x.id}>
                <button>{x.text}</button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
