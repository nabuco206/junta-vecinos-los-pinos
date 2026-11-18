-- Ejecutar solo en una base de prueba después de redistribuir_pagos.sql.
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000001', 'tesorero@example.invalid');
insert into cuotas_privado.autorizados values ('00000000-0000-0000-0000-000000000001');
insert into cuotas_privado.vecinos(id, nombre, rut, inicio) overriding system value values
  (1, 'Ana', '11.111.111-1', '2018-12-01');
insert into cuotas_privado.aranceles values (2018, 1000), (2021, 1000);
insert into cuotas_privado.pagos(id, vecino_id, monto, fecha, comprobante, historico, creado_por)
overriding system value values
  (10, 1, 1000, '2018-03-01', '10', true, '00000000-0000-0000-0000-000000000001'),
  (11, 1, 1500, '2018-01-01', '2', true, '00000000-0000-0000-0000-000000000001'),
  (12, 1, 500, '2018-02-01', null, true, '00000000-0000-0000-0000-000000000001'),
  (13, 1, 500, null, null, true, '00000000-0000-0000-0000-000000000001'),
  (14, 1, 1000, null, '1', true, '00000000-0000-0000-0000-000000000001');
insert into cuotas_privado.aplicaciones values
  (10, '2019-01-01', 1000), (11, '2018-12-01', 1500),
  (12, '2021-01-01', 500), (13, '2021-02-01', 500), (14, '2018-12-01', 1000);
update cuotas_privado.pagos set anulado_en = now() where id = 14;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
set local role anon;
do $$
begin
  begin
    perform public.cuotas_previsualizar_redistribucion(10, null, 1000, '{}');
    raise exception 'Se permitió consultar sin sesión';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
declare
  original jsonb := '{"fecha":"2018-03-01","monto":1000,"aplicaciones":[{"mes":"2019-01-01","monto":1000}]}';
  vista jsonb;
begin
  vista := public.cuotas_previsualizar_redistribucion(10, '2018-03-01', 1200, original);
  if (select array_agg((v->>'id')::int order by ord)
      from jsonb_array_elements(vista) with ordinality t(v, ord)) <> array[11, 12, 10, 13] then
    raise exception 'Orden incorrecto: %', vista;
  end if;
  if vista->0->'aplicaciones' <> '[{"mes":"2018-12-01","monto":1000},{"mes":"2021-01-01","monto":500}]'::jsonb
    or vista->1->'aplicaciones' <> '[{"mes":"2021-01-01","monto":500}]'::jsonb
    or vista->2->'aplicaciones' <> '[{"mes":"2021-02-01","monto":1000},{"mes":"2021-03-01","monto":200}]'::jsonb
    or vista->3->'aplicaciones' <> '[{"mes":"2021-03-01","monto":500}]'::jsonb then
    raise exception 'Distribución incorrecta: %', vista;
  end if;
  if (public.cuotas_previsualizar_redistribucion(10, '2018-03-01', 300, original)->2->'aplicaciones')
    <> '[{"mes":"2021-02-01","monto":300}]'::jsonb then
    raise exception 'La reducción no se distribuyó correctamente';
  end if;
  begin
    perform public.cuotas_previsualizar_redistribucion(10, '2018-03-01', 20000, original);
    raise exception 'Se aceptó un monto superior a las cuotas';
  exception when raise_exception then
    if sqlerrm not like 'El monto supera las cuotas disponibles%' then raise; end if;
  end;
  update cuotas_privado.pagos set fecha = null where id = 11;
  begin
    perform public.cuotas_previsualizar_redistribucion(10, '2018-03-01', 1200, original);
    raise exception 'Se aceptó una fecha desconocida necesaria para ubicar un pago';
  exception when raise_exception then
    if sqlerrm not like 'Hay comprobantes sin fecha%' then raise; end if;
  end;
  update cuotas_privado.pagos set fecha = '2018-01-01' where id = 11;
  update cuotas_privado.pagos set monto = 600 where id = 13;
  begin
    perform public.cuotas_guardar_redistribucion(10, '2018-03-01', 1200, original, vista);
    raise exception 'Se aceptó una vista obsoleta';
  exception when raise_exception then
    if sqlerrm not like 'Los pagos o cuotas cambiaron%' then raise; end if;
  end;
  update cuotas_privado.pagos set monto = 500 where id = 13;
  update cuotas_privado.pagos set fecha = '2018-04-01' where id = 11;
  begin
    perform public.cuotas_previsualizar_redistribucion(10, '2018-03-01', 1200, original);
    raise exception 'Se aceptaron fechas contradictorias';
  exception when raise_exception then
    if sqlerrm not like 'Las fechas contradicen%' then raise; end if;
  end;
  update cuotas_privado.pagos set fecha = null where id = 12;
  vista := public.cuotas_previsualizar_redistribucion(10, '2018-03-01', 1200, original);
  if (vista->0->>'id')::int <> 11 or (vista->1->>'id')::int <> 10 then
    raise exception 'El orden numérico no prevaleció sobre las fechas';
  end if;
  update cuotas_privado.pagos set fecha = '2018-02-01' where id = 12;
  update cuotas_privado.pagos set fecha = '2018-01-01', comprobante = 'A-2' where id = 11;
  begin
    perform public.cuotas_previsualizar_redistribucion(10, '2018-03-01', 1200, original);
    raise exception 'Se aceptó comprobante no numérico';
  exception when raise_exception then
    if sqlerrm not like 'Hay comprobantes que no son numéricos%' then raise; end if;
  end;
  update cuotas_privado.pagos set comprobante = '010' where id = 11;
  begin
    perform public.cuotas_previsualizar_redistribucion(10, '2018-03-01', 1200, original);
    raise exception 'Se aceptó comprobante repetido';
  exception when raise_exception then
    if sqlerrm not like 'Hay comprobantes repetidos%' then raise; end if;
  end;
  update cuotas_privado.pagos set comprobante = '2' where id = 11;
  vista := public.cuotas_previsualizar_redistribucion(10, '2018-03-01', 1200, original);
  perform public.cuotas_guardar_redistribucion(10, '2018-03-01', 1200, original, vista);
  if (select monto from cuotas_privado.pagos where id = 10) <> 1200
    or exists (select 1 from cuotas_privado.aplicaciones where pago_id = 10 and mes = '2019-01-01')
    or (select count(*) from cuotas_privado.ediciones_pagos) <> 3 then
    raise exception 'La redistribución no se guardó correctamente';
  end if;
  if not exists (select 1 from cuotas_privado.aplicaciones where pago_id = 14 and mes = '2018-12-01') then
    raise exception 'Se alteró un pago anulado';
  end if;
end;
$$;
rollback;
