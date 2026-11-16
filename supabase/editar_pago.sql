-- Ejecutar después de pagos_historicos.sql. No modifica pagos existentes.
begin;

create table if not exists cuotas_privado.ediciones_pagos (
  id bigint generated always as identity primary key,
  pago_id bigint not null references cuotas_privado.pagos(id),
  usuario_id uuid not null references auth.users(id),
  editado_en timestamptz not null default now(),
  antes jsonb not null,
  despues jsonb not null
);
revoke all on table cuotas_privado.ediciones_pagos from public, anon, authenticated;
revoke all on sequence cuotas_privado.ediciones_pagos_id_seq from public, anon, authenticated;

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

revoke all on function public.cuotas_editar_pago(bigint, date, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.cuotas_editar_pago(bigint, date, bigint, jsonb, jsonb) to authenticated;
commit;
