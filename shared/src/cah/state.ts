type PlayerID = string;
type CardID = string;
export interface CAHGameState {
  state: "playing" | "choosing" | "waitingForNextRound";
  playerHands: { [playerId: string]: CardID[] };
  playerPlayedCards: { [playerId: string]: CardID[] | null };
  scores: { [playerId: string]: number };
  cardCzar: PlayerID;
  blackCard: CardID;
  discards: CardID[];
  round: number;
  roundWinner: PlayerID | null;
}
export interface CAHProjectedState {
  state: "playing" | "choosing" | "waitingForNextRound";
  ourHand: CardID[];
  scores: { [playerId: string]: number };
  playerPlayedCards: { [playerId: string]: boolean }; // Note that we don't tell the other players what one played, only whether they played one or not.
  cardCzar: PlayerID;
  blackCard: CardID;
  ourPlayedCard: CardID[] | null;
  round: number;
  allPlayerCards: CardID[][] | null;
  roundWinner: PlayerID | null;
}

export interface CAHSettings {
  gameLength: number;
}