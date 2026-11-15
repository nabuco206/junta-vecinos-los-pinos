-- Ejecutar solo en una base de prueba con todos los scripts instalados.
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000001', 'tesorero@example.invalid');
insert into cuotas_privado.autorizados values ('00000000-0000-0000-0000-000000000001');
insert into cuotas_privado.vecinos(id, nombre, rut, inicio) overriding system value
values (1, 'Ana', '11.111.111-1', date_trunc('year', current_date)::date);
select setval(pg_get_serial_sequence('cuotas_privado.vecinos', 'id'), 1);
insert into cuotas_privado.aranceles(anio, monto) values (extract(year from current_date)::int, 1000);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.cuotas_cambiar_clave_portal('clave-prueba');
select public.cuotas_registrar_pago(1, 1000, current_date, 'A-1');
select public.cuotas_editar_vecino(1, 'Ana', '11.111.111-1', date_trunc('year', current_date)::date, true);
select public.cuotas_crear_vecino('Luis', '6.528.355-7', date_trunc('year', current_date)::date, true);

do $$
declare datos jsonb; resultado jsonb;
begin
  datos := public.cuotas_datos(extract(year from current_date)::int);
  if not (datos->'vecinos' @> '[{"nombre":"Ana","no_paga_cuota":true},{"nombre":"Luis","no_paga_cuota":true}]'::jsonb) then
    raise exception 'La exención no se guardó';
  end if;
  if exists (select 1 from jsonb_array_elements(datos->'cuotas') c where (c->>'monto')::int <> 0) then
    raise exception 'Hay cuotas con deuda para vecinos exentos';
  end if;
  if not exists (select 1 from jsonb_array_elements(datos->'cuotas') c where (c->>'pagado')::int = 1000) then
    raise exception 'Se perdió el pago anterior';
  end if;
  resultado := public.vecino_mis_cuotas(extract(year from current_date)::int, '111111111', 'clave-prueba');
  if not (resultado->'vecino'->>'no_paga_cuota')::boolean or (resultado->>'deuda_hasta_hoy')::int <> 0
    or not (resultado->>'configuracion_completa')::boolean or jsonb_array_length(resultado->'pagos') <> 1 then
    raise exception 'Portal incorrecto para vecino exento: %', resultado;
  end if;
  begin
    perform public.cuotas_registrar_pago(1, 1000, current_date, 'A-2');
    raise exception 'Se permitió un pago a un vecino exento';
  exception when raise_exception then
    if sqlerrm <> 'Este vecino está marcado como No paga cuota' then raise; end if;
  end;
end;
$$;

select public.cuotas_editar_vecino(1, 'Ana', '11.111.111-1', date_trunc('year', current_date)::date, false);
do $$
declare datos jsonb;
begin
  datos := public.cuotas_datos(extract(year from current_date)::int);
  if not exists (select 1 from jsonb_array_elements(datos->'cuotas') c
    where (c->>'vecino_id')::int = 1 and (c->>'monto')::int = 1000 and (c->>'pagado')::int = 1000) then
    raise exception 'No se restauraron las cuotas y pagos previos';
  end if;
  perform public.cuotas_registrar_pago(1, 1000, current_date, 'A-2');
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.cuotas_crear_vecino('Otro', '1-9', date_trunc('year', current_date)::date, true);
    raise exception 'Un anónimo pudo crear un vecino exento';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
