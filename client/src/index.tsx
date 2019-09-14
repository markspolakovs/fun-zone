import "regenerator-runtime/runtime";
import React, { useState, useEffect } from "react";
import {
  Button,
  Segment,
  Form
} from "semantic-ui-react";
import "semantic-ui-css/semantic.min.css";
import ReactDOM from "react-dom";
import { apiCall, ApiError } from "./api";
import { Lobby } from "./lobby";

function Lobbies({ onJoin }: { onJoin: (sid: string) => any }) {
  const [playerName, setPlayerName] = useState("");
  const [joining, setJoining] = useState(false);
  const [lobbyCode, setLobbyCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  async function createNew() {
    setLoading(true);
    setJoining(false);
    const rez = await apiCall("/lobbies/startNew", {
      game: "cah",
      name: playerName
    });
    setLoading(false);
    onJoin(rez.yourSid);
  }

  async function join() {
    setLoading(true);
    setNotFound(false);
    try {
      const rez = await apiCall("/lobbies/join", {
        lobbyCode,
        name: playerName
      });
      setLoading(false);
      onJoin(rez.yourSid);
    } catch (e) {
      setLoading(false);
      if (e instanceof ApiError) {
        if (e.code === 404) {
          setNotFound(true);
          return;
        }
      }
      throw e;
    }
  }

  return (
    <div>
      <h1>Marks fun zone!</h1>
      <p>
        Someday this will support more games. For now, it only supports Cards
        Against Humanity.
      </p>
      <Segment>
        <Form>
          <Form.Group>
            <label>Your name</label>
            <Form.Input
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
            />
          </Form.Group>
        </Form>
      </Segment>

      <Button.Group>
        <Button onClick={createNew} disabled={loading}>
          Start new game
        </Button>
        <Button.Or />
        <Button onClick={() => setJoining(true)} disabled={loading}>
          Join Game
        </Button>
      </Button.Group>

      {joining && (
        <Segment>
          <h2>Enter the code given to you by the game host</h2>
          <Form.Input
            value={lobbyCode}
            onChange={e => setLobbyCode(e.target.value)}
          />
          <Button onClick={join} disabled={loading}>
            Join
          </Button>
          {notFound && (
            <Segment>
              That lobby code didn't work. Please ask the host for another!
            </Segment>
          )}
        </Segment>
      )}
    </div>
  );
}

function App() {
  const [state, setState] = React.useState<"nogame" | "ingame">("nogame");
  const [sid, setSid] = React.useState();

  useEffect(() => {
    if (state === "ingame") {
      let search = window.location.search;
      console.log(search.indexOf("sid="));
      if (search.indexOf("sid=") !== -1) {
        search = search.replace(/sid=.+($|&)/, `sid=${sid}`);
      } else {
        search = "?sid=" + sid;
      }
      window.history.pushState(
        { sid },
        "",
        window.location.origin + window.location.pathname + search
      );
      if (sessionStorage.getItem("NO_CACHE_SID") === null) {
        sessionStorage.setItem("SID", sid);
      }
    }
  }, [sid, state]);

  useEffect(() => {
    let sidMaybe;
    if (sessionStorage.getItem("NO_CACHE_SID") === null && sessionStorage.getItem("SID") !== null) {
      sidMaybe = sessionStorage.getItem("SID")!;
    } else if (window.history.state !== null && "sid" in window.history.state) {
      sidMaybe = window.history.state.sid;
    } else if (window.location.search.indexOf("sid") > -1) {
      sidMaybe = window.location.search.match(/sid=(.+)(&|$|\?)/)![1];
    }
    if (sidMaybe) {
      setSid(sidMaybe);
      setState("ingame");
    }
  }, []);

  if (state === "nogame") {
    return (
      <Lobbies
        onJoin={sid => {
          setSid(sid);
          setState("ingame");
        }}
      />
    );
  } else {
    return <Lobby sid={sid} />;
  }
}

ReactDOM.render(<App />, document.getElementById("root"));
