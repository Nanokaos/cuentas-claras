# Cuentas Claras: estado, decisiones y pendientes

Nombre provisional de la app: **Cuentas Claras**. Asistente: nombre provisional **Vera**, configurable.

## Alcance

App Android de finanzas personales para dos personas: cuentas individuales y vínculo de pareja con
gastos comunes, presupuestos deterministas con reservas, registro por formulario, texto y voz,
y un asistente con personalidad fría y sarcástica que explica y propone pero nunca ejecuta sin confirmación.
**Coste fijo: 0 €.** Ni alojamiento de pago ni APIs de IA de pago.

## Stack (todo gratuito, verificado en octubre de 2026)

| Necesidad | Solución | Límites gratuitos y comportamiento |
|---|---|---|
| App | Kotlin + Jetpack Compose; Room (SQLite) primero en local | Funciona sin conexión ni IA |
| Cuentas y sincronización | Firebase Auth + Firestore, plan **Spark** | Sin tarjeta y no puede generar facturas: al agotar la cuota se para hasta el reinicio. Unos 1 GiB, 50.000 lecturas/día y 20.000 escrituras/día; de sobra para dos personas |
| Lógica de servidor | **Ninguna**: Cloud Functions exige el plan Blaze (con tarjeta) | Toda la lógica va en el móvil; la seguridad, en las reglas de Firestore |
| Archivos en la nube | **No**: Cloud Storage salió de Spark en febrero de 2026 | Las copias van al móvil o a tu Drive mediante el selector de archivos de Android |
| Chat IA | **Groq**, plan gratuito, cada persona con su propia cuenta y clave | Ejemplo gpt-oss-120b: 30 peticiones/min, 1.000/día, 8.000 tokens/min y 200.000 tokens/día por organización |
| IA alternativa | Gemini API, nivel gratuito (Flash / Flash-Lite), solo si la activas | En el nivel gratuito Google puede usar el contenido para mejorar sus productos |
| Sin IA | Intérprete local de frases + cálculos | Ya implementado en `:core` |
| Voz | `SpeechRecognizer` (es-ES) + `TextToSpeech` del sistema con filtro robótico propio | 0 €, sin API externa. No imita la voz de ninguna actriz real |
| Notificaciones | Locales (WorkManager) | Sin servidor de push |
| Compilación | GitHub Actions | Repositorio privado o público |
| Actualizaciones | GitHub Releases + descarga + instalador del sistema | Android exige que confirmes cada instalación: no existe instalación silenciosa |

### Claves y secretos
- Ninguna clave de IA va dentro del APK. Cada persona pega su clave gratuita en Ajustes y se guarda cifrada (Android Keystore).
- `google-services.json` no es secreto; la protección real son las reglas de Firestore.
- La clave de firma del APK se guarda en los *secrets* de GitHub, nunca en el repositorio.

## Bloqueos reales

1. **Compilar el APK**: este entorno no tiene acceso a los repositorios de Google/Maven. El APK lo compila GitHub Actions. Para iterar sin intermediarios necesito acceso a un repositorio tuyo en GitHub.
2. **Verificación de desarrolladores de Android**: desde el 30 de septiembre de 2026 se exige en Brasil, Indonesia, Singapur y Tailandia; Google prevé ampliarla a todo el mundo en 2027. Para entonces: cuenta gratuita de «distribución limitada» (hasta 20 dispositivos, sin DNI ni pago), el «flujo avanzado» de instalación o ADB. Hoy no afecta en España.
3. **Personaje**: la mascota animada será un robot de diseño original, no GLaDOS. Personalidad fría, sarcástica y crítica, con intensidad ajustable.
4. **Cuotas gratuitas cambiantes**: la app mide su propio consumo, se detiene antes del límite y pasa a modo sin IA. No rota cuentas para eludir límites.

## Fases

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Motor financiero puro: dinero, cuentas, movimientos, traspasos, devoluciones, ajustes, repartos, recurrentes, cuotas, presupuesto con reservas, permisos, sincronización (HLC), duplicados, intérprete local | **Implementado y probado (46 pruebas)** |
| 2 | App Android base: Room, cuentas, movimientos (alta, edición, borrado, búsqueda, filtros, confirmar previstos), categorías y límites, recurrentes, entrada rápida por texto y dictado con confirmación, Inicio con Vera 3D y presupuesto explicado, ajustes, datos de demostración en archivo aparte | **Compila en CI (APK 0.2.2). Sin probar aún en un móvil real.** Pendiente: objetivos (pantalla), ordenar módulos de Inicio |
| 3 | Usuarios y pareja: Firebase Auth, invitación, permisos de lectura/edición, revocación, Firestore + reglas, sincronización sin conexión y conflictos | Pendiente |
| 4 | Asistente: capa de proveedores (Groq → Gemini opcional → modo local), presupuesto de uso, contexto mínimo autorizado, borradores con confirmación, protección frente a instrucciones dentro de los datos | Pendiente |
| 5 | Voz y mascota: dictado, conversación interrumpible, TTS robótico, animación por estados (reposo, escucha, procesamiento, respuesta, aviso) y opción de reducir movimiento | Pendiente |
| 6 | Notificaciones configurables, exportación (CSV) y copia completa (JSON), restauración, actualizador por GitHub Releases, firma, migraciones y pruebas de actualización sin pérdida de datos | Pendiente |

## Supuestos (cambiables)

- **Pendiente** = previsto cuya fecha ya pasó sin confirmarse. Se sigue reservando hasta que lo confirmes o lo borres.
- Confirmar un previsto conserva su id y pasa a realizado: nunca se cuenta dos veces.
- Hasta el cobro: se reservan los pagos **hasta el día de cobro incluido** (criterio prudente) y el dinero se reparte entre hoy y el día anterior al cobro.
- Sin fecha de cobro (o con una fecha ya pasada): escenario provisional hasta fin de mes, marcado como tal.
- Los ingresos futuros nunca cuentan como disponibles; se muestran aparte, indicando si son estimados.
- Hoy = (disponible + gasto discrecional de hoy) / días restantes − gasto de hoy. Los recibos previstos confirmados hoy no restan del día.
- Semana de lunes a domingo, limitada por la fecha de cobro.
- Ahorro mensual = traspasos de cuentas líquidas a cuentas de ahorro. Si hay traspasos programados mayores que el objetivo, se reserva el mayor de los dos, nunca ambos.
- Objetivos: se reserva la aportación del mes que falta y, si el dinero sigue en una cuenta líquida, también lo ya apartado.
- Gastos comunes: en tu vista solo cuenta tu parte; el dinero sale de la cuenta de quien paga; lo que debes a tu pareja se reserva. En la vista conjunta cada gasto común cuenta una vez.
- Redondeo del importe diario siempre hacia abajo.
- Pendiente de decidir en la fase 3: cuentas conjuntas, con saldo atribuido por porcentaje.

## Registro

- 2026-10-31. Fase 2: APK compilado en GitHub Actions y publicado como versión 0.2.2. Vera 3D (Three.js empaquetado, sin red) dentro de la app. Firma estable para instalar versiones nuevas encima sin perder datos.

- 2026-10-31. Fase 1 completada: `:core` compilado y 46 pruebas ejecutadas en local (Kotlin 2.0.21 + JUnit 4.13.2). CI de GitHub preparado y **aún sin ejecutar**.
