-- Ejecutar solo en una base de prueba después de instalar los scripts.
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000001', 'tesorero@example.invalid');
insert into cuotas_privado.autorizados(usuario_id) values ('00000000-0000-0000-0000-000000000001');
insert into cuotas_privado.vecinos(id, nombre, rut, inicio) overriding system value
values (1, 'Ana', '11.111.111-1', '2018-12-01');
insert into cuotas_privado.aranceles(anio, monto)
select anio, 1000 from generate_series(2018, extract(year from current_date)::int) as years(anio)
where anio not in (2019, 2020);
insert into cuotas_privado.pagos(id, vecino_id, monto, fecha, creado_por, comprobante, historico)
overriding system value values (10, 1, 1000, null, '00000000-0000-0000-0000-000000000001', 'ANTIGUO', true);
insert into cuotas_privado.aplicaciones values (10, '2019-01-01', 1000);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.cuotas_cambiar_clave_portal('clave-prueba');
select public.cuotas_registrar_pago(1, 2000, current_date, 'NUEVO');

do $$
declare datos jsonb; portal jsonb; esperado bigint; original jsonb;
begin
  datos := public.cuotas_datos(2019);
  if exists (select 1 from jsonb_array_elements(datos->'cuotas') c where (c->>'monto')::integer <> 0) then
    raise exception 'La tesorería muestra deuda en 2019';
  end if;
  datos := public.cuotas_datos(2020);
  if exists (select 1 from jsonb_array_elements(datos->'cuotas') c where (c->>'monto')::integer <> 0) then
    raise exception 'La tesorería muestra deuda en 2020';
  end if;
  portal := public.vecino_mis_cuotas(extract(year from current_date)::int, '111111111', 'clave-prueba');
  if not (portal->>'configuracion_completa')::boolean then raise exception 'Años no cobrados exigen configuración'; end if;
  if not exists (
    select 1 from jsonb_array_elements(portal->'cuotas') c
    where c->>'mes' = '2019-01-01' and (c->>'no_cobrado')::boolean
      and (c->>'monto')::int = 0 and (c->>'pagado')::int = 1000
      and c->'comprobantes' = '["ANTIGUO"]'::jsonb
  ) then raise exception 'No se conservó el pago de un mes no cobrado'; end if;
  if not exists (
    select 1 from jsonb_array_elements(portal->'cuotas') c
    where c->>'mes' = '2020-12-01' and (c->>'no_cobrado')::boolean and (c->>'monto')::int = 0
  ) then raise exception 'No se marcó 2020 como no cobrado'; end if;
  select count(*) * 1000 into esperado
    from generate_series('2018-12-01'::timestamp, date_trunc('month', current_date)::timestamp, interval '1 month') m
    where extract(year from m) not in (2019, 2020);
  if (portal->>'deuda_hasta_hoy')::bigint <> esperado - 2000 then
    raise exception 'La deuda incluye meses no cobrados';
  end if;
  if not exists (select 1 from cuotas_privado.aplicaciones where mes = '2018-12-01' and monto = 1000)
    or not exists (select 1 from cuotas_privado.aplicaciones where mes = '2021-01-01' and monto = 1000)
    or (select count(*) from cuotas_privado.aplicaciones where mes between '2019-01-01' and '2020-12-01') <> 1 then
    raise exception 'El pago automático no omitió años no cobrados';
  end if;
  original := jsonb_build_object('fecha', null, 'monto', 1000,
    'aplicaciones', jsonb_build_array(jsonb_build_object('mes', '2019-01-01', 'monto', 1000)));
  perform public.cuotas_editar_pago(10, '2021-01-01', 1000, original->'aplicaciones', original);
  original := jsonb_set(original, '{fecha}', '"2021-01-01"');
  begin
    perform public.cuotas_editar_pago(10, '2021-01-01', 1500,
      '[{"mes":"2019-01-01","monto":1500}]'::jsonb, original);
    raise exception 'Se permitió aumentar el pago de un mes no cobrado';
  exception when raise_exception then
    if sqlerrm <> 'No se pueden agregar pagos a meses no cobrados de 2019 y 2020' then raise; end if;
  end;
end;
$$;
rollback;
