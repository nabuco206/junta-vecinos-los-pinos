-- Ejecutar después de cuotas.sql, editar_vecinos.sql, comprobante.sql y portal_vecinos.sql.
begin;

alter table cuotas_privado.vecinos
  add column if not exists no_paga_cuota boolean not null default false;
alter table cuotas_privado.pagos
  add column if not exists historico boolean not null default false;

create or replace function public.cuotas_crear_vecino(
  p_nombre text, p_rut text, p_inicio date, p_no_paga_cuota boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform cuotas_privado.verificar_acceso();
  if p_no_paga_cuota is null then raise exception 'Indica si el vecino paga cuota'; end if;
  perform pg_advisory_xact_lock(834213, 1);
  perform public.cuotas_crear_vecino(p_nombre, p_rut, p_inicio);
  update cuotas_privado.vecinos set no_paga_cuota = p_no_paga_cuota
    where rut = btrim(p_rut);
end;
$$;

create or replace function public.cuotas_editar_vecino(
  p_vecino bigint, p_nombre text, p_rut text, p_inicio date, p_no_paga_cuota boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform cuotas_privado.verificar_acceso();
  if p_no_paga_cuota is null then raise exception 'Indica si el vecino paga cuota'; end if;
  perform public.cuotas_editar_vecino(p_vecino, p_nombre, p_rut, p_inicio);
  update cuotas_privado.vecinos set no_paga_cuota = p_no_paga_cuota where id = p_vecino;
end;
$$;

create or replace function cuotas_privado.verificar_pago_vecino() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(834213, 1);
  if not new.historico and exists (select 1 from cuotas_privado.vecinos where id = new.vecino_id and no_paga_cuota) then
    raise exception 'Este vecino está marcado como No paga cuota';
  end if;
  return new;
end;
$$;

drop trigger if exists pagos_verificar_vecino on cuotas_privado.pagos;
create trigger pagos_verificar_vecino before insert on cuotas_privado.pagos
for each row execute function cuotas_privado.verificar_pago_vecino();
revoke all on function cuotas_privado.verificar_pago_vecino() from public, anon, authenticated;
revoke all on function public.cuotas_crear_vecino(text, text, date, boolean) from public, anon;
revoke all on function public.cuotas_editar_vecino(bigint, text, text, date, boolean) from public, anon;
grant execute on function public.cuotas_crear_vecino(text, text, date, boolean) to authenticated;
grant execute on function public.cuotas_editar_vecino(bigint, text, text, date, boolean) to authenticated;

-- Las funciones de consulta se mantienen sincronizadas con los scripts originales.
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
        'monto', case when v.no_paga_cuota then 0 else a.monto end, 'pagado', coalesce(p.pagado, 0)
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
      where a.anio is null
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
    ), 0) end,
    'cuotas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mes', m.mes::date,
        'monto', case when v_no_paga_cuota then 0 else a.monto end,
        'pagado', coalesce(p.pagado, 0)
      ) order by m.mes)
      from generate_series(
        greatest(make_date(p_anio, 1, 1), v_inicio)::timestamp,
        least(make_date(p_anio, 12, 1), v_mes_actual)::timestamp,
        interval '1 month'
      ) m(mes)
      left join cuotas_privado.aranceles a on a.anio = p_anio
      left join lateral (
        select sum(ap.monto) as pagado
        from cuotas_privado.aplicaciones ap
        join cuotas_privado.pagos pg on pg.id = ap.pago_id
        where pg.vecino_id = v_vecino_id and pg.anulado_en is null
          and ap.mes = m.mes::date
      ) p on true
      where p_anio >= extract(year from v_inicio)::integer
        and p_anio <= v_anio_actual
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
commit;
