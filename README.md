# Control de cuotas

Aplicación para la tesorería de una junta de vecinos. Tesorería accede con
usuarios de Supabase Auth autorizados; los vecinos consultan con su RUT y una
clave común. Los datos se guardan en tablas privadas y se accede a ellos mediante
las funciones correspondientes.

## Instalación inicial

1. En Supabase, abre **SQL Editor**, copia y ejecuta `supabase/cuotas.sql` una
   sola vez. Es una instalación nueva: no borra ni importa la tabla de prueba
   `tbl_personas`.
2. En **Authentication > Users**, crea un usuario con correo y contraseña
   para cada persona de tesorería. Desactiva el registro público de usuarios
   en la configuración de autenticación.
3. En **SQL Editor**, autoriza cada usuario cambiando el correo en la siguiente
   consulta. La respuesta debe indicar una fila insertada; si indica cero,
   comprueba que el correo y el usuario existen.

   ```sql
   insert into cuotas_privado.autorizados (usuario_id)
   select id from auth.users where email = 'correo@ejemplo.cl'
   on conflict do nothing;
   ```

4. Después de `portal_vecinos.sql`, ejecuta `supabase/editar_vecinos.sql` para
   habilitar la modificación de vecinos. También se debe ejecutar una vez en
   instalaciones existentes; no elimina datos.
5. Ejecuta `supabase/historial_vecino.sql` para habilitar el historial completo
   de pagos por vecino. También se debe ejecutar en instalaciones existentes.
6. Ejecuta `supabase/validar_rut.sql` para validar el RUT al guardar o cambiar
   vecinos. En instalaciones existentes, actualiza también `portal_vecinos.sql`
   para permitir consultar RUT válidos más cortos. No se modifican los RUT ya
   guardados.
7. Ejecuta `supabase/comprobante.sql` para exigir el número de comprobante en
   cada pago nuevo; luego vuelve a ejecutar `historial_vecino.sql` y
   `portal_vecinos.sql`. Los pagos anteriores quedan sin comprobante.
8. Ejecuta `supabase/exencion_cuotas.sql` después de los scripts anteriores.
9. Ejecuta `supabase/pagos_historicos.sql` para admitir pagos históricos con
   fecha desconocida y comprobantes repetidos entre pagos históricos.
10. Abre la página publicada e inicia sesión con ese usuario. Configura la cuota
   mensual para cada año necesario, registra los vecinos con su mes de inicio
   y registra los pagos.

Para quitar acceso a un usuario, elimina su fila de `cuotas_privado.autorizados`
desde el SQL Editor. No expongas contraseñas ni claves `service_role` o secretas.
Revisa las políticas de la antigua tabla `tbl_personas` por separado: este
script no las modifica.

## Acceso para vecinos con clave común

1. Ejecuta `supabase/portal_vecinos.sql` en SQL Editor después de `cuotas.sql`.
   Si ya estaba instalado el portal anterior, vuelve a ejecutar este archivo:
   reemplaza la función anterior y los accesos con cuentas individuales dejan
   de funcionar. Los pagos y vecinos registrados se conservan.
   El script requiere `pgcrypto` en el esquema `extensions` de Supabase.
2. Publica el sitio actualizado. Una persona autorizada de tesorería debe
   iniciar sesión y definir la primera clave en **Clave común de vecinos**.
   Después puede cambiarla cuando quiera desde el mismo lugar y comunicarla por
   el canal que elija. Solo tesorería puede cambiar la clave.
3. Cada vecino registrado ingresa su RUT y esa clave; no necesita una cuenta
   individual ni códigos. La clave se guarda como hash en la base de datos y
   permanece solo en la memoria de la página mientras se consulta.

Al cambiar la clave, la anterior deja de servir también para nuevas consultas
de páginas ya abiertas; los datos que ya están en pantalla siguen visibles
hasta cerrar la sesión o la página. Después de 20 claves incorrectas desde una
misma dirección en 15 minutos, se bloquean temporalmente las consultas desde
esa dirección. Este límite depende de que Supabase proporcione la dirección
del cliente en `cf-connecting-ip`; configura también límites de acceso externos
si el despliegue no proporciona una dirección fiable.

No uses una contraseña que proteja otras cuentas. Cualquier persona que conozca
la clave y el RUT de otro vecino puede consultar sus pagos y deudas; no hay
privacidad entre vecinos. Si se divulga la clave, cámbiala y comunica la nueva
a todos.

## Funcionamiento

- En Vecinos, tesorería puede descargar un archivo Excel con ID, nombre, RUT y
  mes de inicio de cobro y condición de pago. El archivo contiene datos personales; guárdalo y
  compártelo con cuidado.
- La opción **No paga cuota** exime al vecino de todos los meses, incluso los
  anteriores. Sus pagos existentes y su historial se conservan; no se aceptan
  nuevos pagos mientras esté exento. Al desmarcarla vuelven a calcularse sus
  cuotas desde el inicio, considerando los pagos registrados. No vincula
  automáticamente a integrantes de una misma vivienda.
- Tesorería puede corregir nombre, RUT y mes de inicio en el listado de vecinos.
  Cambiar el mes puede alterar la deuda y no reasigna pagos existentes. No se
  permite fijarlo después de un mes con pagos vigentes aplicados.
- Al ingresar o cambiar un RUT se valida su formato y dígito verificador; la
  validación no comprueba la identidad de la persona ni la existencia del RUT.
- Los importes son pesos chilenos enteros. Cada año tiene una cuota mensual
  común. No se puede modificar un monto anual si existen aplicaciones de pagos
  para ese año, incluso si esos pagos fueron anulados.
- Los pagos parciales o adelantados se aplican a las cuotas pendientes más
  antiguas desde el mes de inicio. Si faltan años o el monto excede las cuotas
  configuradas, se rechaza el pago completo; no se guarda saldo a favor.
- Al anular un pago se conserva su historial y se liberan sus aplicaciones;
  las aplicaciones de otros pagos no se reasignan. El siguiente pago cubre
  primero las cuotas que vuelvan a quedar pendientes.
- En tesorería, **Registrar pago** e **Historial de pagos** son opciones
  separadas del menú. El historial muestra todos los pagos del vecino seleccionado,
  incluidos los anulados, con independencia del año seleccionado en el tablero.
- Los pagos históricos pueden tener fecha desconocida y un comprobante repetido.
  Los pagos nuevos siguen exigiendo fecha y comprobante único entre ellos.
  Los meses pagados anteriores al inicio de cobro se muestran en el historial
  sin generar cuotas ni deuda antes de ese inicio.
- El saldo mostrado corresponde al año completo, incluidos meses futuros.
  La sesión de tesorería se mantiene solo en memoria de la página.

Para modificar el exportador Excel, ejecuta `npm ci` y después
`npm run build:excel`; publica el archivo generado `exportar-vecinos.js`.