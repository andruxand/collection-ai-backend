# Incidente LLM — 2026-01-19

Resumen:
- Síntoma: el bot devolvía siempre un mensaje de fallback; clasificación (`classifier`) fallaba.
- Causa raíz: errores en llamadas al OpenAI Responses API y en los JSON Schemas usados para `json_schema` strict output.
  - Inicialmente: la variable `LLM_OPENAI_KEY_SECRET_ID` apuntaba a un secreto incorrecto → 401.
  - Después: key tuvo `insufficient_quota` (429) hasta que se actualizó la facturación.
  - Finalmente: 400 `invalid_json_schema` por esquemas JSON inválidos para la API de Responses (faltaba `required` y OpenAI exige que `required` incluya todas las keys definidas en `properties`).

Acciones realizadas:
1. Validaciones y correcciones rápidas:
   - Paquetes y despliegue: se corrigió `serverless.ts` para incluir archivos de policy (curated data).
   - `llmClient.ts` ahora incluye cuerpo y status de la respuesta LLM en errores para depuración (truncado).
2. Corrección del schema:
   - `src/core/conversation/schemas/classifier.ts`: `entities` ahora incluye `required` con todas las claves y acepta `null` en valores opcionales.
   - `src/core/nlu/schema.ts` y `src/core/dialogue/schema.ts`: mismo ajuste para `entities`.
   - Racional: OpenAI Responses API `json_schema` strict espera `required` que liste todas las props; aceptar `null` permite que el modelo devuelva `null` cuando no tiene valor.
  - Importante: también se alinearon los esquemas Zod para aceptar `null` (si no, el modelo puede devolver JSON válido y aun así fallar la validación interna, produciendo `Max repair attempts reached`).
3. Despliegue y verificación:
   - Se desplegó la versión corregida y se probó con un POST simulado al webhook.
   - Se añadió logging para capturar detalles de error LLM en el TURN audit (response body + status).

Recomendaciones y runbook:
- Si ves `LLM error: 400` con `invalid_json_schema`:
  1. Revisa el JSON schema usado en el agent (campos `properties` y presencia de `required`).
  2. Para OpenAI Responses API `json_schema` strict: incluir `required` que contenga todos los campos listados en `properties`.
  3. Para campos opcionales, permitir `null` en su `type` (ej. `type: ['integer','null']`) y listarlos en `required`.
- Si ves `LLM error: 401` → verificar `LLM_OPENAI_KEY_SECRET_ID` y el secreto en Secrets Manager.
- Si ves `LLM error: 429` o `insufficient_quota` → revisar panel de facturación en OpenAI y límites del proyecto.
- Observability:
  - TURN audits en DynamoDB (`TURN#...`) contienen `payload.error` y ahora incluirán detalles de respuesta LLM truncados.
  - Para depuración rápida, buscar `sendTelegram: success` en logs del `orchestrator` para confirmar outbound.

Notas técnicas:
- Los esquemas OpenAI (JSON Schema) y Zod deben ser consistentes: si el JSON Schema permite/usa `null`, Zod debe aceptar `null` (o transformarlo a `undefined`) para evitar falsos negativos.
- Evitar cambios tipo "parches" sin entender la semántica: las correcciones hechas respetan la intención de los esquemas y permiten interoperar con la validación estricta de OpenAI.

Mejoras posteriores (calidad de conversación):
- Ajuste del prompt del classifier para evitar clasificar como `WRONG_PERSON` cuando el mensaje es casual/off-topic sin evidencia; preferir `OFF_TOPIC` + `lowContext=true`.
- Se añadió una plantilla determinística `negotiation.reengage` para redirigir la conversación al objetivo (pago/acuerdo) cuando el contexto es bajo, reduciendo loops de reparación y respuestas tipo fallback.

Próximos pasos sugeridos (operaciones):
- Monitorizar TURNs nuevos y verificar `ok: true` para classification.
- Considerar añadir métricas/alertas cuando el número de `LLM error` supere un umbral (ej. >5 en 5 minutos).

Mantén este documento como primer lugar para revisar si ocurre un problema similar.
