-- Ejecutar después de los demás scripts; conserva los pagos existentes.
begin;

create or replace function public.cuotas_registrar_pago(p_vecino bigint, p_monto bigint, p_fecha date)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  inicio date; fin date; mes_actual date; cuota bigint; pagado bigint;
  aplicar bigint; restante bigint; pago_id bigint;
begin
  perform cuotas_privado.verificar_acceso();
  if p_vecino is null or p_monto is null or p_monto not between 1 and 1000000000
    or p_fecha is null then raise exception 'Datos de pago inválidos'; end if;
  perform pg_advisory_xact_lock(834213, 1);
  select v.inicio into inicio from cuotas_privado.vecinos v where v.id = p_vecino;
  if inicio is null then raise exception 'Vecino no encontrado'; end if;
  select make_date(max(anio), 12, 1) into fin from cuotas_privado.aranceles;
  if fin is null or fin < inicio then raise exception 'Configura los montos anuales antes de registrar pagos'; end if;
  insert into cuotas_privado.pagos(vecino_id, monto, fecha, creado_por)
    values (p_vecino, p_monto, p_fecha, auth.uid()) returning id into pago_id;
  restante := p_monto;
  mes_actual := inicio;
  while mes_actual <= fin and restante > 0 loop
    if extract(year from mes_actual)::integer in (2019, 2020) then
      mes_actual := (mes_actual + interval '1 month')::date;
      continue;
    end if;
    select a.monto into cuota from cuotas_privado.aranceles a
      where a.anio = extract(year from mes_actual)::integer;
    if cuota is null then
      raise exception 'Falta configurar el monto del año %', extract(year from mes_actual);
    end if;
    select coalesce(sum(ap.monto), 0) into pagado
      from cuotas_privado.aplicaciones ap
      join cuotas_privado.pagos p on p.id = ap.pago_id
      where p.vecino_id = p_vecino and p.anulado_en is null and ap.mes = mes_actual;
    aplicar := least(restante, greatest(cuota - pagado, 0));
    if aplicar > 0 then
      insert into cuotas_privado.aplicaciones(pago_id, mes, monto) values (pago_id, mes_actual, aplicar);
      restante := restante - aplicar;
    end if;
    mes_actual := (mes_actual + interval '1 month')::date;
  end loop;
  if restante > 0 then
    raise exception 'El pago supera las cuotas disponibles; configura los años necesarios';
  end if;
  return pago_id;
end;
$$;

create or replace function public.cuotas_datos(p_anio integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare resultado jsonb;
begin
  perform cuotas_privado.verificar_acceso();
  if p_anio not between 2000 and 2100 then raise exception 'Año inválido'; end if;
  select jsonb_build_object(
    'vecinos', coalesce((select jsonb_agg(to_jsonb(v) order by v.nombre, v.id)
      from cuotas_privado.vecinos v), '[]'::jsonb),
    'aranceles', coalesce((select jsonb_agg(to_jsonb(a) order by a.anio)
      from cuotas_privado.aranceles a), '[]'::jsonb),
    'cuotas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'vecino_id', v.id, 'mes', m.mes::date,
        'monto', case when v.no_paga_cuota or p_anio in (2019, 2020) then 0 else a.monto end, 'pagado', coalesce(p.pagado, 0)
      ) order by v.id, m.mes)
      from cuotas_privado.vecinos v
      cross join lateral generate_series(
        make_date(p_anio, 1, 1)::timestamp,
        make_date(p_anio, 12, 1)::timestamp, interval '1 month'
      ) m(mes)
      left join cuotas_privado.aranceles a on a.anio = p_anio
      left join lateral (
        select sum(ap.monto) as pagado
        from cuotas_privado.aplicaciones ap
        join cuotas_privado.pagos pg on pg.id = ap.pago_id
        where pg.vecino_id = v.id and pg.anulado_en is null and ap.mes = m.mes::date
      ) p on true
      where m.mes::date >= v.inicio
    ), '[]'::jsonb),
    'pagos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'vecino_id', p.vecino_id, 'monto', p.monto, 'fecha', p.fecha,
        'anulado_en', p.anulado_en, 'motivo_anulacion', p.motivo_anulacion,
        'aplicaciones', coalesce((
          select jsonb_agg(jsonb_build_object('mes', ap.mes, 'monto', ap.monto) order by ap.mes)
          from cuotas_privado.aplicaciones ap where ap.pago_id = p.id
        ), '[]'::jsonb)
      ) order by p.fecha desc nulls last, p.id desc)
      from cuotas_privado.pagos p
      where extract(year from p.fecha) = p_anio
        or exists (select 1 from cuotas_privado.aplicaciones ap
          where ap.pago_id = p.id and extract(year from ap.mes) = p_anio)
    ), '[]'::jsonb)
  ) into resultado;
  return resultado;
end;
$$;

create or replace function public.vecino_mis_cuotas(p_anio integer, p_rut text, p_clave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_origen text;
  v_intentos integer;
  v_hash text;
  v_rut text;
  v_inicio date;
  v_inicio_historial date;
  v_vecino_id bigint;
  v_nombre text;
  v_no_paga_cuota boolean;
  v_mes_actual date := date_trunc('month', current_date)::date;
  v_anio_actual integer := extract(year from current_date)::integer;
  v_resultado jsonb;
begin
  v_origen := md5(coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'cf-connecting-ip',
    'sin-direccion'
  ));
  perform pg_advisory_xact_lock(hashtext(v_origen));
  delete from cuotas_privado.intentos_portal
    where origen = v_origen and desde < now() - interval '15 minutes';
  select intentos into v_intentos from cuotas_privado.intentos_portal where origen = v_origen;
  if coalesce(v_intentos, 0) >= 20 then
    return jsonb_build_object('error', 'Demasiados intentos. Espera 15 minutos e inténtalo nuevamente.');
  end if;

  select hash into v_hash from cuotas_privado.clave_portal where unica;
  if v_hash is null then
    return jsonb_build_object('error', 'La clave del portal aún no está configurada. Contacta a la directiva.');
  end if;
  if p_clave is null or octet_length(p_clave) > 72
    or extensions.crypt(p_clave, v_hash) <> v_hash then
    insert into cuotas_privado.intentos_portal(origen, desde, intentos)
      values (v_origen, now(), 1)
      on conflict (origen) do update set intentos = cuotas_privado.intentos_portal.intentos + 1;
    return jsonb_build_object('error', 'RUT o clave incorrectos.', 'codigo', 'credenciales');
  end if;
  delete from cuotas_privado.intentos_portal where origen = v_origen;
  if p_anio is null or p_anio not between 2000 and v_anio_actual then
    raise exception 'Año inválido';
  end if;
  v_rut := regexp_replace(upper(coalesce(p_rut, '')), '[^0-9K]', '', 'g');
  if v_rut !~ '^[0-9]{1,8}[0-9K]$' then return jsonb_build_object('error', 'RUT o clave incorrectos.'); end if;

  select v.id, v.nombre, v.inicio, v.no_paga_cuota into v_vecino_id, v_nombre, v_inicio, v_no_paga_cuota
    from cuotas_privado.vecinos v
    where regexp_replace(upper(btrim(v.rut)), '[^0-9K]', '', 'g') = v_rut;
  if v_vecino_id is null then return jsonb_build_object('error', 'RUT o clave incorrectos.'); end if;
  select least(v_inicio, coalesce(min(ap.mes), v_inicio)) into v_inicio_historial
    from cuotas_privado.aplicaciones ap
    join cuotas_privado.pagos pg on pg.id = ap.pago_id
    where pg.vecino_id = v_vecino_id;
  if p_anio < extract(year from v_inicio_historial)::integer then
    raise exception 'Año fuera del período de cuotas';
  end if;

  select jsonb_build_object(
    'vecino', jsonb_build_object('nombre', v_nombre, 'rut', v_rut, 'no_paga_cuota', v_no_paga_cuota),
    'anio_inicio', extract(year from v_inicio_historial)::integer,
    'anio_actual', v_anio_actual,
    'mes_actual', v_mes_actual,
    'configuracion_completa', v_no_paga_cuota or not exists (
      select 1
      from generate_series(extract(year from v_inicio)::integer, v_anio_actual) y(anio)
      left join cuotas_privado.aranceles a on a.anio = y.anio::integer
      where a.anio is null and y.anio not in (2019, 2020)
    ),
    'deuda_hasta_hoy', case when v_no_paga_cuota then 0 else coalesce((
      select sum(greatest(a.monto - coalesce(p.pagado, 0), 0))
      from generate_series(
        v_inicio::timestamp, v_mes_actual::timestamp, interval '1 month'
      ) m(mes)
      join cuotas_privado.aranceles a on a.anio = extract(year from m.mes)::integer
      left join lateral (
        select sum(ap.monto) as pagado
        from cuotas_privado.aplicaciones ap
        join cuotas_privado.pagos pg on pg.id = ap.pago_id
        where pg.vecino_id = v_vecino_id and pg.anulado_en is null
          and ap.mes = m.mes::date
      ) p on true
      where extract(year from m.mes)::integer not in (2019, 2020)
    ), 0) end,
    'cuotas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mes', m.mes::date,
        'monto', case when v_no_paga_cuota or extract(year from m.mes)::integer in (2019, 2020) then 0 else a.monto end,
        'no_cobrado', extract(year from m.mes)::integer in (2019, 2020),
        'pagado', coalesce(p.pagado, 0),
        'comprobantes', coalesce(p.comprobantes, '[]'::jsonb)
      ) order by m.mes)
      from generate_series(
        v_inicio::timestamp,
        v_mes_actual::timestamp,
        interval '1 month'
      ) m(mes)
      left join cuotas_privado.aranceles a
        on a.anio = extract(year from m.mes)::integer
      left join lateral (
        select
          sum(ap.monto) as pagado,
          coalesce(
            jsonb_agg(distinct pg.comprobante order by pg.comprobante)
              filter (where pg.comprobante is not null),
            '[]'::jsonb
          ) as comprobantes
        from cuotas_privado.aplicaciones ap
        join cuotas_privado.pagos pg on pg.id = ap.pago_id
        where pg.vecino_id = v_vecino_id and pg.anulado_en is null
          and ap.mes = m.mes::date
      ) p on true
    ), '[]'::jsonb),
    'pagos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pg.id,
        'monto', pg.monto,
        'fecha', pg.fecha,
        'comprobante', pg.comprobante,
        'anulado_en', pg.anulado_en,
        'motivo_anulacion', pg.motivo_anulacion,
        'aplicaciones', coalesce((
          select jsonb_agg(jsonb_build_object('mes', ap.mes, 'monto', ap.monto) order by ap.mes)
          from cuotas_privado.aplicaciones ap where ap.pago_id = pg.id
        ), '[]'::jsonb)
      ) order by pg.fecha desc nulls last, pg.id desc)
      from cuotas_privado.pagos pg
      where pg.vecino_id = v_vecino_id
        and (extract(year from pg.fecha) = p_anio or exists (
          select 1 from cuotas_privado.aplicaciones ap
          where ap.pago_id = pg.id and extract(year from ap.mes) = p_anio
        ))
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

create or replace function public.cuotas_editar_pago(
  p_pago bigint, p_fecha date, p_monto bigint, p_aplicaciones jsonb, p_original jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pago cuotas_privado.pagos%rowtype;
  anteriores jsonb;
  nuevas jsonb := '[]'::jsonb;
  item jsonb;
  mes text;
  monto text;
  total numeric := 0;
  antes jsonb;
  despues jsonb;
begin
  perform cuotas_privado.verificar_acceso();
  perform pg_advisory_xact_lock(834213, 1);
  select * into pago from cuotas_privado.pagos where id = p_pago for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  if pago.anulado_en is not null then raise exception 'No se puede modificar un pago anulado'; end if;
  if p_fecha is null and not pago.historico then
    raise exception 'La fecha es obligatoria para pagos no históricos';
  end if;
  if p_monto is null or p_monto not between 1 and 1000000000 then
    raise exception 'Ingresa un monto válido';
  end if;
  if p_aplicaciones is null or jsonb_typeof(p_aplicaciones) <> 'array' then
    raise exception 'Indica las cuotas aplicadas';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('mes', ap.mes, 'monto', ap.monto) order by ap.mes), '[]'::jsonb)
    into anteriores from cuotas_privado.aplicaciones ap where ap.pago_id = pago.id;
  antes := jsonb_build_object('fecha', pago.fecha, 'monto', pago.monto, 'aplicaciones', anteriores);
  if p_original is distinct from antes then
    raise exception 'El pago cambió desde que se abrió. Busca el comprobante nuevamente';
  end if;

  for item in select value from jsonb_array_elements(p_aplicaciones) loop
    mes := item->>'mes';
    monto := item->>'monto';
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'mes') is distinct from 'string'
      or mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])-01$' or left(mes, 4) = '0000'
      or jsonb_typeof(item->'monto') is distinct from 'number'
      or monto !~ '^[1-9][0-9]{0,9}$' then
      raise exception 'Ingresa meses y montos aplicados válidos';
    end if;
    if monto::numeric > 1000000000 then raise exception 'Ingresa meses y montos aplicados válidos'; end if;
    if exists (select 1 from jsonb_array_elements(nuevas) a where a->>'mes' = mes) then
      raise exception 'No puedes repetir un mes en el mismo pago';
    end if;
    if left(mes, 4) in ('2019', '2020') and monto::bigint > coalesce((
      select (a->>'monto')::bigint from jsonb_array_elements(anteriores) a where a->>'mes' = mes
    ), 0) then
      raise exception 'No se pueden agregar pagos a meses no cobrados de 2019 y 2020';
    end if;
    nuevas := nuevas || jsonb_build_array(jsonb_build_object('mes', mes, 'monto', monto::bigint));
    total := total + monto::numeric;
  end loop;
  select coalesce(jsonb_agg(value order by value->>'mes'), '[]'::jsonb)
    into nuevas from jsonb_array_elements(nuevas);
  if (p_monto <> pago.monto or nuevas <> anteriores) and total <> p_monto then
    raise exception 'La suma aplicada a los meses debe coincidir con el monto del pago';
  end if;
  despues := jsonb_build_object('fecha', p_fecha, 'monto', p_monto, 'aplicaciones', nuevas);
  if antes = despues then return; end if;

  update cuotas_privado.pagos set fecha = p_fecha, monto = p_monto where id = pago.id;
  if nuevas <> anteriores then
    delete from cuotas_privado.aplicaciones where pago_id = pago.id;
    insert into cuotas_privado.aplicaciones(pago_id, mes, monto)
      select pago.id, (value->>'mes')::date, (value->>'monto')::bigint
      from jsonb_array_elements(nuevas);
  end if;
  insert into cuotas_privado.ediciones_pagos(pago_id, usuario_id, antes, despues)
    values (pago.id, auth.uid(), antes, despues);
end;
$$;

commit;
