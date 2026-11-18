-- Ejecutar después de editar_pago.sql y no_cobro_pandemia.sql.
begin;

create or replace function cuotas_privado.calcular_edicion_pago(
  p_pago bigint, p_monto bigint, p_original jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pago cuotas_privado.pagos%rowtype;
  vecino cuotas_privado.vecinos%rowtype;
  anteriores jsonb;
  actual jsonb;
  resultado jsonb := '[]'::jsonb;
  mes_actual date;
  fin date;
  cuota bigint;
  pagado bigint;
  restante bigint;
  aplicar bigint;
begin
  perform cuotas_privado.verificar_acceso();
  perform pg_advisory_xact_lock(834213, 1);
  if p_monto is null or p_monto not between 1 and 1000000000 then
    raise exception 'Ingresa un monto válido';
  end if;
  select * into pago from cuotas_privado.pagos where id = p_pago for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  if pago.anulado_en is not null then raise exception 'No se puede modificar un pago anulado'; end if;
  select * into vecino from cuotas_privado.vecinos where id = pago.vecino_id;
  if vecino.no_paga_cuota then raise exception 'Este vecino está marcado como No paga cuota; ajusta los meses manualmente'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('mes', ap.mes, 'monto', ap.monto) order by ap.mes), '[]'::jsonb),
    min(ap.mes)
    into anteriores, mes_actual from cuotas_privado.aplicaciones ap where ap.pago_id = pago.id;
  actual := jsonb_build_object('fecha', pago.fecha, 'monto', pago.monto, 'aplicaciones', anteriores);
  if p_original is distinct from actual then
    raise exception 'El pago cambió desde que se abrió. Busca el comprobante nuevamente';
  end if;
  if mes_actual is null then raise exception 'El pago no tiene meses asignados; ajusta los meses manualmente'; end if;
  select make_date(max(anio), 12, 1) into fin from cuotas_privado.aranceles;
  if fin is null or fin < mes_actual then raise exception 'Configura los valores de cuota antes de recalcular'; end if;
  restante := p_monto;
  while mes_actual <= fin and restante > 0 loop
    if extract(year from mes_actual)::integer in (2019, 2020) then
      mes_actual := (mes_actual + interval '1 month')::date;
      continue;
    end if;
    select a.monto into cuota from cuotas_privado.aranceles a where a.anio = extract(year from mes_actual)::integer;
    if cuota is null then raise exception 'Falta configurar el monto del año %', extract(year from mes_actual); end if;
    select coalesce(sum(ap.monto), 0) into pagado
      from cuotas_privado.aplicaciones ap
      join cuotas_privado.pagos p on p.id = ap.pago_id
      where p.vecino_id = pago.vecino_id and p.id <> pago.id
        and p.anulado_en is null and ap.mes = mes_actual;
    aplicar := least(restante, greatest(cuota - pagado, 0));
    if aplicar > 0 then
      resultado := resultado || jsonb_build_array(jsonb_build_object('mes', mes_actual, 'monto', aplicar));
      restante := restante - aplicar;
    end if;
    mes_actual := (mes_actual + interval '1 month')::date;
  end loop;
  if restante > 0 then raise exception 'El monto supera las cuotas disponibles; configura los años necesarios'; end if;
  return resultado;
end;
$$;
revoke all on function cuotas_privado.calcular_edicion_pago(bigint, bigint, jsonb) from public, anon, authenticated;

create or replace function public.cuotas_previsualizar_edicion_pago(
  p_pago bigint, p_monto bigint, p_original jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return cuotas_privado.calcular_edicion_pago(p_pago, p_monto, p_original);
end;
$$;

create or replace function public.cuotas_guardar_edicion_automatica(
  p_pago bigint, p_fecha date, p_monto bigint, p_original jsonb, p_aplicaciones jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare calculadas jsonb;
begin
  calculadas := cuotas_privado.calcular_edicion_pago(p_pago, p_monto, p_original);
  if p_aplicaciones is distinct from calculadas then
    raise exception 'Las cuotas o pagos cambiaron. Recalcula y revisa los meses antes de guardar';
  end if;
  perform public.cuotas_editar_pago(p_pago, p_fecha, p_monto, calculadas, p_original);
end;
$$;

revoke all on function public.cuotas_previsualizar_edicion_pago(bigint, bigint, jsonb) from public, anon;
revoke all on function public.cuotas_guardar_edicion_automatica(bigint, date, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.cuotas_previsualizar_edicion_pago(bigint, bigint, jsonb) to authenticated;
grant execute on function public.cuotas_guardar_edicion_automatica(bigint, date, bigint, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
