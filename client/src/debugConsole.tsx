import React from "react";
import ReactDOM from "react-dom";
import Engine, { Socket } from "engine.io-client";
import { useRawGameSocket } from "./gameSocket";

function msgReducer(state: string[], action: string) {
  return [action, ...state];
}

export function DebugConsole() {
  const sock = useRawGameSocket();
  const [messages, addMessage] = React.useReducer(msgReducer, []);
  const [status, setStatus] = React.useState("nada");
  const [inputVal, setInputVal] = React.useState(`{
    "op": 0,
    "opid": 0,
    "d": {
        "sid": ""
    }
}`);

  React.useEffect(() => {
    const listener = (msg: string | ArrayBuffer) => {
      if (msg instanceof ArrayBuffer) {
        // TODO
        return;
      }
      const data = JSON.parse(msg);
      addMessage(JSON.stringify(data, null, 2));
      let eventType: string | null = null;
      switch (data.e) {
        case 0:
          eventType = "Ack";
          break;
        case 1:
          eventType = "Helo";
          break;
        case 10:
          eventType = "LobbyMemberJoin";
          break;
        case 11:
          eventType = "LobbyMemberLeave";
          break;
        case 12:
          eventType = "LobbyMemberUpdate";
          break;
        case 100:
          eventType = "GameStart";
          break;
        case 101:
          eventType = "GameEnd";
          break;
        case 102:
          eventType = "GameStateUpdate";
          break;
        case 4001:
          eventType = "NoSuchSession";
          break;
        case 99998:
          eventType = "ServerShutdown";
          break;
        case 99999:
          eventType = "InternalError";
          break;
      }
      if (eventType !== null) {
        addMessage(`[event type: ${eventType}]`);
      }
    };
    sock.on("message", listener);
    sock.on("open", () => {
      setStatus("open");
    });
    sock.on("close", (mes, data) => {
      setStatus("close");
      addMessage(`SOCKET CLOSED!
${mes}
${data.name} ${data.message}
${data.stack}`);
    });
  }, []);

  const send = React.useCallback(() => {
    sock.send(inputVal);
    addMessage(
      inputVal
        .split("\n")
        .map(x => "> " + x)
        .join("\n")
    );
  }, [sock, inputVal]);

  return (
    <div>
      <div>
        <textarea
          rows={8}
          cols={80}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
        />
        <button onClick={send}>Send</button>
      </div>
      <small>Socket state: {status}</small>
      <pre>{messages.join("\n\n")}</pre>
    </div>
  );
}

