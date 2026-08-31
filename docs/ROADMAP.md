# Roadmap

El alcance inicial es pequeño, demostrable y auditable; la ambición está en hacer explícitas las decisiones y preparar un modelo real.

## Entrega V0

1. Motor puro: normalizar días, minutos y tope; producir sesiones por orden de días; validar `session_minutes > 0`, total ≤ `weekly_cap` y días permitidos.
2. Intención: mostrar `goal`, `title`, `domain` y `steps`; días, minutos y tope vienen de campos explícitos autoritativos. El adaptador server-side real de DeepSeek está integrado, deshabilitado por defecto.
3. Revisión: cambiar restricciones preservando `goal`; recalcular y explicar qué cambió.
4. Exportación local a Markdown e ICS, con descarga.
5. Fixtures ficticios para estudio, creación y trabajo personal. Sin cuentas, pagos, calendario conectado ni otras integraciones.

## Después de V0

- **V0.1:** añadir diálogo de aclaración, extraer restricciones desde lenguaje natural, probar comprensión y mejorar conflictos.
- **V1:** evaluar el proveedor activado de forma opt-in, conservar el mismo esquema, validador y explicación, y ampliar la cobertura de rutinas.
- **V2:** estudiar persistencia e integraciones sólo después de resolver privacidad, consentimiento y recuperación de cambios.

## Puerta de calidad

Las pruebas de fixtures muestran casos y fallos: ningún plan viola días, duración o tope; la misma entrada produce la misma salida; una revisión conserva el objetivo. No evalúan DeepSeek. Las mediciones del proveedor activado se reportan aparte, con modelo, fecha, muestra y revisión humana; no se publican porcentajes de «precisión IA» sin ejecutarlas.
