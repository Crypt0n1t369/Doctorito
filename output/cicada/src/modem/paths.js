import { BadInputError } from "./frame.js";

/* Delivery paths: what the audio has to travel through, and what survives it.
 *
 * The single most expensive mistake with data-over-sound is choosing a band
 * that the delivery path quietly removes. Nothing errors — the audio plays, the
 * receiver hears nothing, and the failure looks like a decoder bug.
 *
 * So the path is a first-class input. Declare where the sound is going and the
 * service says which bands can reach the far end. Cutoffs are from the relevant
 * standards where one exists, and from measured codec behaviour otherwise;
 * `experiments/ultrasonic.mjs` runs the real modem through each of them.
 */

/** The bands the modem can be placed in, and what it costs to be there. */
export const BANDS = {
  audible: {
    id: "audible",
    label: "Audible",
    lowHz: 672,
    highHz: 2313,
    centreHz: 1500,
    transducerPenaltyDb: 0,
    audibleToPeople: true,
    note: "Where the modem sits today. Below every voice-codec cutoff, so it survives paths that remove everything else.",
  },
  nearUltrasonic: {
    id: "nearUltrasonic",
    label: "Near-ultrasonic",
    lowHz: 18180,
    highHz: 19820,
    centreHz: 19000,
    // Measured in experiments/ultrasonic.mjs against a modelled phone
    // speaker and MEMS microphone.
    transducerPenaltyDb: -31.5,
    audibleToPeople: false,
    note: "Inaudible to most adults. Costs about 31 dB of link budget, which is roughly a thirty-fold loss of range, and is removed by every shared audio pipeline.",
  },
};
export const BAND_IDS = Object.keys(BANDS);
export const DEFAULT_BAND = "audible";

/**
 * `cutoffHz` is where the path stops passing audio. A band whose upper edge is
 * above it does not arrive — not degraded, absent.
 */
export const PATHS = {
  directSpeaker: {
    id: "directSpeaker",
    label: "Direct playback",
    cutoffHz: 24000,
    note: "A phone, tablet or laptop speaker playing the file itself, with nothing in between.",
    typicalRangeM: 10,
  },
  venuePa: {
    id: "venuePa",
    label: "Venue PA",
    cutoffHz: 18000,
    note: "Ceiling speakers and a class-D amplifier. Station concourses, airports, shops, arenas.",
    typicalRangeM: 25,
    source: "Commercial 70/100 V distributed speaker systems roll off well before 18 kHz.",
  },
  fmBroadcast: {
    id: "fmBroadcast",
    label: "FM broadcast",
    cutoffHz: 15000,
    note: "Programme audio stops at 15 kHz by the standard — the stereo pilot tone sits at 19 kHz and the subcarrier above it.",
    typicalRangeM: 10,
    source: "ITU-R BS.450 / BS.2213: FM baseband programme audio is limited to 15 kHz.",
  },
  dabBroadcast: {
    id: "dabBroadcast",
    label: "DAB+ / digital radio",
    cutoffHz: 15500,
    note: "The codec lowpasses well below Nyquist at broadcast bitrates.",
    typicalRangeM: 10,
  },
  videoStream: {
    id: "videoStream",
    label: "Video or streaming audio",
    cutoffHz: 16000,
    note: "AAC at typical bitrates discards the top octave. Broadcast TV, online video, podcasts.",
    typicalRangeM: 5,
  },
  voiceCall: {
    id: "voiceCall",
    label: "Voice call",
    cutoffHz: 12000,
    note: "Opus wideband on a modern call; far narrower on anything older.",
    typicalRangeM: 1,
  },
  telephony: {
    id: "telephony",
    label: "Narrowband telephony",
    cutoffHz: 3400,
    note: "PSTN, most IVR systems, and any gateway that still transcodes to G.711.",
    typicalRangeM: 1,
  },
};
export const PATH_IDS = Object.keys(PATHS);

export class PathError extends BadInputError {
  constructor(message) { super(message, "PathError"); }
}

export function pathOf(id) {
  const p = PATHS[id];
  if (!p) throw new PathError(`Unknown delivery path "${id}". Use one of: ${PATH_IDS.join(", ")}`);
  return p;
}

export function bandOf(id) {
  const b = BANDS[id];
  if (!b) throw new PathError(`Unknown band "${id}". Use one of: ${BAND_IDS.join(", ")}`);
  return b;
}

/** Does this band reach the far end of this path? */
export function survives(bandId, pathId) {
  const band = bandOf(bandId), path = pathOf(pathId);
  // Leave a little headroom: a cutoff is a knee, not a wall, and the modem
  // needs its whole occupied band, not just the centre.
  const headroomHz = 400;
  return band.highHz + headroomHz <= path.cutoffHz;
}

/**
 * Which bands reach the far end of a path, and why the others do not.
 * This is the question worth answering before anyone records anything.
 */
export function assess(pathId) {
  const path = pathOf(pathId);
  const bands = BAND_IDS.map(id => {
    const band = BANDS[id];
    const ok = survives(id, pathId);
    return {
      band: id,
      label: band.label,
      occupied_hz: [band.lowHz, band.highHz],
      survives: ok,
      reason: ok
        ? null
        : `${band.label} occupies up to ${band.highHz} Hz; ${path.label} stops passing audio at ${path.cutoffHz} Hz. `
          + "The audio will play and nothing will be received.",
      audible_to_people: band.audibleToPeople,
      link_budget_penalty_db: band.transducerPenaltyDb,
    };
  });
  const usable = bands.filter(b => b.survives);
  return {
    path: path.id,
    label: path.label,
    cutoff_hz: path.cutoffHz,
    note: path.note,
    ...(path.source ? { source: path.source } : {}),
    typical_range_m: path.typicalRangeM,
    bands,
    recommended_band: usable[0]?.band ?? null,
    ...(usable.length ? {} : {
      warning: `No band reaches the far end of ${path.label}. This path cannot carry Cicada.`,
    }),
  };
}

/** Every path a given band can actually reach. */
export function reachableBy(bandId) {
  bandOf(bandId);
  return PATH_IDS.filter(p => survives(bandId, p));
}
