# Glossary (Diccionario de términos)

- **Tenant (Inquilino / Cuenta / Empresa):** una empresa o cartera que usa la plataforma. Todo es multi-tenant; `tenantId` está en cada registro.
- **Debtor (Deudor):** persona con obligación pendiente. Tiene `stage` (EARLY/MID/LATE) y snapshot de deuda.
- **Channel (Canal):** medio de contacto (WhatsApp / Telegram). En el futuro puede incluir voz.
- **Inbound:** mensaje entrante del deudor hacia el sistema.
- **Outbound:** mensaje saliente del sistema hacia el deudor (recordatorio, respuesta, etc.).
- **Policy Engine:** reglas determinísticas de cumplimiento y operación (horarios, opt-out, cooldown, límites por etapa).
- **Cooldown:** periodo de espera antes de volver a contactar (por no respuesta, rechazo de oferta, promesa rota, etc.).
- **Stage (Etapa):** segmentación del caso (EARLY/MID/LATE) que define tono y límites.
- **NLU (Natural Language Understanding):** clasificación de intención y extracción de entidades (monto/fecha) a partir del texto.
- **Intent:** “qué quiere” el usuario (pagar, negociar, reclamar, opt-out, etc.).
- **Entities:** datos extraídos del mensaje (monto, fecha, método).
- **NBA (Next Best Action):** decisión determinística de qué hacer ahora (pedir datos, mostrar detalle, ofrecer acuerdo, registrar promesa).
- **Offer Engine:** motor determinístico que calcula ofertas (cuotas, descuentos) según políticas del tenant.
- **Handoff:** transferencia a un humano cuando el caso requiere revisión (disputa, enojo, alto riesgo).
- **Audit Log:** rastro completo (mensajes + decisiones) para cumplimiento, QA y disputas.
- **Reminder:** evento programado (p.ej. promesa de pago) que dispara un mensaje futuro si la policy lo permite.
- **Idempotency:** garantía de que el mismo evento entrante no se procesa dos veces (evita duplicados).

- **RBAC:** control de acceso por roles (ej. Admin, Agent).
- **ABAC:** control de acceso por atributos (ej. tenantIds en el JWT).
- **Platform Admin:** consola interna para administrar tenants y casos.
- **Assignee (AssignedTo):** persona responsable del caso (en MVP, por email).
- **Priority/Tags:** metadata operacional para clasificar casos.

- **caseSk:** identificador (SK) del caso handoff en DynamoDB, requerido para acciones (assign/close).

- **Operator:** usuario de plataforma (Cognito) que gestiona casos.
- **UserSub:** identificador único (`sub`) de Cognito.
- **Handoff events:** registros de historial del caso (CREATED/ASSIGNED/CLOSED/EMAIL_SENT).

- **API_KEY_PEPPER:** secreto del servidor usado para hashear API keys (nunca se comparte).
- **Client Portal:** UI para usuarios del acreedor/cliente; debe usar JWT, no API keys en navegador.


- **Country Policy**: Baseline compliance policy per country/jurisdiction (hours, caps, channels). Stored in DynamoDB and merged with Tenant Policy.
- **Effective Policy**: Result of merging Country Policy + Tenant Policy, enforcing that tenant cannot be more permissive than the country baseline.


## phone_number_id (WhatsApp)
Identifier of the WhatsApp business phone number in Cloud API webhooks (`metadata.phone_number_id`). Used to route inbound messages to the correct tenant.

## botKey
A short identifier used in the Telegram webhook path to route updates to the correct tenant (multi-tenant Telegram routing).

## X-Telegram-Bot-Api-Secret-Token
A header sent by Telegram when you configure `secret_token` in `setWebhook`. Used to verify webhook origin.

