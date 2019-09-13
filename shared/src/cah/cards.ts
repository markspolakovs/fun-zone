import { includes } from "lodash";
import * as data from "./cah.json";

export interface BlackCard {
  id: string;
  pick: string;
  text: string;
}

export interface WhiteCard {
  id: string;
  text: string;
}

export function makeBlackCards(): Array<BlackCard> {
  const cardIds = Object.keys(data.blackCards);
  const select = cardIds.filter(x =>
    includes(data.Base.black, parseInt(x, 10))
  );
  return select.map(id => ({
    id,
    pick: (data.blackCards as any)[id].pick,
    text: (data.blackCards as any)[id].text
  }));
}

export function makeWhiteCards(): Array<WhiteCard> {
  const cardIds = Object.keys(data.whiteCards);
  const select = cardIds.filter(x =>
    includes(data.Base.white, parseInt(x, 10))
  );
  return select.map(id => ({
    id,
    text: (data.whiteCards as any)[id]
  }));
}

export const cards = {
  black: makeBlackCards(),
  white: makeWhiteCards()
};
