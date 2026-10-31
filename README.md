# Cuentas Claras

Finanzas personales y de pareja para Android. Coste: 0 €. Estado y decisiones: [docs/ESTADO.md](docs/ESTADO.md).

## Estructura
- `core/`: lógica financiera pura en Kotlin (sin Android). Todos los importes de la app salen de aquí.
- `app/`: aplicación Android (fase 2).
- `.github/workflows/ci.yml`: pruebas y, más adelante, compilación y publicación del APK.

## Ejecutar las pruebas
```bash
./gradlew :core:test            # requiere JDK 17 e internet
tools/test-core-local.sh        # sin red, con el Kotlin incluido en Gradle 8.14
```

## Puesta en marcha (una vez, gratis)
1. Crea un repositorio **privado** en GitHub y sube este proyecto a la rama `main`. GitHub Actions ejecuta las pruebas en cada envío.
2. Fase 3: crea un proyecto en Firebase (plan Spark, sin tarjeta), activa Authentication (correo) y Firestore, y descarga `google-services.json`.
3. Fase 4: cada persona crea su clave gratuita en console.groq.com y la pega en Ajustes de la app.
