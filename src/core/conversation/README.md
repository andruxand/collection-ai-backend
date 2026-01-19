# Carpeta src/core/conversation

Rol:
- Implementa los agentes principales (ClassifierAgent, PlannerAgent, WriterAgent, VerifierAgent, EvaluatorAgent).
- Orquestación de turnos: ConversationTurnRunner y lógica determinística (TemplateLibrary).

Relación con src/conversation:
- Consume prompts y utilidades (promptLoader, ContextAssembler, SummarizerAgent, RepairAgent) que residen en src/conversation.

Estado actual:
- Ambas jerarquías se usan y están cubiertas por pruebas.
- Carpetas vacías previamente creadas (observability, postcheck, preprocessor, supervisor, writer) fueron eliminadas.

Plan de consolidación (futuro):
- Unificar prompts e infra bajo una sola jerarquía para reducir confusión.
- Mantener compatibilidad de imports y pruebas con alias o rutas internas.
