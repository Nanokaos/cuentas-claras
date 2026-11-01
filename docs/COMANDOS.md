# Qué puedes pedirle a Vera

Por voz (micrófono) o por escrito (barra superior o chat). Cualquier cambio en tus datos aparece como una tarjeta: **Confirmar** o **Cancelar**. Después siempre puedes decir «deshaz eso».

Con la clave de Groq entiende frases libres. Sin clave entiende las marcadas con ★.

## Apuntar movimientos
- ★ «23 euros en el súper con tarjeta»
- ★ «Ayer gasté 23 en el Mercadona y 8 en cenar; los 8 en efectivo»
- ★ «El viernes cobré 250 euros de un trabajo extra a las 18:30»
- «Me ha devuelto Amazon 25 euros de la compra del martes»
- «He pasado 100 euros de la cuenta corriente al ahorro»
- «Apunta que el 15 de diciembre tengo que pagar 300 de la ITV»
- «Mi nómina de este mes han sido 1.462,30»

## Corregir y borrar
- «El gasto de la gasolina de ayer eran 32, no 23»
- «Cambia la cena del sábado a la categoría Ocio»
- «Borra el último gasto»
- «Borra todos los bizums de octubre»
- «Elimina lo que apunté hoy en efectivo»
- «Todo lo de Glovo pásalo a Comida a domicilio»
- «Pon de concepto “Cumple Laura” a los dos últimos bizums enviados»
- «Ya he pagado la luz» / «Confirma el recibo del gimnasio»
- «Deshaz eso»

## Presupuestos y categorías
- ★ «Límite de ocio a 150»
- ★ «Quita el límite de ropa»
- ★ «Crea la categoría Mascotas con 50 euros al mes»
- «Crea Videojuegos dentro de Ocio con 20 al mes»
- «Renombra Otros a Varios»
- «Elimina la categoría Lotería y pasa sus gastos a Ocio»
- «Ajusta todos los presupuestos a lo que gasto de media»
- «Baja comida un 10 %»

## Planificación, cuentas y objetivos
- ★ «Mi próximo cobro es el 28»
- ★ «Colchón de 200»
- ★ «Ahorro mensual de 150»
- «Crea una cuenta de ahorro llamada Colchón con 1.000 euros»
- «En efectivo tengo ahora 35 euros» (ajusta el saldo)
- «Quita la cuenta Revolut»
- «Quiero ahorrar 1.200 para vacaciones, 150 al mes»
- «Aporta 50 a vacaciones»
- «El alquiler, 650 cada mes el día 1» (recurrente)
- «Paga el móvil a plazos: 25 al mes durante 12 meses desde el 5 de diciembre»
- «Deja de repetir el gimnasio»

## Preguntas y consejos
- ★ «¿Cuánto puedo gastar hoy?»
- ★ «¿Por qué me quedan 67 euros?»
- «¿En qué gasto más este mes?»
- «¿Cuánto llevo en bizums desde septiembre?»
- «¿Llego a fin de mes si me compro unas zapatillas de 90?»
- «¿Qué recibos me quedan antes de cobrar?»
- «Dame tres formas de ahorrar 100 euros este mes»
- «¿Cómo voy con el objetivo de vacaciones?»

## La app
- ★ «Llévame a presupuestos»
- «Importa mi extracto del banco»
- «Descarga una copia de seguridad» / «Exporta mis movimientos a CSV»
- «Pon el sarcasmo al máximo» / «Sé más amable»
- «Cállate» (desactiva la voz) / «Vuelve a hablar»
- «Activa el modo demostración»
- «Borra todos mis datos» (pide confirmación; se puede deshacer justo después)

## Extractos del banco
Ajustes → «Importar extracto» o Movimientos → «Importar extracto». Admite PDF (con texto o escaneado: se lee con OCR en el propio móvil), Excel y CSV.
- Dentro del periodo del extracto, todo lo anotado en esa cuenta se sustituye por lo del banco. Lo apuntado en efectivo se conserva.
- Clasifica por comercio (Mercadona → Supermercado, Glovo → Comida a domicilio, gasolineras → Transporte…) y crea las categorías que falten.
- Propone presupuestos con tu media mensual y ajusta el saldo para que cuadre con el banco.

## Dos cuentas: nómina/ahorro y gasto
- En Cuentas, «¿Cobras en una cuenta y gastas desde otra?» prepara las dos. Solo la de gasto cuenta como disponible.
- «he pasado 900 de ahorro a gasto» · «pasa 50 de gasto a efectivo» → traspaso (no es ingreso ni gasto).
- Al importar un extracto, la cuenta se reconoce por el IBAN (la primera vez se pregunta y se recuerda).
- Los traspasos que ya dijiste se confirman con el extracto por importe y fecha (±3 días); los de dos extractos se unen en uno.

## Veranza: tareas, micro y notificación diaria
- Bizums sin nombre: tarjeta en Inicio para decir a quién fueron o de quién vinieron. También a Vera: «el bizum de 25 del 20 fue a Laura».
- Micro: un toque abre, otro toque cierra. Mientras escucha, el botón se pone rojo y aparece la barra «Te escucho».
- Ajustes › Notificaciones: frase diaria a las 10:00. «Código para la hora exacta» se pega en push/subs.json; hace falta el secreto VAPID_PRIVATE_KEY en GitHub.
- Ajustes › Datos › «Poner todo a cero…»: borra movimientos y saldos (o todo) y se puede deshacer.
