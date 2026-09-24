// Picks recorded from the real model on 2026-09-24 through the replan service,
// for the demo's four reasons against the 10K demo plan with a simulated
// missed week. The demo replays them; code still builds and checks every
// option on the visitor's own plan.

export const REPLAN_SAMPLES = [
 {
  "reason": "trip",
  "language": "en",
  "text": "I was away on a work trip all week, and I’m back now.",
  "recordedOn": "2026-09-24",
  "pick": {
   "decision": "pick",
   "option": "repeat",
   "why": "Since your work trip is over and you're back now, redoing what you missed fits best.",
   "abstain": null
  },
  "meta": {
   "model": "deepseek-v4-flash",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "bdae189c-7bd0-44ee-9d6c-5d7a1c174ed9"
  }
 },
 {
  "reason": "swamped",
  "language": "en",
  "text": "Work has been overwhelming for weeks and I’m worn out.",
  "recordedOn": "2026-09-24",
  "pick": {
   "decision": "pick",
   "option": "lighter",
   "why": "Since work has left you worn out for weeks, lighter weeks that keep the most important sessions fit best.",
   "abstain": null
  },
  "meta": {
   "model": "deepseek-v4-flash",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "8894af67-fc4b-46f6-8f6b-a2d6b9353c91"
  }
 },
 {
  "reason": "forgot",
  "language": "en",
  "text": "I just forgot. I’m ready to get back to it.",
  "recordedOn": "2026-09-24",
  "pick": {
   "decision": "pick",
   "option": "keep",
   "why": "Since you just forgot and feel ready to get back to it, continuing the plan as it is fits best.",
   "abstain": null
  },
  "meta": {
   "model": "deepseek-v4-flash",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "160cc9d2-743e-4171-8a69-a1fb93180171"
  }
 },
 {
  "reason": "pain",
  "language": "en",
  "text": "My knee hurts when I run.",
  "recordedOn": "2026-09-24",
  "pick": {
   "decision": "abstain",
   "option": null,
   "why": null,
   "abstain": {
    "category": "medical",
    "reason": "Knee pain should be checked by a professional before you continue with the plan."
   }
  },
  "meta": {
   "model": "deepseek-v4-flash",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "39ea8a6e-fabe-45e0-8fa7-bf57261d6ed5"
  }
 },
 {
  "reason": "trip",
  "language": "es",
  "text": "Estuve de viaje de trabajo toda la semana y ya regresé.",
  "recordedOn": "2026-09-24",
  "pick": {
   "decision": "pick",
   "option": "repeat",
   "why": "Como el viaje ya terminó, retomar lo que se perdió encaja bien con tu situación.",
   "abstain": null
  },
  "meta": {
   "model": "deepseek-v4-flash",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "c90a4faa-5c9e-4f60-8471-d33565a3c20a"
  }
 },
 {
  "reason": "swamped",
  "language": "es",
  "text": "El trabajo me ha rebasado desde hace semanas y ando sin energía.",
  "recordedOn": "2026-09-24",
  "pick": {
   "decision": "pick",
   "option": "lighter",
   "why": "Como el trabajo te ha rebasado y sigues sin energía, conviene seguir con semanas más ligeras que mantengan lo esencial.",
   "abstain": null
  },
  "meta": {
   "model": "deepseek-v4-flash",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "068be80f-7731-4458-9958-f40d93ca1a50"
  }
 },
 {
  "reason": "forgot",
  "language": "es",
  "text": "Simplemente se me olvidó. Ya quiero retomarlo.",
  "recordedOn": "2026-09-24",
  "pick": {
   "decision": "pick",
   "option": "keep",
   "why": "Como solo fue un olvido y ya quieres retomarlo, lo mejor es continuar con el plan tal como está.",
   "abstain": null
  },
  "meta": {
   "model": "deepseek-v4-flash",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "dab8dfa0-379a-415d-a594-9290d3c93998"
  }
 },
 {
  "reason": "pain",
  "language": "es",
  "text": "Me duele la rodilla cuando corro.",
  "recordedOn": "2026-09-24",
  "pick": {
   "decision": "abstain",
   "option": null,
   "why": null,
   "abstain": {
    "category": "medical",
    "reason": "El dolor de rodilla al correr es una señal para consultar con un profesional antes de continuar con el plan."
   }
  },
  "meta": {
   "model": "deepseek-v4-flash",
   "promptVersion": "replan-aff51c833ae2",
   "requestId": "0014072a-26e5-4d28-a8c8-febc83d3c3f2"
  }
 }
] as const;
