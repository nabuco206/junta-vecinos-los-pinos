-- Ejecutar después de no_cobro_pandemia.sql y editar_pago.sql.
begin;

create or replace function cuotas_privado.calcular_redistribucion(
  p_pago bigint, p_fecha date, p_monto bigint, p_original jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  seleccionado cuotas_privado.pagos%rowtype;
  vecino cuotas_privado.vecinos%rowtype;
  pago record;
  anteriores jsonb;
  actual jsonb;
  resultado jsonb := '[]'::jsonb;
  aplicaciones jsonb;
  mes_actual date;
  fin date;
  cuota bigint;
  libre bigint := 0;
  restante bigint;
  aplicar bigint;
begin
  perform cuotas_privado.verificar_acceso();
  perform pg_advisory_xact_lock(834213, 1);
  if p_monto is null or p_monto not between 1 and 1000000000 then
    raise exception 'Ingresa un monto válido';
  end if;
  select * into seleccionado from cuotas_privado.pagos where id = p_pago for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  if seleccionado.anulado_en is not null then raise exception 'No se puede modificar un pago anulado'; end if;
  if p_fecha is null and not seleccionado.historico then raise exception 'La fecha es obligatoria para pagos no históricos'; end if;
  select * into vecino from cuotas_privado.vecinos where id = seleccionado.vecino_id;
  if vecino.no_paga_cuota then raise exception 'Este vecino está marcado como No paga cuota; ajusta los meses manualmente'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('mes', ap.mes, 'monto', ap.monto) order by ap.mes), '[]'::jsonb)
    into anteriores from cuotas_privado.aplicaciones ap where ap.pago_id = seleccionado.id;
  actual := jsonb_build_object('fecha', seleccionado.fecha, 'monto', seleccionado.monto, 'aplicaciones', anteriores);
  if p_original is distinct from actual then raise exception 'El pago cambió desde que se abrió. Busca el comprobante nuevamente'; end if;

  if exists (select 1 from cuotas_privado.pagos p where p.vecino_id = vecino.id and p.anulado_en is null
    and nullif(btrim(p.comprobante), '') is not null and btrim(p.comprobante) !~ '^[0-9]+$') then
    raise exception 'Hay comprobantes que no son numéricos; revisa su orden antes de redistribuir';
  end if;
  if exists (select 1 from cuotas_privado.pagos p where p.vecino_id = vecino.id and p.anulado_en is null
    and nullif(btrim(p.comprobante), '') is not null
    group by btrim(p.comprobante)::numeric having count(*) > 1) then
    raise exception 'Hay comprobantes repetidos para este vecino; revisa su orden antes de redistribuir';
  end if;
  if exists (select 1 from cuotas_privado.pagos p where p.vecino_id = vecino.id and p.anulado_en is null
      and nullif(btrim(p.comprobante), '') is null
      and (case when p.id = p_pago then p_fecha else p.fecha end) is not null) then
    if exists (select 1 from cuotas_privado.pagos p where p.vecino_id = vecino.id and p.anulado_en is null
        and nullif(btrim(p.comprobante), '') is not null
        and (case when p.id = p_pago then p_fecha else p.fecha end) is null) then
      raise exception 'Hay comprobantes sin fecha; no es posible ubicar los pagos sin comprobante por fecha';
    end if;
    if exists (
      select 1 from (
        select case when p.id = p_pago then p_fecha else p.fecha end as fecha,
          lag(case when p.id = p_pago then p_fecha else p.fecha end)
            over (order by btrim(p.comprobante)::numeric) as fecha_anterior
        from cuotas_privado.pagos p where p.vecino_id = vecino.id and p.anulado_en is null
          and nullif(btrim(p.comprobante), '') is not null
      ) fechas where fecha < fecha_anterior
    ) then raise exception 'Las fechas contradicen el orden de los comprobantes; revisa los pagos sin comprobante'; end if;
  end if;

  mes_actual := vecino.inicio;
  select make_date(max(anio), 12, 1) into fin from cuotas_privado.aranceles;
  if fin is null or fin < mes_actual then raise exception 'Configura los valores de cuota antes de recalcular'; end if;
  for pago in
    with vigentes as (
      select p.*, case when p.id = p_pago then p_fecha else p.fecha end as fecha_nueva
      from cuotas_privado.pagos p where p.vecino_id = vecino.id and p.anulado_en is null
    ), numerados as (
      select v.*, row_number() over (order by btrim(v.comprobante)::numeric) as posicion
      from vigentes v where nullif(btrim(v.comprobante), '') is not null
    ), ordenados as (
      select n.id, n.comprobante, n.fecha, n.fecha_nueva, n.monto, n.posicion * 2 as orden
      from numerados n
      union all
      select v.id, v.comprobante, v.fecha, v.fecha_nueva, v.monto,
        case when v.fecha_nueva is null then 9223372036854775807::bigint
          else (select count(*) * 2 + 1 from numerados n where n.fecha_nueva <= v.fecha_nueva) end
      from vigentes v where nullif(btrim(v.comprobante), '') is null
    )
    select * from ordenados order by orden, fecha_nueva nulls last, id
  loop
    select coalesce(jsonb_agg(jsonb_build_object('mes', ap.mes, 'monto', ap.monto) order by ap.mes), '[]'::jsonb)
      into anteriores from cuotas_privado.aplicaciones ap where ap.pago_id = pago.id;
    actual := jsonb_build_object('fecha', pago.fecha, 'monto', pago.monto, 'aplicaciones', anteriores);
    restante := case when pago.id = p_pago then p_monto else pago.monto end;
    aplicaciones := '[]'::jsonb;
    while restante > 0 loop
      if mes_actual > fin then raise exception 'El monto supera las cuotas disponibles; configura los años necesarios'; end if;
      if extract(year from mes_actual)::integer in (2019, 2020) then
        mes_actual := (mes_actual + interval '1 month')::date;
        continue;
      end if;
      if libre = 0 then
        select a.monto into cuota from cuotas_privado.aranceles a where a.anio = extract(year from mes_actual)::integer;
        if cuota is null then raise exception 'Falta configurar el monto del año %', extract(year from mes_actual); end if;
        libre := cuota;
      end if;
      aplicar := least(restante, libre);
      aplicaciones := aplicaciones || jsonb_build_array(jsonb_build_object('mes', mes_actual, 'monto', aplicar));
      restante := restante - aplicar;
      libre := libre - aplicar;
      if libre = 0 then mes_actual := (mes_actual + interval '1 month')::date; end if;
    end loop;
    resultado := resultado || jsonb_build_array(jsonb_build_object(
      'id', pago.id, 'comprobante', pago.comprobante, 'fecha', pago.fecha_nueva,
      'monto', case when pago.id = p_pago then p_monto else pago.monto end,
      'antes', actual, 'aplicaciones', aplicaciones));
  end loop;
  return resultado;
end;
$$;
revoke all on function cuotas_privado.calcular_redistribucion(bigint, date, bigint, jsonb) from public, anon, authenticated;

create or replace function public.cuotas_previsualizar_redistribucion(
  p_pago bigint, p_fecha date, p_monto bigint, p_original jsonb
) returns jsonb language sql security definer set search_path = '' as $$
  select cuotas_privado.calcular_redistribucion(p_pago, p_fecha, p_monto, p_original);
$$;

create or replace function public.cuotas_guardar_redistribucion(
  p_pago bigint, p_fecha date, p_monto bigint, p_original jsonb, p_distribucion jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare calculada jsonb; item jsonb;
begin
  calculada := cuotas_privado.calcular_redistribucion(p_pago, p_fecha, p_monto, p_original);
  if p_distribucion is distinct from calculada then
    raise exception 'Los pagos o cuotas cambiaron. Recalcula y revisa la distribución antes de guardar';
  end if;
  for item in select value from jsonb_array_elements(calculada) loop
    perform public.cuotas_editar_pago((item->>'id')::bigint, (item->>'fecha')::date,
      (item->>'monto')::bigint, item->'aplicaciones', item->'antes');
  end loop;
end;
$$;
revoke all on function public.cuotas_previsualizar_redistribucion(bigint, date, bigint, jsonb) from public, anon;
revoke all on function public.cuotas_guardar_redistribucion(bigint, date, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.cuotas_previsualizar_redistribucion(bigint, date, bigint, jsonb) to authenticated;
grant execute on function public.cuotas_guardar_redistribucion(bigint, date, bigint, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
