# Carpeta src/conversation

Rol:
- Contiene prompts (plantillas de instrucciones para los agentes LLM).
- Infra y dominio de conversación: ContextAssembler, promptLoader, agentes utilitarios como SummarizerAgent y RepairAgent.

Por qué existe separada:
- Mantiene los assets (prompts) y utilidades cerca del dominio de conversación sin mezclar con la lógica de orquestación.

Relación con src/core/conversation:
- Los agentes principales (Classifier/Planner/Writer/Verifier/Evaluator) viven en src/core/conversation y consumen estos prompts/infra.

Notas de mantenimiento:
- Todos los archivos en prompts/ están referenciados por agentes.
- Si se agrega/renombra un prompt, validar con npm test y revisar promptLoader.
- Plan futuro: consolidar bajo una sola jerarquía (ver README en src/core/conversation).
