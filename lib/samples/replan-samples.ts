// Picks recorded from GPT-6 Luna on 2026-09-25 through the replan service,
// for the demo's four reasons against the 10K demo plan with a simulated
// missed week. The demo replays them; code still builds and checks every
// option on the visitor's own plan.

export const REPLAN_SAMPLES = [
 {
  "reason": "trip",
  "language": "en",
  "text": "I was away on a work trip all week, and I’m back now.",
  "recordedOn": "2026-09-25",
  "pick": {
   "decision": "pick",
   "option": "repeat",
   "why": "Since your work trip is over and you’re back, repeating what you missed fits best.",
   "abstain": null
  },
  "meta": {
   "model": "gpt-6-luna",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "dcc50c78-f55f-4667-a02b-bcb79ef41b67"
  }
 },
 {
  "reason": "swamped",
  "language": "en",
  "text": "Work has been overwhelming for weeks and I’m worn out.",
  "recordedOn": "2026-09-25",
  "pick": {
   "decision": "pick",
   "option": "lighter",
   "why": "Lighter weeks fit because work has been overwhelming and you’re worn out.",
   "abstain": null
  },
  "meta": {
   "model": "gpt-6-luna",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "6ee524c3-9601-44d8-91ad-9597b1aeb8ce"
  }
 },
 {
  "reason": "forgot",
  "language": "en",
  "text": "I just forgot. I’m ready to get back to it.",
  "recordedOn": "2026-09-25",
  "pick": {
   "decision": "pick",
   "option": "keep",
   "why": "Since this was a one-off miss and you’re ready to continue, keep going with the plan as it is.",
   "abstain": null
  },
  "meta": {
   "model": "gpt-6-luna",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "2f568f41-bb21-4ec3-9706-c6955b16891a"
  }
 },
 {
  "reason": "pain",
  "language": "en",
  "text": "My knee hurts when I run.",
  "recordedOn": "2026-09-25",
  "pick": {
   "decision": "abstain",
   "option": null,
   "why": null,
   "abstain": {
    "category": "medical",
    "reason": "Knee pain can affect safe training; check with a medical professional before continuing."
   }
  },
  "meta": {
   "model": "gpt-6-luna",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "b4268b6b-99cb-4f8f-bab6-4e6328ba3ca3"
  }
 },
 {
  "reason": "trip",
  "language": "es",
  "text": "Estuve de viaje de trabajo toda la semana y ya regresé.",
  "recordedOn": "2026-09-25",
  "pick": {
   "decision": "pick",
   "option": "repeat",
   "why": "Como ya regresaste del viaje, repetir lo que te perdiste encaja con tu situación.",
   "abstain": null
  },
  "meta": {
   "model": "gpt-6-luna",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "596b209f-43af-4ab2-8063-a1b89c496d78"
  }
 },
 {
  "reason": "swamped",
  "language": "es",
  "text": "El trabajo me ha rebasado desde hace semanas y ando sin energía.",
  "recordedOn": "2026-09-25",
  "pick": {
   "decision": "pick",
   "option": "lighter",
   "why": "Las semanas más ligeras encajan con el estrés y la falta de energía que vienes sintiendo.",
   "abstain": null
  },
  "meta": {
   "model": "gpt-6-luna",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "7585cc06-e287-465e-b1ea-29a2b1672698"
  }
 },
 {
  "reason": "forgot",
  "language": "es",
  "text": "Simplemente se me olvidó. Ya quiero retomarlo.",
  "recordedOn": "2026-09-25",
  "pick": {
   "decision": "pick",
   "option": "keep",
   "why": "Como solo se te olvidó y ya estás listo para continuar, puedes seguir con el plan tal como está.",
   "abstain": null
  },
  "meta": {
   "model": "gpt-6-luna",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "00960e2e-43e2-40ae-b5df-195107b15f1a"
  }
 },
 {
  "reason": "pain",
  "language": "es",
  "text": "Me duele la rodilla cuando corro.",
  "recordedOn": "2026-09-25",
  "pick": {
   "decision": "abstain",
   "option": null,
   "why": null,
   "abstain": {
    "category": "medical",
    "reason": "El dolor de rodilla requiere consultar con un profesional antes de continuar."
   }
  },
  "meta": {
   "model": "gpt-6-luna",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "82c7edb1-1ce0-4f4e-8cd7-1d2cc5c7be55"
  }
 }
] as const;
