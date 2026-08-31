# Cadencia

Cadencia (nombre de trabajo) convierte un objetivo expresado en español en un ritmo semanal que cabe. Estructura la intención, aplica límites editables y devuelve una agenda explicable.

## Contrato del producto V0

Entrada: texto y controles explícitos:

```text
petición de objetivo + días disponibles + minutos por sesión + tope semanal
```

Flujo visible: petición → intención → agenda determinista → validación → explicación. En V0 la intención contiene `goal`, `title`, `domain` y `steps`; `weekdays`, `session_minutes` y `weekly_cap` son restricciones separadas del formulario y gobiernan la agenda aunque el texto libre diga otra cosa. Al editarlas, se conserva el objetivo. Si no cabe, muestra el conflicto y qué límite revisar.

Ejemplo ficticio: «Quiero practicar acuarela; martes y jueves; 45 minutos por sesión; máximo 90 minutos». Devuelve dos sesiones de 45 minutos, verifica el total y explica. Si se pierde martes, se cambian días o duración; el objetivo permanece.

V0 exporta Markdown e ICS localmente. No hay cuentas, pagos ni integraciones externas. El adaptador server-side real de DeepSeek ya existe, pero está desactivado hasta configurar y activar el proveedor; no hay clave en el navegador. La demo lleva «Demo · salida determinista de ejemplo» y nunca se presenta como IA. Su calidad aún no se mide en vivo.

## Identidad

Dirección visual propia: tira de ritmo horizontal con segmentos mint sobre tinta; cada segmento representa una sesión y el espacio comunica margen. Geometría, tipografía e iconografía se diseñan desde cero. El producto evita recomendaciones médicas o de ejercicio; organiza estudio, práctica creativa y trabajo personal.
