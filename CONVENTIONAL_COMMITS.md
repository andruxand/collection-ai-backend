# Convenciones para Commits (Conventional Commits)

Utiliza el estándar [Conventional Commits](https://www.conventionalcommits.org/) para todos los mensajes de commit. Esto ayuda a mantener un historial claro, semántico y automatizable.

## Formato básico

```
tipo(área): mensaje breve en presente

[descripción opcional más detallada]
```

### Tipos más comunes
- **feat**: Nueva funcionalidad (feature)
- **fix**: Corrección de bug
- **docs**: Cambios en documentación
- **refactor**: Refactorización de código (sin cambio de funcionalidad)
- **test**: Cambios en tests
- **chore**: Tareas de mantenimiento (build, deps, scripts)
- **ci**: Cambios en integración continua

### Ejemplos
- `feat(orchestrator): agrega soporte para canal voice`
- `fix(policy): corrige crash si falta channelsAllowed en país`
- `docs(readme): aclara flujo de onboarding`
- `refactor(core): simplifica merge de policies`

### Reglas
- Usa imperativo, en presente: "agrega", "corrige", "actualiza".
- Sé conciso pero claro.
- Si el cambio es relevante, agrega un cuerpo explicativo tras una línea en blanco.
- Si el commit cierra un issue, puedes agregar `Closes #123` al final.

---

Para más ejemplos y convenciones, consulta:
- https://www.conventionalcommits.org/es/v1.0.0/
- https://www.conventionalcommits.org/en/v1.0.0/
