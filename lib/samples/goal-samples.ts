// Demo samples: real outputs recorded from the model through the Cadencia
// service on 2026-09-24, for fixed example texts written by the developer.
// They drive the model-free demo only; they are not evaluation data.

export const GOAL_SAMPLES: ReadonlyArray<Record<string, unknown>> = [
 {
  "id": "ten_k",
  "language": "en",
  "text": "Run a 10K by December. Weekday mornings only, 3 hours a week at most.",
  "recordedOn": "2026-09-24",
  "reading": {
   "decision": "plan",
   "title": "Run a 10K by December",
   "summary": "They want to run a 10K by December, training on weekday mornings with at most 3 hours a week.",
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
   "model": "deepseek-flash",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "f84175b8-c20a-485c-9f66-1cf179c51ffd"
  },
  "draft": {
   "phases": [
    {
     "title": "Base Building",
     "fromWeek": 1,
     "toWeek": 4,
     "focus": "Establish a consistent running routine and build easy aerobic volume."
    },
    {
     "title": "Volume Build",
     "fromWeek": 5,
     "toWeek": 8,
     "focus": "Gradually increase weekly running time and introduce longer efforts."
    },
    {
     "title": "Peak & Taper",
     "fromWeek": 9,
     "toWeek": 11,
     "focus": "Reach peak volume, then taper to arrive fresh for the 10K."
    }
   ],
   "sessionTypes": [
    {
     "id": "easy_run_30",
     "title": "Easy Run 30",
     "minutes": 30,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm-up walk"
      },
      {
       "minutes": 20,
       "activity": "Easy run at conversational pace"
      },
      {
       "minutes": 5,
       "activity": "Cool-down walk"
      }
     ],
     "deliverable": "A completed 30-minute easy run.",
     "doneWhen": "You finish the run and can speak in full sentences throughout."
    },
    {
     "id": "easy_run_40",
     "title": "Easy Run 40",
     "minutes": 40,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm-up walk"
      },
      {
       "minutes": 30,
       "activity": "Easy run at conversational pace"
      },
      {
       "minutes": 5,
       "activity": "Cool-down walk"
      }
     ],
     "deliverable": "A completed 40-minute easy run.",
     "doneWhen": "You finish the run and can speak in full sentences throughout."
    },
    {
     "id": "easy_run_50",
     "title": "Easy Run 50",
     "minutes": 50,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm-up walk"
      },
      {
       "minutes": 40,
       "activity": "Easy run at conversational pace"
      },
      {
       "minutes": 5,
       "activity": "Cool-down walk"
      }
     ],
     "deliverable": "A completed 50-minute easy run.",
     "doneWhen": "You finish the run and can speak in full sentences throughout."
    },
    {
     "id": "long_run_60",
     "title": "Long Run 60",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm-up walk"
      },
      {
       "minutes": 50,
       "activity": "Steady run at comfortable pace"
      },
      {
       "minutes": 5,
       "activity": "Cool-down walk"
      }
     ],
     "deliverable": "A completed 60-minute long run.",
     "doneWhen": "You finish the run at a steady, sustainable effort."
    },
    {
     "id": "long_run_70",
     "title": "Long Run 70",
     "minutes": 70,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm-up walk"
      },
      {
       "minutes": 60,
       "activity": "Steady run at comfortable pace"
      },
      {
       "minutes": 5,
       "activity": "Cool-down walk"
      }
     ],
     "deliverable": "A completed 70-minute long run.",
     "doneWhen": "You finish the run at a steady, sustainable effort."
    },
    {
     "id": "long_run_80",
     "title": "Long Run 80",
     "minutes": 80,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm-up walk"
      },
      {
       "minutes": 70,
       "activity": "Steady run at comfortable pace"
      },
      {
       "minutes": 5,
       "activity": "Cool-down walk"
      }
     ],
     "deliverable": "A completed 80-minute long run.",
     "doneWhen": "You finish the run at a steady, sustainable effort."
    },
    {
     "id": "tempo_run_40",
     "title": "Tempo Run 40",
     "minutes": 40,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm-up walk"
      },
      {
       "minutes": 10,
       "activity": "Easy jog"
      },
      {
       "minutes": 20,
       "activity": "Tempo run at comfortably hard pace"
      },
      {
       "minutes": 5,
       "activity": "Cool-down walk"
      }
     ],
     "deliverable": "A completed 40-minute tempo run.",
     "doneWhen": "You hold a comfortably hard pace for the 20-minute tempo block."
    },
    {
     "id": "interval_run_40",
     "title": "Interval Run 40",
     "minutes": 40,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm-up walk"
      },
      {
       "minutes": 10,
       "activity": "Easy jog"
      },
      {
       "minutes": 20,
       "activity": "6 x 2 min hard with 1 min easy recovery"
      },
      {
       "minutes": 5,
       "activity": "Cool-down walk"
      }
     ],
     "deliverable": "A completed interval session.",
     "doneWhen": "You complete all 6 hard intervals with recovery jogs."
    }
   ],
   "weeks": [
    {
     "week": 1,
     "sessions": [
      "easy_run_30"
     ]
    },
    {
     "week": 2,
     "sessions": [
      "easy_run_30",
      "easy_run_30",
      "long_run_60"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "easy_run_30",
      "easy_run_30",
      "long_run_60"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "easy_run_30",
      "easy_run_30",
      "long_run_60"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "easy_run_30",
      "easy_run_40",
      "long_run_60"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "easy_run_30",
      "easy_run_40",
      "long_run_70"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "easy_run_30",
      "easy_run_40",
      "long_run_70"
     ]
    },
    {
     "week": 8,
     "sessions": [
      "easy_run_30",
      "easy_run_40",
      "long_run_80"
     ]
    },
    {
     "week": 9,
     "sessions": [
      "easy_run_30",
      "tempo_run_40",
      "long_run_80"
     ]
    },
    {
     "week": 10,
     "sessions": [
      "easy_run_30",
      "interval_run_40",
      "long_run_80"
     ]
    },
    {
     "week": 11,
     "sessions": [
      "easy_run_30",
      "easy_run_30"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "deepseek-flash",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "c224f5e8-6dd1-4ad6-93dc-6c6bc9050293",
   "attempt": 1
  },
  "recordedWeeks": 11
 },
 {
  "id": "ten_k",
  "language": "es",
  "text": "Correr 10 km para diciembre. Solo entre semana en la mañana, máximo 3 horas por semana.",
  "recordedOn": "2026-09-24",
  "reading": {
   "decision": "plan",
   "title": "Correr 10 km para diciembre",
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
   "model": "deepseek-flash",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "c5f9984e-a5d7-4d55-9e92-34a5b223fdae"
  },
  "draft": {
   "phases": [
    {
     "title": "Base aeróbica",
     "fromWeek": 1,
     "toWeek": 4,
     "focus": "Construir el hábito y una base cómoda de carrera continua."
    },
    {
     "title": "Desarrollo de resistencia",
     "fromWeek": 5,
     "toWeek": 8,
     "focus": "Aumentar gradualmente el volumen y la duración de la tirada larga."
    },
    {
     "title": "Consolidación y afinado",
     "fromWeek": 9,
     "toWeek": 11,
     "focus": "Consolidar la distancia de 10 km y llegar descansado."
    }
   ],
   "sessionTypes": [
    {
     "id": "rodaje_suave",
     "title": "Rodaje suave",
     "minutes": 30,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Caminar rápido para entrar en calor"
      },
      {
       "minutes": 20,
       "activity": "Trote continuo a ritmo cómodo"
      },
      {
       "minutes": 5,
       "activity": "Caminar y estirar suavemente"
      }
     ],
     "deliverable": "Registro de 30 minutos de actividad con sensación de esfuerzo bajo.",
     "doneWhen": "Completas los 20 minutos de trote sin parar y terminas sin fatiga."
    },
    {
     "id": "rodaje_medio",
     "title": "Rodaje medio",
     "minutes": 45,
     "intensity": "moderate",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Calentamiento caminando"
      },
      {
       "minutes": 35,
       "activity": "Trote continuo a ritmo conversacional"
      },
      {
       "minutes": 5,
       "activity": "Vuelta a la calma caminando"
      }
     ],
     "deliverable": "Registro de 45 minutos con ritmo constante.",
     "doneWhen": "Mantienes el trote los 35 minutos centrales sin caminar."
    },
    {
     "id": "tirada_larga",
     "title": "Tirada larga",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Calentamiento caminando"
      },
      {
       "minutes": 50,
       "activity": "Carrera continua a ritmo suave"
      },
      {
       "minutes": 5,
       "activity": "Caminar y estirar"
      }
     ],
     "deliverable": "Distancia y tiempo de la tirada larga anotados.",
     "doneWhen": "Completas 50 minutos de carrera continua sin parar."
    },
    {
     "id": "tirada_larga_progresiva",
     "title": "Tirada larga progresiva",
     "minutes": 75,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Calentamiento caminando"
      },
      {
       "minutes": 30,
       "activity": "Carrera suave"
      },
      {
       "minutes": 35,
       "activity": "Carrera a ritmo algo más vivo"
      },
      {
       "minutes": 5,
       "activity": "Caminar y estirar"
      }
     ],
     "deliverable": "Registro de 75 minutos con la parte final más rápida.",
     "doneWhen": "Terminas los 35 minutos finales a ritmo vivo sin parar."
    },
    {
     "id": "simulacion_10k",
     "title": "Simulación 10 km",
     "minutes": 90,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Calentamiento caminando y movilidad"
      },
      {
       "minutes": 70,
       "activity": "Carrera continua intentando cubrir 10 km"
      },
      {
       "minutes": 10,
       "activity": "Caminar y estirar"
      }
     ],
     "deliverable": "Tiempo y distancia de la simulación de 10 km.",
     "doneWhen": "Cubres 10 km corriendo o trotando sin parar."
    },
    {
     "id": "activacion_suave",
     "title": "Activación suave",
     "minutes": 20,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Caminar"
      },
      {
       "minutes": 10,
       "activity": "Trote muy suave"
      },
      {
       "minutes": 5,
       "activity": "Estiramientos suaves"
      }
     ],
     "deliverable": "Registro de 20 minutos de activación.",
     "doneWhen": "Completas el trote suave sin molestias."
    }
   ],
   "weeks": [
    {
     "week": 1,
     "sessions": [
      "rodaje_suave"
     ]
    },
    {
     "week": 2,
     "sessions": [
      "rodaje_suave",
      "rodaje_medio"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "rodaje_suave",
      "rodaje_medio"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "rodaje_suave",
      "rodaje_medio",
      "tirada_larga"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "rodaje_suave",
      "rodaje_medio",
      "tirada_larga"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "rodaje_suave",
      "rodaje_medio",
      "tirada_larga"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "rodaje_suave",
      "rodaje_medio",
      "tirada_larga_progresiva"
     ]
    },
    {
     "week": 8,
     "sessions": [
      "rodaje_suave",
      "rodaje_medio",
      "tirada_larga_progresiva"
     ]
    },
    {
     "week": 9,
     "sessions": [
      "rodaje_suave",
      "rodaje_medio",
      "tirada_larga_progresiva"
     ]
    },
    {
     "week": 10,
     "sessions": [
      "rodaje_suave",
      "simulacion_10k"
     ]
    },
    {
     "week": 11,
     "sessions": [
      "activacion_suave"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "deepseek-flash",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "c15b7995-4b69-4f57-86cb-484046ddd2c3",
   "attempt": 1
  },
  "recordedWeeks": 11
 },
 {
  "id": "guitar",
  "language": "en",
  "text": "Learn guitar: basic chords and three full songs by the end of the year, Tuesday and Thursday evenings.",
  "recordedOn": "2026-09-24",
  "reading": {
   "decision": "plan",
   "title": "Learn guitar: basic chords and three songs",
   "summary": "Learn basic guitar chords and three full songs by the end of the year, practising Tuesday and Thursday evenings.",
   "domain": "creative",
   "level": "beginner",
   "deadline": "2026-12-31",
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
   "model": "deepseek-flash",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "74ee6fa2-220c-4e90-b8c7-aea86e8b15ce"
  },
  "draft": {
   "phases": [
    {
     "title": "Foundation",
     "fromWeek": 1,
     "toWeek": 4,
     "focus": "Learn open chords and clean changes"
    },
    {
     "title": "Song Building",
     "fromWeek": 5,
     "toWeek": 9,
     "focus": "Apply chords to song sections and simple strums"
    },
    {
     "title": "Song Performance",
     "fromWeek": 10,
     "toWeek": 14,
     "focus": "Play three songs from start to finish"
    },
    {
     "title": "Polish and Review",
     "fromWeek": 15,
     "toWeek": 15,
     "focus": "Record and review final performances"
    }
   ],
   "sessionTypes": [
    {
     "id": "chord_foundations",
     "title": "Chord Foundations",
     "minutes": 30,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm up with finger stretches and slow chord shapes"
      },
      {
       "minutes": 15,
       "activity": "Practice two open chords with clean fretting"
      },
      {
       "minutes": 10,
       "activity": "Change between the two chords slowly"
      }
     ],
     "deliverable": "A list of chords practiced and one clean change",
     "doneWhen": "You can play each chord and switch once without buzzing"
    },
    {
     "id": "chord_changes",
     "title": "Chord Changes",
     "minutes": 30,
     "intensity": "moderate",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm up with finger stretches"
      },
      {
       "minutes": 15,
       "activity": "Practice changing between three chords in time"
      },
      {
       "minutes": 10,
       "activity": "Play a simple downstrum pattern over the changes"
      }
     ],
     "deliverable": "A count of clean chord changes in one minute",
     "doneWhen": "You can change chords 10 times in a minute without stopping"
    },
    {
     "id": "song_section",
     "title": "Song Section",
     "minutes": 30,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm up with chord changes"
      },
      {
       "minutes": 15,
       "activity": "Learn and loop one section of a chosen song"
      },
      {
       "minutes": 10,
       "activity": "Play the section with a steady strum"
      }
     ],
     "deliverable": "A recording or note of the section played",
     "doneWhen": "You can play the section twice in a row without mistakes"
    },
    {
     "id": "full_song_run",
     "title": "Full Song Run",
     "minutes": 45,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm up with chord changes"
      },
      {
       "minutes": 30,
       "activity": "Play one full song from start to finish"
      },
      {
       "minutes": 10,
       "activity": "Repeat tricky transitions slowly"
      }
     ],
     "deliverable": "A full run-through of one song",
     "doneWhen": "You complete the song without stopping"
    },
    {
     "id": "three_song_set",
     "title": "Three-Song Set",
     "minutes": 60,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm up with chord changes"
      },
      {
       "minutes": 45,
       "activity": "Play all three songs back to back"
      },
      {
       "minutes": 10,
       "activity": "Review and repeat the weakest transition"
      }
     ],
     "deliverable": "A recording of the three-song set",
     "doneWhen": "You play all three songs in one sitting without long pauses"
    },
    {
     "id": "review_record",
     "title": "Review and Record",
     "minutes": 30,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Warm up with finger stretches"
      },
      {
       "minutes": 15,
       "activity": "Record one song or section"
      },
      {
       "minutes": 10,
       "activity": "Listen back and note one improvement"
      }
     ],
     "deliverable": "A recording and one written note",
     "doneWhen": "You have a recording and one clear next step"
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
      "chord_foundations"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "chord_foundations",
      "chord_changes"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "chord_foundations",
      "chord_changes"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "chord_changes",
      "song_section"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "chord_changes",
      "song_section"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "chord_changes",
      "song_section"
     ]
    },
    {
     "week": 8,
     "sessions": [
      "chord_changes",
      "song_section"
     ]
    },
    {
     "week": 9,
     "sessions": [
      "chord_changes",
      "song_section"
     ]
    },
    {
     "week": 10,
     "sessions": [
      "song_section",
      "full_song_run"
     ]
    },
    {
     "week": 11,
     "sessions": [
      "song_section",
      "full_song_run"
     ]
    },
    {
     "week": 12,
     "sessions": [
      "song_section",
      "full_song_run"
     ]
    },
    {
     "week": 13,
     "sessions": [
      "song_section",
      "full_song_run"
     ]
    },
    {
     "week": 14,
     "sessions": [
      "full_song_run",
      "three_song_set"
     ]
    },
    {
     "week": 15,
     "sessions": [
      "review_record"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "deepseek-flash",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "03e79b4a-46e9-450e-8e88-194d32bc0719",
   "attempt": 1
  },
  "recordedWeeks": 15
 },
 {
  "id": "guitar",
  "language": "es",
  "text": "Aprender guitarra: acordes básicos y tres canciones completas para fin de año, martes y jueves en la noche.",
  "recordedOn": "2026-09-24",
  "reading": {
   "decision": "plan",
   "title": "Aprender guitarra: acordes básicos y tres canciones",
   "summary": "Quiere aprender guitarra, con acordes básicos y tres canciones completas para fin de año, practicando martes y jueves por la noche.",
   "domain": "creative",
   "level": "beginner",
   "deadline": "2026-12-31",
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
   "model": "deepseek-flash",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "cabcc363-87d8-4883-b6fd-4b69eb1331a3"
  },
  "draft": {
   "phases": [
    {
     "title": "Fundamentos y primeros acordes",
     "fromWeek": 1,
     "toWeek": 5,
     "focus": "Postura, afinación, ritmo básico y acordes abiertos esenciales."
    },
    {
     "title": "Cambios de acorde y ritmos",
     "fromWeek": 6,
     "toWeek": 10,
     "focus": "Transiciones fluidas, rasgueos y primeras canciones sencillas."
    },
    {
     "title": "Canciones completas y expresión",
     "fromWeek": 11,
     "toWeek": 15,
     "focus": "Tocar tres canciones completas con dinámica y seguridad."
    }
   ],
   "sessionTypes": [
    {
     "id": "tecnica_base",
     "title": "Técnica base",
     "minutes": 30,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Calentamiento de dedos y muñeca"
      },
      {
       "minutes": 10,
       "activity": "Ejercicios de pulsación y coordinación"
      },
      {
       "minutes": 10,
       "activity": "Cambios lentos entre dos acordes"
      },
      {
       "minutes": 5,
       "activity": "Estiramiento y relajación"
      }
     ],
     "deliverable": "Registro de ejercicios y acordes practicados",
     "doneWhen": "Completar los bloques sin dolor y con ritmo constante"
    },
    {
     "id": "acordes_ritmo",
     "title": "Acordes y ritmo",
     "minutes": 45,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Afinar y calentar"
      },
      {
       "minutes": 15,
       "activity": "Practicar acordes nuevos con metrónomo"
      },
      {
       "minutes": 15,
       "activity": "Cambios de acorde en progresión"
      },
      {
       "minutes": 10,
       "activity": "Rasgueo básico sobre progresión"
      }
     ],
     "deliverable": "Grabación corta de la progresión con rasgueo",
     "doneWhen": "Cambios limpios a tempo lento sin pausas largas"
    },
    {
     "id": "cancion_guiada",
     "title": "Canción guiada",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Afinar y calentar"
      },
      {
       "minutes": 10,
       "activity": "Repasar acordes de la canción"
      },
      {
       "minutes": 20,
       "activity": "Trabajar secciones difíciles"
      },
      {
       "minutes": 20,
       "activity": "Tocar la canción completa a tempo lento"
      },
      {
       "minutes": 5,
       "activity": "Anotar mejoras y dificultades"
      }
     ],
     "deliverable": "Grabación de la canción completa",
     "doneWhen": "Tocar de principio a fin sin detenerse"
    },
    {
     "id": "ensayo_cancion",
     "title": "Ensayo de canción",
     "minutes": 45,
     "intensity": "moderate",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Calentamiento y afinación"
      },
      {
       "minutes": 15,
       "activity": "Repasar transiciones y ritmo"
      },
      {
       "minutes": 20,
       "activity": "Tocar canción completa con metrónomo"
      },
      {
       "minutes": 5,
       "activity": "Autoevaluación breve"
      }
     ],
     "deliverable": "Notas de ensayo con tiempos y fallos",
     "doneWhen": "Canción tocada completa a tempo objetivo"
    },
    {
     "id": "repaso_semanal",
     "title": "Repaso semanal",
     "minutes": 30,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Calentamiento suave"
      },
      {
       "minutes": 10,
       "activity": "Repasar acordes y cambios"
      },
      {
       "minutes": 10,
       "activity": "Tocar canción en progreso"
      },
      {
       "minutes": 5,
       "activity": "Planificar siguiente práctica"
      }
     ],
     "deliverable": "Lista de logros y objetivos para la próxima semana",
     "doneWhen": "Repaso completado y objetivos anotados"
    },
    {
     "id": "grabacion_final",
     "title": "Grabación final",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 5,
       "activity": "Afinar y calentar"
      },
      {
       "minutes": 10,
       "activity": "Repaso rápido de acordes"
      },
      {
       "minutes": 30,
       "activity": "Grabar las tres canciones completas"
      },
      {
       "minutes": 10,
       "activity": "Escuchar y anotar mejoras"
      },
      {
       "minutes": 5,
       "activity": "Cierre y celebración"
      }
     ],
     "deliverable": "Grabación de las tres canciones completas",
     "doneWhen": "Las tres canciones grabadas de principio a fin"
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
      "tecnica_base",
      "acordes_ritmo"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "tecnica_base",
      "acordes_ritmo"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "tecnica_base",
      "acordes_ritmo"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "tecnica_base",
      "acordes_ritmo"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "acordes_ritmo",
      "cancion_guiada"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "acordes_ritmo",
      "cancion_guiada"
     ]
    },
    {
     "week": 8,
     "sessions": [
      "acordes_ritmo",
      "cancion_guiada"
     ]
    },
    {
     "week": 9,
     "sessions": [
      "acordes_ritmo",
      "cancion_guiada"
     ]
    },
    {
     "week": 10,
     "sessions": [
      "acordes_ritmo",
      "cancion_guiada"
     ]
    },
    {
     "week": 11,
     "sessions": [
      "cancion_guiada",
      "ensayo_cancion"
     ]
    },
    {
     "week": 12,
     "sessions": [
      "cancion_guiada",
      "ensayo_cancion"
     ]
    },
    {
     "week": 13,
     "sessions": [
      "cancion_guiada",
      "ensayo_cancion"
     ]
    },
    {
     "week": 14,
     "sessions": [
      "cancion_guiada",
      "ensayo_cancion"
     ]
    },
    {
     "week": 15,
     "sessions": [
      "grabacion_final",
      "repaso_semanal"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "deepseek-flash",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "eb751c65-e920-49d3-a205-7512dc14b007",
   "attempt": 1
  },
  "recordedWeeks": 15
 },
 {
  "id": "interview",
  "language": "en",
  "text": "Prepare for a software engineering interview in six weeks: data structures and system design, weekday evenings, 5 hours a week.",
  "recordedOn": "2026-09-24",
  "reading": {
   "decision": "plan",
   "title": "Software engineering interview prep",
   "summary": "Prepare for a software engineering interview in six weeks, covering data structures and system design, on weekday evenings for 5 hours a week.",
   "domain": "learning",
   "level": "unknown",
   "deadline": "2026-11-05",
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
   "model": "deepseek-flash",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "f5a732a9-bb91-423c-90a7-83d466e2bd10"
  },
  "draft": {
   "phases": [
    {
     "title": "Foundations",
     "fromWeek": 1,
     "toWeek": 2,
     "focus": "Core data structures and problem patterns"
    },
    {
     "title": "Applied Practice",
     "fromWeek": 3,
     "toWeek": 4,
     "focus": "Timed problems and system design basics"
    },
    {
     "title": "Integration",
     "fromWeek": 5,
     "toWeek": 6,
     "focus": "Full mock interviews and design depth"
    },
    {
     "title": "Taper",
     "fromWeek": 7,
     "toWeek": 7,
     "focus": "Light review and rest before interview"
    }
   ],
   "sessionTypes": [
    {
     "id": "dsa_learn",
     "title": "DSA Concept Study",
     "minutes": 60,
     "intensity": "moderate",
     "role": "support",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Review notes on one data structure"
      },
      {
       "minutes": 30,
       "activity": "Study pattern examples and edge cases"
      },
      {
       "minutes": 20,
       "activity": "Write summary and key operations"
      }
     ],
     "deliverable": "One-page summary of the data structure and its operations",
     "doneWhen": "Summary written and two example problems understood"
    },
    {
     "id": "dsa_practice",
     "title": "DSA Problem Practice",
     "minutes": 90,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Warm-up with one easy problem"
      },
      {
       "minutes": 60,
       "activity": "Solve two medium problems under time"
      },
      {
       "minutes": 20,
       "activity": "Review solutions and note mistakes"
      }
     ],
     "deliverable": "Two solved problems with written complexity analysis",
     "doneWhen": "Both problems pass sample tests and review notes are complete"
    },
    {
     "id": "sys_design_learn",
     "title": "System Design Study",
     "minutes": 60,
     "intensity": "moderate",
     "role": "support",
     "blocks": [
      {
       "minutes": 15,
       "activity": "Read one system design concept"
      },
      {
       "minutes": 30,
       "activity": "Sketch architecture for a known system"
      },
      {
       "minutes": 15,
       "activity": "List trade-offs and bottlenecks"
      }
     ],
     "deliverable": "Architecture sketch with trade-off notes",
     "doneWhen": "Sketch includes components, data flow, and two trade-offs"
    },
    {
     "id": "sys_design_practice",
     "title": "System Design Practice",
     "minutes": 90,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Pick a design prompt and clarify requirements"
      },
      {
       "minutes": 60,
       "activity": "Design the system end-to-end"
      },
      {
       "minutes": 20,
       "activity": "Review against a reference and note gaps"
      }
     ],
     "deliverable": "Full design document with requirements, components, and scaling notes",
     "doneWhen": "Design covers requirements, API, data model, and scaling"
    },
    {
     "id": "mock_interview",
     "title": "Mock Interview",
     "minutes": 90,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Set up and review interview format"
      },
      {
       "minutes": 60,
       "activity": "Complete one coding and one design question"
      },
      {
       "minutes": 20,
       "activity": "Self-assess and write improvement notes"
      }
     ],
     "deliverable": "Recorded or written mock interview with feedback notes",
     "doneWhen": "Both questions attempted and feedback notes written"
    },
    {
     "id": "review_light",
     "title": "Light Review",
     "minutes": 30,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Review flashcards or notes"
      },
      {
       "minutes": 20,
       "activity": "Re-solve one previously missed problem"
      }
     ],
     "deliverable": "List of reviewed topics and one corrected solution",
     "doneWhen": "Review list complete and problem re-solved correctly"
    }
   ],
   "weeks": [
    {
     "week": 1,
     "sessions": [
      "dsa_learn"
     ]
    },
    {
     "week": 2,
     "sessions": [
      "dsa_learn",
      "dsa_practice",
      "sys_design_learn"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "dsa_practice",
      "sys_design_learn",
      "review_light"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "dsa_practice",
      "sys_design_practice",
      "review_light"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "dsa_practice",
      "sys_design_practice",
      "mock_interview"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "dsa_practice",
      "sys_design_practice",
      "mock_interview"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "review_light",
      "mock_interview"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "deepseek-flash",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "119967d2-e598-49cc-9de3-74f43ee0d646",
   "attempt": 1
  },
  "recordedWeeks": 7
 },
 {
  "id": "interview",
  "language": "es",
  "text": "Prepararme para una entrevista de ingeniería de software en seis semanas: estructuras de datos y diseño de sistemas, entre semana en la noche, 5 horas por semana.",
  "recordedOn": "2026-09-24",
  "reading": {
   "decision": "plan",
   "title": "Preparación para entrevista de ingeniería de software",
   "summary": "Quiere prepararse para una entrevista de ingeniería de software en seis semanas, estudiando estructuras de datos y diseño de sistemas, entre semana por la noche, con 5 horas por semana.",
   "domain": "learning",
   "level": "unknown",
   "deadline": "2026-11-05",
   "deadline_basis": "inferred",
   "days": [
    0,
    1,
    2,
    3,
    4
   ],
   "window": "night",
   "weekly_minutes": 300,
   "session_minutes": null,
   "question": null,
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "deepseek-flash",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "236367f8-1ea5-4ce9-8d61-5ca1d571d4ac"
  },
  "draft": {
   "phases": [
    {
     "title": "Fundamentos de estructuras de datos",
     "fromWeek": 1,
     "toWeek": 2,
     "focus": "Repaso de arrays, strings, hash maps y complejidad básica"
    },
    {
     "title": "Patrones de resolución",
     "fromWeek": 3,
     "toWeek": 4,
     "focus": "Dos punteros, ventanas, recursión y árboles"
    },
    {
     "title": "Diseño de sistemas y simulacros",
     "fromWeek": 5,
     "toWeek": 6,
     "focus": "Diseño de sistemas y entrevistas simuladas completas"
    },
    {
     "title": "Repaso final y descanso",
     "fromWeek": 7,
     "toWeek": 7,
     "focus": "Repaso ligero y descanso antes de la entrevista"
    }
   ],
   "sessionTypes": [
    {
     "id": "repaso_conceptos",
     "title": "Repaso de conceptos",
     "minutes": 45,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Leer apuntes de estructuras de datos"
      },
      {
       "minutes": 25,
       "activity": "Resolver 2 problemas fáciles"
      },
      {
       "minutes": 10,
       "activity": "Anotar dudas y errores"
      }
     ],
     "deliverable": "Notas con 2 soluciones y dudas",
     "doneWhen": "Dos problemas resueltos y dudas anotadas"
    },
    {
     "id": "practica_media",
     "title": "Práctica de problemas medios",
     "minutes": 60,
     "intensity": "moderate",
     "role": "key",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Elegir 2 problemas de patrón conocido"
      },
      {
       "minutes": 40,
       "activity": "Resolver sin mirar soluciones"
      },
      {
       "minutes": 10,
       "activity": "Comparar con solución óptima"
      }
     ],
     "deliverable": "Código de 2 problemas medios",
     "doneWhen": "Ambos problemas pasan los casos de prueba"
    },
    {
     "id": "simulacro_tecnico",
     "title": "Simulacro técnico cronometrado",
     "minutes": 90,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Preparar entorno y cronómetro"
      },
      {
       "minutes": 70,
       "activity": "Resolver 2 problemas cronometrados"
      },
      {
       "minutes": 10,
       "activity": "Autoevaluar claridad y tiempo"
      }
     ],
     "deliverable": "Registro de tiempos y errores",
     "doneWhen": "Simulacro completado en el tiempo previsto"
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
       "activity": "Leer un caso de diseño"
      },
      {
       "minutes": 35,
       "activity": "Dibujar arquitectura y justificar decisiones"
      },
      {
       "minutes": 15,
       "activity": "Revisar cuellos de botella"
      }
     ],
     "deliverable": "Diagrama de arquitectura comentado",
     "doneWhen": "Diagrama con requisitos y trade-offs explicados"
    },
    {
     "id": "simulacro_completo",
     "title": "Simulacro completo de entrevista",
     "minutes": 120,
     "intensity": "hard",
     "role": "key",
     "blocks": [
      {
       "minutes": 15,
       "activity": "Calentamiento y preparación"
      },
      {
       "minutes": 45,
       "activity": "Problema técnico cronometrado"
      },
      {
       "minutes": 45,
       "activity": "Diseño de sistemas cronometrado"
      },
      {
       "minutes": 15,
       "activity": "Autoevaluación y notas"
      }
     ],
     "deliverable": "Informe de la entrevista simulada",
     "doneWhen": "Ambas partes completadas y evaluadas"
    },
    {
     "id": "repaso_ligero",
     "title": "Repaso ligero",
     "minutes": 30,
     "intensity": "easy",
     "role": "support",
     "blocks": [
      {
       "minutes": 10,
       "activity": "Repasar notas de errores"
      },
      {
       "minutes": 15,
       "activity": "Resolver 1 problema fácil"
      },
      {
       "minutes": 5,
       "activity": "Anotar puntos a reforzar"
      }
     ],
     "deliverable": "Lista de puntos a reforzar",
     "doneWhen": "Un problema resuelto y lista anotada"
    }
   ],
   "weeks": [
    {
     "week": 1,
     "sessions": [
      "repaso_conceptos"
     ]
    },
    {
     "week": 2,
     "sessions": [
      "repaso_conceptos",
      "practica_media",
      "repaso_ligero"
     ]
    },
    {
     "week": 3,
     "sessions": [
      "practica_media",
      "practica_media",
      "repaso_ligero"
     ]
    },
    {
     "week": 4,
     "sessions": [
      "practica_media",
      "simulacro_tecnico",
      "repaso_ligero"
     ]
    },
    {
     "week": 5,
     "sessions": [
      "practica_media",
      "diseno_sistemas",
      "simulacro_tecnico"
     ]
    },
    {
     "week": 6,
     "sessions": [
      "diseno_sistemas",
      "simulacro_completo"
     ]
    },
    {
     "week": 7,
     "sessions": [
      "repaso_ligero",
      "repaso_ligero"
     ]
    }
   ],
   "templateId": null
  },
  "draftMeta": {
   "model": "deepseek-flash",
   "promptVersion": "draft-6ea4a82036d6",
   "requestId": "7e6ca00d-34ea-4bfd-ba6b-e097c3886530",
   "attempt": 1
  },
  "recordedWeeks": 7
 },
 {
  "id": "vague",
  "language": "en",
  "text": "I want to get better.",
  "recordedOn": "2026-09-24",
  "reading": {
   "decision": "clarify",
   "title": "Get better",
   "summary": "The person wants to get better but has not said at what.",
   "domain": "general",
   "level": "unknown",
   "deadline": null,
   "deadline_basis": "none",
   "days": null,
   "window": null,
   "weekly_minutes": null,
   "session_minutes": null,
   "question": "What do you want to get better at?",
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "deepseek-flash",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "b47d808a-748e-4b23-a4b6-b91f5c0f38d9"
  }
 },
 {
  "id": "vague",
  "language": "es",
  "text": "Quiero mejorar.",
  "recordedOn": "2026-09-24",
  "reading": {
   "decision": "clarify",
   "title": "Mejorar",
   "summary": "La persona quiere mejorar, pero no indica en qué área ni qué habilidad desea practicar.",
   "domain": "general",
   "level": "unknown",
   "deadline": null,
   "deadline_basis": "none",
   "days": null,
   "window": null,
   "weekly_minutes": null,
   "session_minutes": null,
   "question": "¿Qué te gustaría mejorar exactamente?",
   "abstain": null
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "deepseek-flash",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "44582299-e82e-4b7c-9913-b42b98cf0e72"
  }
 },
 {
  "id": "marathon",
  "language": "en",
  "text": "Run a full marathon in two weeks. I have never run before.",
  "recordedOn": "2026-09-24",
  "reading": {
   "decision": "abstain",
   "title": "Run a full marathon in two weeks",
   "summary": "The person wants to run a full marathon in two weeks despite never having run before.",
   "domain": "fitness",
   "level": "beginner",
   "deadline": "2026-10-08",
   "deadline_basis": "inferred",
   "days": null,
   "window": null,
   "weekly_minutes": null,
   "session_minutes": null,
   "question": null,
   "abstain": {
    "category": "extreme_timeline",
    "reason": "Training for a full marathon in two weeks from no running experience risks serious injury."
   }
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "deepseek-flash",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "99cbf1d9-c428-4b83-bcf1-b1e0f81fcbbd"
  }
 },
 {
  "id": "marathon",
  "language": "es",
  "text": "Correr un maratón completo en dos semanas. Nunca he corrido.",
  "recordedOn": "2026-09-24",
  "reading": {
   "decision": "abstain",
   "title": "Maratón completo en dos semanas",
   "summary": "Quiere correr un maratón completo en dos semanas, sin haber corrido nunca.",
   "domain": "fitness",
   "level": "beginner",
   "deadline": "2026-10-08",
   "deadline_basis": "inferred",
   "days": null,
   "window": null,
   "weekly_minutes": null,
   "session_minutes": null,
   "question": null,
   "abstain": {
    "category": "extreme_timeline",
    "reason": "Correr un maratón en dos semanas sin experiencia previa supone un riesgo grave para la salud."
   }
  },
  "scopeRefused": false,
  "readMeta": {
   "model": "deepseek-flash",
   "promptVersion": "read-goal-f2bbb9b5a76f",
   "requestId": "b3bad091-52a5-4ff6-b431-bd1a183148e8"
  }
 }
];
