/**
 * "First time here? I can show you round."
 *
 * The Arena and Tournament tours are offered rather than sprung. The Workshop
 * tour is different — somebody asked for that one on the welcome screen — but
 * arriving in a lobby is not asking for anything, and a room full of people
 * waiting for you is the worst possible moment to have a coach mark appear
 * unbidden. So this is a line in the lobby that has to be clicked.
 *
 * It shows once. Dismissing it counts as an answer.
 */

import { Avatar } from "../character/Avatar.js";
import { Tour } from "./Tour.js";
import { fillVocab } from "../../learn/markdown.js";
import type { TourApi } from "./useTour.js";
import type { Theme } from "../../lang/vocab.js";

interface Props {
  tour: TourApi;
  theme: Theme;
  /** Not offered until this is true — no point touring an empty lobby. */
  ready: boolean;
  offer: string;
}

export function TourOffer({ tour, theme, ready, offer }: Props) {
  return (
    <>
      {tour.step === null && ready && !tour.settled ? (
        <div className="notice tour-offer">
          <Avatar theme={theme} state="idle" size={28} />
          <span>{fillVocab(offer, theme)}</span>
          <span className="spacer" />
          <button type="button" className="btn small primary" onClick={tour.begin}>
            Show me
          </button>
          <button type="button" className="btn small" onClick={tour.skip}>
            No thanks
          </button>
        </div>
      ) : null}
      <Tour tour={tour} theme={theme} />
    </>
  );
}
