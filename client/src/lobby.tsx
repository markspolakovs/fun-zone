import React, { useCallback, useState, useEffect } from "react";
import { Button, Message, Icon, Modal } from "semantic-ui-react";
import { useGameSocket, Opcodes } from "./gameSocket";
import CAHGame from "./cah";

export function Lobby({ sid }: { sid: string }) {
  const [socket, state, lobby, player, players] = useGameSocket(sid);
  const [notReadyPrompt, setNotReadyPrompt] = useState(false);
  const [initialGameState, setInitialGameState] = useState(null);

  const startGame = useCallback(
    async (bypass = false) => {
      setNotReadyPrompt(false);
      if (!bypass) {
        // Check if everyone is ready
        const everyoneReady = players.every(x => x.isReady);
        if (!everyoneReady) {
          setNotReadyPrompt(true);
          return;
        }
      }
      // Start the game!
      socket.callMethod(Opcodes.StartGame, {
        onr: bypass
      });
    },
    [players, socket]
  );

  useEffect(() => {
    const handler = (state: any) => {
      if (initialGameState === null) {
        setInitialGameState(state);
      }
    };
    if (socket !== null) {
      socket.on("gameStateUpdate", handler);
      return () => socket.off("gameStateUpdate", handler);
    }
  }, [socket, initialGameState]);

  return (
    <div>
      <b>Socket state: {state}</b>

      {!socket ? (
        <Message icon>
          <Icon name="circle notched" loading />
          <Message.Content>
            <Message.Header>Connecting...</Message.Header>
          </Message.Content>
        </Message>
      ) : !player ? (
        <Message icon>
          <Icon name="circle notched" loading />
          <Message.Content>
            <Message.Header>Authenticating...</Message.Header>
          </Message.Content>
        </Message>
      ) : socket.state === "ready" ? (
        <Message>
          <Message.Content positive>
            <Message.Header>Connected!</Message.Header>
          </Message.Content>
        </Message>
      ) : socket.state === "closed" ? (
        <Message>
          <Message.Content negative>
            <Message.Header>Disconnected from game server</Message.Header>
          </Message.Content>
        </Message>
      ) : (
        <Message>
          <Message.Content>
            <Message.Header>Confused: {socket.state}</Message.Header>
          </Message.Content>
        </Message>
      )}

      {initialGameState !== null ? (
        <CAHGame
          initialState={initialGameState}
          socket={socket!}
          player={player!}
          players={players!}
        />
      ) : (
        <>
          {player &&
            (player.isReady ? (
              <Button
                key="unready"
                onClick={() => socket!.callMethod(Opcodes.Unready, {})}
              >
                Unready
              </Button>
            ) : (
              <Button
                key="ready-up"
                onClick={() => socket!.callMethod(Opcodes.ReadyUp, {})}
              >
                Ready up
              </Button>
            ))}

          {player && player.isHost && (
            <Button onClick={() => startGame()}>Start Game</Button>
          )}
        </>
      )}

      <Modal open={notReadyPrompt} onClose={() => setNotReadyPrompt(false)}>
        <Modal.Header>Not everyone is ready</Modal.Header>
        <Modal.Content>
          Are you sure you want to start the game?
          <Button
            onClick={() => {
              setNotReadyPrompt(false);
              startGame(true);
            }}
          >
            Yes
          </Button>
          <Button onClick={() => setNotReadyPrompt(false)}>No</Button>
        </Modal.Content>
      </Modal>

      <div>
        <b>Players</b>
        <pre>{JSON.stringify(players, null, 2)}</pre>
      </div>

      {lobby && <b>Lobby Code: {lobby.settings.code}</b>}
    </div>
  );
}
