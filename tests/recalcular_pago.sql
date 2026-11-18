-- Ejecutar solo en una base de prueba después de recalcular_pago.sql.
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000001', 'tesorero@example.invalid');
insert into cuotas_privado.autorizados values ('00000000-0000-0000-0000-000000000001');
insert into cuotas_privado.vecinos(id, nombre, rut, inicio) overriding system value values
  (1, 'Ana', '11.111.111-1', '2018-12-01');
insert into cuotas_privado.aranceles values (2018, 1000), (2021, 1000), (2023, 1000);
insert into cuotas_privado.pagos(id, vecino_id, monto, fecha, comprobante, historico, creado_por)
overriding system value values
  (10, 1, 2000, null, '10', true, '00000000-0000-0000-0000-000000000001'),
  (11, 1, 1500, null, '11', true, '00000000-0000-0000-0000-000000000001'),
  (12, 1, 1000, null, '12', true, '00000000-0000-0000-0000-000000000001'),
  (13, 1, 1000, null, '13', true, '00000000-0000-0000-0000-000000000001');
insert into cuotas_privado.aplicaciones values
  (10, '2018-12-01', 1000), (10, '2021-01-01', 1000),
  (11, '2021-01-01', 1000), (11, '2021-02-01', 500),
  (12, '2021-03-01', 1000);
update cuotas_privado.pagos set anulado_en = now() where id = 12;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
set local role anon;
do $$
begin
  begin
    perform public.cuotas_previsualizar_edicion_pago(10, 500, '{}');
    raise exception 'Se permitió consultar sin sesión';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
declare
  original jsonb := '{"fecha":null,"monto":2000,"aplicaciones":[{"mes":"2018-12-01","monto":1000},{"mes":"2021-01-01","monto":1000}]}';
  vista jsonb;
begin
  vista := public.cuotas_previsualizar_edicion_pago(10, 2200, original);
  if vista <> '[{"mes":"2018-12-01","monto":1000},{"mes":"2021-02-01","monto":500},{"mes":"2021-03-01","monto":700}]'::jsonb then
    raise exception 'Distribución incorrecta: %', vista;
  end if;
  if public.cuotas_previsualizar_edicion_pago(10, 500, original)
    <> '[{"mes":"2018-12-01","monto":500}]'::jsonb then
    raise exception 'No se redujeron las cuotas correctamente';
  end if;
  begin
    perform public.cuotas_previsualizar_edicion_pago(13, 2000, '{"fecha":null,"monto":1000,"aplicaciones":[]}');
    raise exception 'Se aceptó un pago sin meses';
  exception when raise_exception then
    if sqlerrm not like 'El pago no tiene meses asignados%' then raise; end if;
  end;
  begin
    perform public.cuotas_previsualizar_edicion_pago(10, 20000, original);
    raise exception 'Se aceptó un año faltante';
  exception when raise_exception then
    if sqlerrm not like 'Falta configurar el monto del año 2022%' then raise; end if;
  end;
  insert into cuotas_privado.aranceles values (2022, 1000);
  begin
    perform public.cuotas_previsualizar_edicion_pago(10, 100000, original);
    raise exception 'Se aceptó un monto superior a las cuotas';
  exception when raise_exception then
    if sqlerrm not like 'El monto supera las cuotas disponibles%' then raise; end if;
  end;
  update cuotas_privado.aplicaciones set monto = 700 where pago_id = 11 and mes = '2021-02-01';
  begin
    perform public.cuotas_guardar_edicion_automatica(10, null, 2200, original, vista);
    raise exception 'Se aceptó una vista obsoleta';
  exception when raise_exception then
    if sqlerrm not like 'Las cuotas o pagos cambiaron%' then raise; end if;
  end;
  vista := public.cuotas_previsualizar_edicion_pago(10, 2200, original);
  perform public.cuotas_guardar_edicion_automatica(10, null, 2200, original, vista);
  if (select monto from cuotas_privado.pagos where id = 10) <> 2200 then raise exception 'No se guardó'; end if;
  begin
    perform public.cuotas_previsualizar_edicion_pago(10, 500, original);
    raise exception 'Se aceptó un original obsoleto';
  exception when raise_exception then
    if sqlerrm not like 'El pago cambió%' then raise; end if;
  end;
end;
$$;
rollback;
