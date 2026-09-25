// Demo samples: real outputs recorded from GPT-6 Luna through the Cadencia
// service on 2026-09-25, with the production settings (reasoning off,
// temperature 0.2), for fixed example texts written by the developer. They
// drive the model-free demo only; they are not evaluation data. The readings
// predate the narrower decline rules of read-goal-319f4ce09354 (evals section
// 11); none of these examples is a borderline case those rules change.

export const GOAL_SAMPLES: ReadonlyArray<Record<string, unknown>> = [
 {
  "id": "ten_k",
  "language": "en",
  "text": "Run a 10K by December. Weekday mornings only, 3 hours a week at most.",
  "recordedOn": "2026-09-25",
  "reading": {
   "decision": "plan",
   "title": "Train for a 10K",
   "summary": "You want to run a 10K by December, practicing on weekday mornings and spending at most 3 hours per week.",
   "domain": "fitness",
   "level": "unknown",
   "deadline": "2026-12-01",
   "deadline_basis": "inferred",
   "days": [
    0,
    1,
    2,
    3,
    4
   ],
   "window": "morning",
   "weekly_minutes": 180,
   "session_minutes": null,
   "question": null,
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "b2a3d0cc-6431-4177-bb55-208e166d766a"
  },
  "draft": {
   "phases": [
    {
     "title": "Build a running habit",
     "fromWeek": 1,
     "toWeek": 3,
     "focus": "Establish easy, repeatable run-walk sessions."
    },
    {
     "title": "Build endurance",
     "fromWeek": 4,
     "toWeek": 7,
     "focus": "Gradually extend easy running and add controlled quality work."
    },
    {
     "title": "Prepare for 10K",
     "fromWeek": 8,
     "toWeek": 10,
     "focus": "Build sustained endurance with one weekly quality session."
    },
    {
     "title": "Ease off",
     "fromWeek": 11,
     "toWeek": 11,
     "focus": "Reduce training and finish feeling fresh."
    }
   ],
   "sessionTypes": [
    {
     "id": "easy_run",
     "title": "Easy run-walk",
     "minutes": 20,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Walk briskly to warm up."
      },
      {
       "minutes": 10,
       "activity": "Alternate easy jogging and walking as needed."
      },
      {
       "minutes": 5,
       "activity": "Walk gently to cool down."
      }
     ],
     "deliverable": "A completed easy run-walk.",
     "doneWhen": "Finish all 20 minutes at a conversational effort."
    },
    {
     "id": "steady_run",
     "title": "Steady run-walk",
     "minutes": 25,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Walk briskly to warm up."
      },
      {
       "minutes": 15,
       "activity": "Jog steadily, using short walk breaks when needed."
      },
      {
       "minutes": 5,
       "activity": "Walk gently to cool down."
      }
     ],
     "deliverable": "A steady run-walk session.",
     "doneWhen": "Complete 25 minutes at a controlled, sustainable effort."
    },
    {
     "id": "long_easy",
     "title": "Long easy run-walk",
     "minutes": 35,
     "intensity": "easy",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Walk briskly to warm up."
      },
      {
       "minutes": 25,
       "activity": "Jog easily, taking walk breaks as needed."
      },
      {
       "minutes": 5,
       "activity": "Walk gently to cool down."
      }
     ],
     "deliverable": "A longer easy run-walk.",
     "doneWhen": "Complete 35 minutes without pushing the pace."
    },
    {
     "id": "intervals",
     "title": "Controlled intervals",
     "minutes": 25,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Walk and jog easily to warm up."
      },
      {
       "minutes": 15,
       "activity": "Repeat 1 minute brisk jogging and 2 minutes easy jogging or walking."
      },
      {
       "minutes": 5,
       "activity": "Walk gently to cool down."
      }
     ],
     "deliverable": "A controlled interval session.",
     "doneWhen": "Finish each brisk segment with enough control to continue."
    },
    {
     "id": "long_build",
     "title": "Extended easy run-walk",
     "minutes": 45,
     "intensity": "easy",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Walk briskly to warm up."
      },
      {
       "minutes": 35,
       "activity": "Jog easily, taking walk breaks as needed."
      },
      {
       "minutes": 5,
       "activity": "Walk gently to cool down."
      }
     ],
     "deliverable": "An extended easy run-walk.",
     "doneWhen": "Complete 45 minutes at a conversational effort."
    },
    {
     "id": "tempo_intro",
     "title": "Steady effort intervals",
     "minutes": 30,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Walk and jog easily to warm up."
      },
      {
       "minutes": 20,
       "activity": "Alternate 4 minutes steady jogging with 1 minute easy walking."
      },
      {
       "minutes": 5,
       "activity": "Walk gently to cool down."
      }
     ],
     "deliverable": "A session of controlled steady intervals.",
     "doneWhen": "Complete the steady portions without straining."
    },
    {
     "id": "long_10k",
     "title": "10K endurance run-walk",
     "minutes": 55,
     "intensity": "easy",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Walk briskly to warm up."
      },
      {
       "minutes": 45,
       "activity": "Jog easily, using walk breaks whenever needed."
      },
      {
       "minutes": 5,
       "activity": "Walk gently to cool down."
      }
     ],
     "deliverable": "A 55-minute easy endurance session.",
     "doneWhen": "Finish at a conversational effort and complete the cool-down."
    }
   ],
   "weeks": [
    {
     "week": 1,
     "sessions": []
    },
    {
     "week": 2,
     "sessions": [
      "easy_run",
      "easy_run",
      "long_easy"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "easy_run",
      "steady_run",
      "long_easy"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "easy_run",
      "steady_run",
      "long_easy"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "easy_run",
      "steady_run",
      "long_easy"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "easy_run",
      "intervals",
      "long_build"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "easy_run",
      "tempo_intro",
      "long_build"
     ]
    },
    {
     "week": 8,
     "sessions": [
      "easy_run",
      "intervals",
      "long_10k"
     ]
    },
    {
     "week": 9,
     "sessions": [
      "easy_run",
      "tempo_intro",
      "long_10k"
     ]
    },
    {
     "week": 10,
     "sessions": [
      "easy_run",
      "intervals",
      "long_10k"
     ]
    },
    {
     "week": 11,
     "sessions": [
      "easy_run",
      "long_easy"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "644fa96e-f48e-4dde-9713-bb132dfb899f",
   "attempt": 1
  },
  "recordedWeeks": 11
 },
 {
  "id": "ten_k",
  "language": "es",
  "text": "Correr 10 km para diciembre. Solo entre semana en la mañana, máximo 3 horas por semana.",
  "recordedOn": "2026-09-25",
  "reading": {
   "decision": "plan",
   "title": "Prepararme para correr 10 km",
   "summary": "Quiere correr 10 km para diciembre, solo entre semana por la mañana y con un máximo de 3 horas por semana.",
   "domain": "fitness",
   "level": "unknown",
   "deadline": "2026-12-01",
   "deadline_basis": "inferred",
   "days": [
    0,
    1,
    2,
    3,
    4
   ],
   "window": "morning",
   "weekly_minutes": 180,
   "session_minutes": null,
   "question": null,
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "f91efcdc-094c-4f44-aef3-b76b11f0b226"
  },
  "draft": {
   "phases": [
    {
     "title": "Base y constancia",
     "fromWeek": 1,
     "toWeek": 3,
     "focus": "Crear hábito con carrera suave y caminatas."
    },
    {
     "title": "Construcción",
     "fromWeek": 4,
     "toWeek": 7,
     "focus": "Aumentar gradualmente el tiempo de carrera."
    },
    {
     "title": "Resistencia y descarga",
     "fromWeek": 8,
     "toWeek": 11,
     "focus": "Consolidar la distancia y llegar descansado."
    }
   ],
   "sessionTypes": [
    {
     "id": "suave",
     "title": "Carrera suave",
     "minutes": 25,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Caminar a paso ligero."
      },
      {
       "minutes": 15,
       "activity": "Alternar trote cómodo y caminata si hace falta."
      },
      {
       "minutes": 5,
       "activity": "Caminar para terminar."
      }
     ],
     "deliverable": "Registro del tiempo de trote y caminata.",
     "doneWhen": "Completa 25 minutos a ritmo cómodo."
    },
    {
     "id": "larga",
     "title": "Carrera larga suave",
     "minutes": 40,
     "intensity": "easy",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Caminar a paso ligero."
      },
      {
       "minutes": 30,
       "activity": "Trotar cómodamente, alternando caminata cuando sea necesario."
      },
      {
       "minutes": 5,
       "activity": "Caminar para terminar."
      }
     ],
     "deliverable": "Registro del tiempo total y la distancia recorrida.",
     "doneWhen": "Completa 40 minutos sin forzar el ritmo."
    },
    {
     "id": "progresiva",
     "title": "Carrera progresiva",
     "minutes": 30,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Caminar y trotar muy suave."
      },
      {
       "minutes": 20,
       "activity": "Trotar cómodo y acelerar ligeramente en los últimos 5 minutos."
      },
      {
       "minutes": 5,
       "activity": "Caminar para terminar."
      }
     ],
     "deliverable": "Registro de sensaciones y distancia.",
     "doneWhen": "Termina con esfuerzo controlado y puede hablar en frases."
    },
    {
     "id": "larga_extendida",
     "title": "Carrera larga extendida",
     "minutes": 50,
     "intensity": "easy",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Caminar a paso ligero."
      },
      {
       "minutes": 40,
       "activity": "Trotar a ritmo cómodo, alternando caminata si hace falta."
      },
      {
       "minutes": 5,
       "activity": "Caminar para terminar."
      }
     ],
     "deliverable": "Registro del tiempo y la distancia recorrida.",
     "doneWhen": "Completa 50 minutos manteniendo un esfuerzo fácil."
    },
    {
     "id": "larga_maxima",
     "title": "Carrera larga de resistencia",
     "minutes": 60,
     "intensity": "easy",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Caminar a paso ligero."
      },
      {
       "minutes": 50,
       "activity": "Trotar cómodamente, alternando caminata cuando sea necesario."
      },
      {
       "minutes": 5,
       "activity": "Caminar para terminar."
      }
     ],
     "deliverable": "Registro del tiempo y la distancia recorrida.",
     "doneWhen": "Completa 60 minutos a ritmo fácil."
    },
    {
     "id": "descarga",
     "title": "Carrera fácil de descarga",
     "minutes": 20,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Caminar a paso ligero."
      },
      {
       "minutes": 10,
       "activity": "Trotar muy suave o alternar con caminata."
      },
      {
       "minutes": 5,
       "activity": "Caminar para terminar."
      }
     ],
     "deliverable": "Registro breve de cómo se sintió la sesión.",
     "doneWhen": "Completa 20 minutos sin apretar."
    }
   ],
   "weeks": [
    {
     "week": 1,
     "sessions": []
    },
    {
     "week": 2,
     "sessions": [
      "suave",
      "larga"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "suave",
      "larga",
      "descarga"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "suave",
      "progresiva",
      "larga"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "suave",
      "progresiva",
      "larga_extendida"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "suave",
      "progresiva",
      "larga_extendida"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "suave",
      "progresiva",
      "larga_maxima"
     ]
    },
    {
     "week": 8,
     "sessions": [
      "suave",
      "progresiva",
      "larga_maxima"
     ]
    },
    {
     "week": 9,
     "sessions": [
      "suave",
      "progresiva",
      "larga_maxima"
     ]
    },
    {
     "week": 10,
     "sessions": [
      "suave",
      "larga_maxima",
      "descarga"
     ]
    },
    {
     "week": 11,
     "sessions": [
      "descarga",
      "suave"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "80ce2800-4325-481f-aaac-08a234303a9f",
   "attempt": 1
  },
  "recordedWeeks": 11
 },
 {
  "id": "guitar",
  "language": "en",
  "text": "Learn guitar: basic chords and three full songs by the end of the year, Tuesday and Thursday evenings.",
  "recordedOn": "2026-09-25",
  "reading": {
   "decision": "plan",
   "title": "Learn Basic Guitar and Three Songs",
   "summary": "The person wants to learn basic guitar chords and three full songs by the end of the year, practicing Tuesday and Thursday evenings.",
   "domain": "learning",
   "level": "unknown",
   "deadline": "2026-12-01",
   "deadline_basis": "inferred",
   "days": [
    1,
    3
   ],
   "window": "evening",
   "weekly_minutes": null,
   "session_minutes": null,
   "question": null,
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "f6c9a02b-1d06-4d38-b72f-5c27f5794691"
  },
  "draft": {
   "phases": [
    {
     "title": "Guitar foundations",
     "fromWeek": 1,
     "toWeek": 3,
     "focus": "Learn instrument setup, basic chords, and steady strumming."
    },
    {
     "title": "Build song skills",
     "fromWeek": 4,
     "toWeek": 7,
     "focus": "Learn three songs in sections and improve chord changes."
    },
    {
     "title": "Complete and polish",
     "fromWeek": 8,
     "toWeek": 11,
     "focus": "Join song sections, practice full performances, and finish with a light review."
    }
   ],
   "sessionTypes": [
    {
     "id": "chord_foundations",
     "title": "Chord foundations",
     "minutes": 45,
     "intensity": "easy",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Tune the guitar and check posture."
      },
      {
       "minutes": 15,
       "activity": "Practice two basic chord shapes slowly."
      },
      {
       "minutes": 15,
       "activity": "Switch between the chords with a steady count."
      },
      {
       "minutes": 10,
       "activity": "Play a simple strumming pattern through the changes."
      }
     ],
     "deliverable": "A short recording of the practiced chord changes.",
     "doneWhen": "Play each chord clearly and complete ten slow changes between them."
    },
    {
     "id": "rhythm_and_changes",
     "title": "Rhythm and chord changes",
     "minutes": 45,
     "intensity": "moderate",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Tune and review the chord shapes."
      },
      {
       "minutes": 15,
       "activity": "Practice a steady down-up strumming pattern."
      },
      {
       "minutes": 15,
       "activity": "Change chords in time with a slow count."
      },
      {
       "minutes": 10,
       "activity": "Play a repeating chord progression without stopping."
      }
     ],
     "deliverable": "A recording of one uninterrupted chord progression.",
     "doneWhen": "Keep the beat through the progression with no more than two pauses."
    },
    {
     "id": "song_section",
     "title": "Learn a song section",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Tune and review the song's chords."
      },
      {
       "minutes": 15,
       "activity": "Practice the chord sequence slowly."
      },
      {
       "minutes": 20,
       "activity": "Learn one verse or chorus in short phrases."
      },
      {
       "minutes": 15,
       "activity": "Join the phrases and repeat with steady strumming."
      },
      {
       "minutes": 5,
       "activity": "Record a take and note one improvement."
      }
     ],
     "deliverable": "A recording of one verse or chorus from the current song.",
     "doneWhen": "Play the section from start to finish, keeping the chord order and beat."
    },
    {
     "id": "song_runthrough",
     "title": "Song run-through",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Tune and warm up with familiar chords."
      },
      {
       "minutes": 15,
       "activity": "Review the song's chord changes."
      },
      {
       "minutes": 25,
       "activity": "Play the song from beginning to end, repeating difficult transitions."
      },
      {
       "minutes": 10,
       "activity": "Perform one uninterrupted full-song take."
      },
      {
       "minutes": 5,
       "activity": "Record what to polish next."
      }
     ],
     "deliverable": "A full-song recording and one specific practice note.",
     "doneWhen": "Complete one full take without stopping, even if a chord is imperfect."
    },
    {
     "id": "repertoire_review",
     "title": "Repertoire review",
     "minutes": 45,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Tune and choose a comfortable tempo."
      },
      {
       "minutes": 30,
       "activity": "Play familiar sections from all three songs."
      },
      {
       "minutes": 10,
       "activity": "Record the strongest section from each song."
      }
     ],
     "deliverable": "Three short recordings, one from each song.",
     "doneWhen": "Play a recognizable section of each song and identify any remaining rough spot."
    },
    {
     "id": "final_performance",
     "title": "Three-song performance",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Tune and set a comfortable tempo."
      },
      {
       "minutes": 15,
       "activity": "Warm up with the three songs' chord changes."
      },
      {
       "minutes": 30,
       "activity": "Play all three songs in sequence, allowing brief resets between them."
      },
      {
       "minutes": 10,
       "activity": "Record the performance and note one next step."
      }
     ],
     "deliverable": "A recording of all three songs played in sequence.",
     "doneWhen": "Finish all three songs in order and save the recording."
    }
   ],
   "weeks": [
    {
     "week": 1,
     "sessions": []
    },
    {
     "week": 2,
     "sessions": [
      "chord_foundations",
      "rhythm_and_changes"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "chord_foundations",
      "rhythm_and_changes"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "chord_foundations",
      "song_section"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "song_section",
      "rhythm_and_changes"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "song_section",
      "song_section"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "song_section",
      "song_runthrough"
     ]
    },
    {
     "week": 8,
     "sessions": [
      "song_section",
      "song_runthrough"
     ]
    },
    {
     "week": 9,
     "sessions": [
      "song_runthrough",
      "repertoire_review"
     ]
    },
    {
     "week": 10,
     "sessions": [
      "song_runthrough",
      "final_performance"
     ]
    },
    {
     "week": 11,
     "sessions": [
      "final_performance"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "e369eead-48be-4af5-848f-03ccbeb74881",
   "attempt": 1
  },
  "recordedWeeks": 11
 },
 {
  "id": "guitar",
  "language": "es",
  "text": "Aprender guitarra: acordes básicos y tres canciones completas para fin de año, martes y jueves en la noche.",
  "recordedOn": "2026-09-25",
  "reading": {
   "decision": "plan",
   "title": "Aprender acordes y canciones en guitarra",
   "summary": "Quiere aprender acordes básicos y tocar tres canciones completas para fin de año, practicando los martes y jueves por la noche.",
   "domain": "learning",
   "level": "unknown",
   "deadline": "2026-12-01",
   "deadline_basis": "inferred",
   "days": [
    1,
    3
   ],
   "window": "night",
   "weekly_minutes": null,
   "session_minutes": null,
   "question": null,
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "f418143c-4f45-4aeb-b705-a4ab05c45b93"
  },
  "draft": {
   "phases": [
    {
     "title": "Primeros acordes",
     "fromWeek": 1,
     "toWeek": 3,
     "focus": "Aprender acordes básicos y cambiar entre ellos con limpieza."
    },
    {
     "title": "Ritmo y primera canción",
     "fromWeek": 4,
     "toWeek": 6,
     "focus": "Practicar patrones de rasgueo y montar una canción completa."
    },
    {
     "title": "Ampliar repertorio",
     "fromWeek": 7,
     "toWeek": 9,
     "focus": "Aprender dos canciones más y mejorar las transiciones."
    },
    {
     "title": "Repaso y presentación",
     "fromWeek": 10,
     "toWeek": 11,
     "focus": "Repasar las tres canciones y tocarlas de principio a fin."
    }
   ],
   "sessionTypes": [
    {
     "id": "acordes",
     "title": "Acordes y cambios",
     "minutes": 30,
     "intensity": "easy",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Afinar y preparar la guitarra."
      },
      {
       "minutes": 10,
       "activity": "Practicar acordes básicos por separado."
      },
      {
       "minutes": 10,
       "activity": "Cambiar entre pares de acordes lentamente."
      },
      {
       "minutes": 5,
       "activity": "Repasar los cambios más difíciles."
      }
     ],
     "deliverable": "Lista de acordes practicados y cambios más fluidos.",
     "doneWhen": "Completa los bloques y cambia entre los acordes elegidos sin detenerse en tres intentos."
    },
    {
     "id": "ritmo",
     "title": "Ritmo y rasgueo",
     "minutes": 30,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Afinar y marcar un pulso constante."
      },
      {
       "minutes": 10,
       "activity": "Practicar un patrón de rasgueo con cuerdas apagadas."
      },
      {
       "minutes": 10,
       "activity": "Aplicar el patrón a dos acordes."
      },
      {
       "minutes": 5,
       "activity": "Tocar el patrón sin parar."
      }
     ],
     "deliverable": "Un patrón de rasgueo practicado con pulso estable.",
     "doneWhen": "Mantiene el patrón durante un minuto sin perder el pulso."
    },
    {
     "id": "cancion",
     "title": "Montaje de canción",
     "minutes": 45,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Afinar y revisar los acordes de la canción."
      },
      {
       "minutes": 10,
       "activity": "Practicar por separado los cambios difíciles."
      },
      {
       "minutes": 15,
       "activity": "Tocar secciones de la canción con el patrón elegido."
      },
      {
       "minutes": 10,
       "activity": "Unir las secciones y repetir los enlaces."
      },
      {
       "minutes": 5,
       "activity": "Anotar el siguiente paso de práctica."
      }
     ],
     "deliverable": "Una sección nueva o revisada de la canción tocada con acordes y ritmo.",
     "doneWhen": "Toca la sección elegida dos veces seguidas sin detenerse."
    },
    {
     "id": "repaso",
     "title": "Repaso de repertorio",
     "minutes": 45,
     "intensity": "easy",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Afinar y elegir el orden de las canciones."
      },
      {
       "minutes": 15,
       "activity": "Repasar la canción más reciente."
      },
      {
       "minutes": 15,
       "activity": "Repasar las canciones anteriores."
      },
      {
       "minutes": 10,
       "activity": "Tocar una canción completa y anotar los puntos pendientes."
      }
     ],
     "deliverable": "Registro de canciones repasadas y pasajes por mejorar.",
     "doneWhen": "Completa el repaso y toca una canción de principio a fin."
    }
   ],
   "weeks": [
    {
     "week": 1,
     "sessions": []
    },
    {
     "week": 2,
     "sessions": [
      "acordes",
      "ritmo"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "acordes",
      "ritmo"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "acordes",
      "cancion"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "acordes",
      "cancion"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "ritmo",
      "cancion"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "cancion",
      "repaso"
     ]
    },
    {
     "week": 8,
     "sessions": [
      "cancion",
      "repaso"
     ]
    },
    {
     "week": 9,
     "sessions": [
      "cancion",
      "repaso"
     ]
    },
    {
     "week": 10,
     "sessions": [
      "cancion",
      "repaso"
     ]
    },
    {
     "week": 11,
     "sessions": [
      "repaso"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "ae67ac0a-e259-4f8d-adbb-0182a4ff03f1",
   "attempt": 1
  },
  "recordedWeeks": 11
 },
 {
  "id": "interview",
  "language": "en",
  "text": "Prepare for a software engineering interview in six weeks: data structures and system design, weekday evenings, 5 hours a week.",
  "recordedOn": "2026-09-25",
  "reading": {
   "decision": "plan",
   "title": "Software Engineering Interview Prep",
   "summary": "Prepare for a software engineering interview by studying data structures and system design over six weeks, using weekday evenings and up to five hours per week.",
   "domain": "learning",
   "level": "unknown",
   "deadline": "2026-11-06",
   "deadline_basis": "inferred",
   "days": [
    0,
    1,
    2,
    3,
    4
   ],
   "window": "evening",
   "weekly_minutes": 300,
   "session_minutes": null,
   "question": null,
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "37cacdce-a915-48dc-af16-7ae097bd491c"
  },
  "draft": {
   "phases": [
    {
     "title": "Core foundations",
     "fromWeek": 1,
     "toWeek": 2,
     "focus": "Review essential data structures and establish a repeatable problem-solving approach."
    },
    {
     "title": "Algorithms and design basics",
     "fromWeek": 3,
     "toWeek": 4,
     "focus": "Practice common algorithm patterns and learn core system design trade-offs."
    },
    {
     "title": "Interview practice",
     "fromWeek": 5,
     "toWeek": 6,
     "focus": "Combine timed coding practice with structured system design exercises."
    },
    {
     "title": "Final review",
     "fromWeek": 7,
     "toWeek": 7,
     "focus": "Consolidate notes and complete a lighter final practice session."
    }
   ],
   "sessionTypes": [
    {
     "id": "coding_patterns",
     "title": "Coding patterns practice",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Review one algorithm pattern and its use cases."
      },
      {
       "minutes": 40,
       "activity": "Solve one or two problems using the pattern; explain the approach aloud."
      },
      {
       "minutes": 10,
       "activity": "Record complexity, mistakes, and a takeaway."
      }
     ],
     "deliverable": "Written solutions with complexity notes and one takeaway.",
     "doneWhen": "You can explain the approach and verify the solution with test cases."
    },
    {
     "id": "data_structures",
     "title": "Data structures review",
     "minutes": 45,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Recall operations and complexity for the week's structures."
      },
      {
       "minutes": 25,
       "activity": "Implement or trace representative operations."
      },
      {
       "minutes": 10,
       "activity": "Write a concise comparison and note open questions."
      }
     ],
     "deliverable": "A comparison sheet with operation costs and examples.",
     "doneWhen": "You can choose an appropriate structure and justify the choice."
    },
    {
     "id": "system_design",
     "title": "System design exercise",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Clarify requirements and define scope."
      },
      {
       "minutes": 15,
       "activity": "Estimate scale and sketch the main components."
      },
      {
       "minutes": 25,
       "activity": "Trace data flow and discuss storage, APIs, and trade-offs."
      },
      {
       "minutes": 10,
       "activity": "Summarize bottlenecks and possible improvements."
      }
     ],
     "deliverable": "A system diagram with requirements, trade-offs, and bottlenecks.",
     "doneWhen": "You can walk through the design and defend its main trade-offs."
    },
    {
     "id": "timed_mock",
     "title": "Timed coding mock",
     "minutes": 75,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Read the prompt and clarify assumptions."
      },
      {
       "minutes": 45,
       "activity": "Solve under interview conditions while narrating decisions."
      },
      {
       "minutes": 15,
       "activity": "Test edge cases and refine the solution."
      },
      {
       "minutes": 10,
       "activity": "Review performance and list specific improvements."
      }
     ],
     "deliverable": "A timed solution and a short review of strengths and gaps.",
     "doneWhen": "You finish with a tested solution and identify one concrete improvement."
    },
    {
     "id": "design_review",
     "title": "System design review",
     "minutes": 45,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Recall a design from notes without looking."
      },
      {
       "minutes": 25,
       "activity": "Recreate its diagram and explain key decisions."
      },
      {
       "minutes": 10,
       "activity": "Check gaps against notes and record one improvement."
      }
     ],
     "deliverable": "A recreated design sketch and a list of corrected gaps.",
     "doneWhen": "You can explain the design's components and trade-offs from memory."
    },
    {
     "id": "final_recap",
     "title": "Final interview recap",
     "minutes": 45,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Review the problem-solving checklist."
      },
      {
       "minutes": 20,
       "activity": "Explain one familiar coding solution and one design aloud."
      },
      {
       "minutes": 15,
       "activity": "Organize final notes and choose next practice priorities."
      }
     ],
     "deliverable": "A concise interview checklist and prioritized follow-up list.",
     "doneWhen": "Your checklist is ready and you can clearly explain both examples."
    }
   ],
   "weeks": [
    {
     "week": 1,
     "sessions": []
    },
    {
     "week": 2,
     "sessions": [
      "data_structures",
      "coding_patterns",
      "system_design",
      "coding_patterns",
      "design_review"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "data_structures",
      "coding_patterns",
      "system_design",
      "coding_patterns",
      "design_review"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "data_structures",
      "coding_patterns",
      "system_design",
      "timed_mock",
      "design_review"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "data_structures",
      "coding_patterns",
      "system_design",
      "timed_mock",
      "design_review"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "data_structures",
      "coding_patterns",
      "system_design",
      "timed_mock",
      "design_review"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "coding_patterns",
      "system_design",
      "final_recap"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "f72dc343-090d-450a-a41d-67625a1a99e8",
   "attempt": 1
  },
  "recordedWeeks": 7
 },
 {
  "id": "interview",
  "language": "es",
  "text": "Prepararme para una entrevista de ingeniería de software en seis semanas: estructuras de datos y diseño de sistemas, entre semana en la noche, 5 horas por semana.",
  "recordedOn": "2026-09-25",
  "reading": {
   "decision": "plan",
   "title": "Preparación para entrevista de ingeniería de software",
   "summary": "Quiere prepararse para una entrevista de ingeniería de software practicando estructuras de datos y diseño de sistemas, entre semana por la noche, con un máximo de 5 horas semanales.",
   "domain": "learning",
   "level": "unknown",
   "deadline": "2026-11-06",
   "deadline_basis": "inferred",
   "days": [
    0,
    1,
    2,
    3,
    4
   ],
   "window": "evening",
   "weekly_minutes": 300,
   "session_minutes": null,
   "question": null,
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "dd02d919-b8b5-474a-ae05-862bb69db839"
  },
  "draft": {
   "phases": [
    {
     "title": "Fundamentos",
     "fromWeek": 1,
     "toWeek": 2,
     "focus": "Repasar estructuras de datos y practicar explicaciones claras."
    },
    {
     "title": "Práctica aplicada",
     "fromWeek": 3,
     "toWeek": 4,
     "focus": "Resolver problemas variados y estructurar diseños de sistemas."
    },
    {
     "title": "Simulación y repaso",
     "fromWeek": 5,
     "toWeek": 7,
     "focus": "Practicar entrevistas completas, revisar errores y reducir carga al final."
    }
   ],
   "sessionTypes": [
    {
     "id": "repaso_estructuras",
     "title": "Repaso de estructuras de datos",
     "minutes": 45,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Repasar conceptos y operaciones clave."
      },
      {
       "minutes": 25,
       "activity": "Resolver ejercicios breves de una estructura."
      },
      {
       "minutes": 10,
       "activity": "Anotar errores y aprendizajes."
      }
     ],
     "deliverable": "Notas breves con conceptos y errores frecuentes.",
     "doneWhen": "Has explicado una estructura y resuelto dos ejercicios."
    },
    {
     "id": "problemas_algoritmicos",
     "title": "Problemas de algoritmos",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Elegir un problema y aclarar sus requisitos."
      },
      {
       "minutes": 35,
       "activity": "Diseñar, implementar y probar una solución."
      },
      {
       "minutes": 15,
       "activity": "Analizar complejidad y revisar alternativas."
      }
     ],
     "deliverable": "Solución probada con análisis de complejidad.",
     "doneWhen": "La solución pasa casos de prueba y puedes explicar sus decisiones."
    },
    {
     "id": "diseno_sistemas",
     "title": "Diseño de sistemas",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Definir requisitos funcionales y restricciones."
      },
      {
       "minutes": 30,
       "activity": "Dibujar componentes, datos y flujos principales."
      },
      {
       "minutes": 20,
       "activity": "Revisar escalabilidad, fallos y compromisos."
      }
     ],
     "deliverable": "Diagrama con requisitos y decisiones principales.",
     "doneWhen": "Puedes presentar el diseño y justificar dos compromisos."
    },
    {
     "id": "simulacion_tecnica",
     "title": "Simulación de entrevista técnica",
     "minutes": 75,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Leer el enunciado y aclarar requisitos."
      },
      {
       "minutes": 45,
       "activity": "Resolver un problema en voz alta y probarlo."
      },
      {
       "minutes": 15,
       "activity": "Explicar complejidad y alternativas."
      },
      {
       "minutes": 10,
       "activity": "Registrar observaciones y próximos pasos."
      }
     ],
     "deliverable": "Grabación o notas de la simulación y una lista de mejoras.",
     "doneWhen": "Has completado la resolución y anotado dos mejoras concretas."
    },
    {
     "id": "repaso_errores",
     "title": "Repaso de errores",
     "minutes": 30,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Revisar errores de sesiones anteriores."
      },
      {
       "minutes": 15,
       "activity": "Rehacer un ejercicio sin consultar la solución."
      },
      {
       "minutes": 5,
       "activity": "Anotar una regla para evitar repetir el error."
      }
     ],
     "deliverable": "Una corrección explicada y una regla de repaso.",
     "doneWhen": "Resuelves de nuevo el ejercicio y explicas qué cambió."
    }
   ],
   "weeks": [
    {
     "week": 1,
     "sessions": []
    },
    {
     "week": 2,
     "sessions": [
      "repaso_estructuras",
      "problemas_algoritmicos",
      "diseno_sistemas",
      "repaso_errores"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "repaso_estructuras",
      "problemas_algoritmicos",
      "diseno_sistemas",
      "repaso_errores"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "repaso_estructuras",
      "problemas_algoritmicos",
      "diseno_sistemas",
      "simulacion_tecnica"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "repaso_estructuras",
      "problemas_algoritmicos",
      "diseno_sistemas",
      "simulacion_tecnica"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "repaso_estructuras",
      "problemas_algoritmicos",
      "diseno_sistemas",
      "simulacion_tecnica"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "repaso_estructuras",
      "problemas_algoritmicos",
      "diseno_sistemas"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "b6738b79-80c4-4659-9eda-35a3ca7af41a",
   "attempt": 1
  },
  "recordedWeeks": 7
 },
 {
  "id": "vague",
  "language": "en",
  "text": "I want to get better.",
  "recordedOn": "2026-09-25",
  "reading": {
   "decision": "clarify",
   "title": "Get Better",
   "summary": "You want to get better, but haven’t said what you want to improve.",
   "domain": "general",
   "level": "unknown",
   "deadline": null,
   "deadline_basis": "none",
   "days": null,
   "window": null,
   "weekly_minutes": null,
   "session_minutes": null,
   "question": "What would you like to get better at?",
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "dba80328-2f3f-480c-b206-5ee7326a3ba0"
  }
 },
 {
  "id": "vague",
  "language": "es",
  "text": "Quiero mejorar.",
  "recordedOn": "2026-09-25",
  "reading": {
   "decision": "clarify",
   "title": "Mejorar",
   "summary": "Quieres mejorar, pero no especificaste qué habilidad o aspecto quieres desarrollar.",
   "domain": "general",
   "level": "unknown",
   "deadline": null,
   "deadline_basis": "none",
   "days": null,
   "window": null,
   "weekly_minutes": null,
   "session_minutes": null,
   "question": "¿Qué habilidad o aspecto quieres mejorar?",
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "2bc8f9f9-18a9-42f6-93bb-69222f2851a4"
  }
 },
 {
  "id": "marathon",
  "language": "en",
  "text": "Run a full marathon in two weeks. I have never run before.",
  "recordedOn": "2026-09-25",
  "reading": {
   "decision": "abstain",
   "title": "Run a Full Marathon",
   "summary": "You want to run a full marathon in two weeks and have never run before.",
   "domain": "fitness",
   "level": "unknown",
   "deadline": "2026-10-09",
   "deadline_basis": "inferred",
   "days": null,
   "window": null,
   "weekly_minutes": null,
   "session_minutes": null,
   "question": null,
   "abstain": {
    "category": "extreme_timeline",
    "reason": "Attempting a full marathon in two weeks with no running experience could cause serious harm."
   }
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "2b8e92bd-41ba-4659-9acc-57f25bcd5315"
  }
 },
 {
  "id": "marathon",
  "language": "es",
  "text": "Correr un maratón completo en dos semanas. Nunca he corrido.",
  "recordedOn": "2026-09-25",
  "reading": {
   "decision": "abstain",
   "title": "Prepararse para un maratón",
   "summary": "Quiere correr un maratón completo en dos semanas y nunca ha corrido.",
   "domain": "fitness",
   "level": "beginner",
   "deadline": "2026-10-09",
   "deadline_basis": "inferred",
   "days": null,
   "window": null,
   "weekly_minutes": null,
   "session_minutes": null,
   "question": null,
   "abstain": {
    "category": "extreme_timeline",
    "reason": "Preparar un maratón en dos semanas sin experiencia previa podría causar daño."
   }
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "gpt-6-luna",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "784cd2ed-5223-4829-8825-ada92e1b986f"
  }
 }
];
