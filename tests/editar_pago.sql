-- Ejecutar solo en una base de prueba después de editar_pago.sql.
begin;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000001', 'tesorero@example.invalid'),
  ('00000000-0000-0000-0000-000000000002', 'otro@example.invalid');
insert into cuotas_privado.autorizados values ('00000000-0000-0000-0000-000000000001');
insert into cuotas_privado.vecinos(id, nombre, rut, inicio) overriding system value values
  (1, 'Ana', '11.111.111-1', '2020-01-01'),
  (2, 'Luis', '6.528.355-7', '2020-01-01');
insert into cuotas_privado.pagos(id, vecino_id, monto, fecha, comprobante, historico, creado_por)
overriding system value values
  (10, 1, 2000, null, '123', true, '00000000-0000-0000-0000-000000000001'),
  (11, 2, 1000, null, '123', true, '00000000-0000-0000-0000-000000000001'),
  (12, 1, 1000, '2020-01-05', '124', false, '00000000-0000-0000-0000-000000000001'),
  (13, 1, 1000, null, '125', true, '00000000-0000-0000-0000-000000000001'),
  (14, 1, 1000, null, '126', true, '00000000-0000-0000-0000-000000000001');
insert into cuotas_privado.aplicaciones values
  (10, '2019-12-01', 1000), (10, '2020-01-01', 1000),
  (11, '2020-01-01', 1000), (12, '2020-01-01', 1000);
update cuotas_privado.pagos set anulado_en = now() where id = 13;

set local role anon;
do $$
begin
  begin
    perform public.cuotas_editar_pago(10, null, 2000, '[]', '{}');
    raise exception 'Se permitió editar sin sesión';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$
begin
  begin
    perform public.cuotas_editar_pago(10, null, 2000, '[]', '{}');
    raise exception 'Se permitió editar sin autorización';
  exception when raise_exception then
    if sqlerrm <> 'Usuario no autorizado' then raise; end if;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
declare
  original jsonb := '{"fecha":null,"monto":2000,"aplicaciones":[{"mes":"2019-12-01","monto":1000},{"mes":"2020-01-01","monto":1000}]}';
  nuevo jsonb := '[{"mes":"2021-02-01","monto":2000},{"mes":"2019-12-01","monto":500}]';
begin
  begin
    perform public.cuotas_editar_pago(10, '2020-02-03', 2600, nuevo, original);
    raise exception 'Se aceptó una suma incorrecta';
  exception when raise_exception then
    if sqlerrm <> 'La suma aplicada a los meses debe coincidir con el monto del pago' then raise; end if;
  end;
  begin
    perform public.cuotas_editar_pago(10, null, 2000, '[{"mes":"2020-01-01","monto":1000},{"mes":"2020-01-01","monto":1000}]', original);
    raise exception 'Se aceptó un mes duplicado';
  exception when raise_exception then
    if sqlerrm <> 'No puedes repetir un mes en el mismo pago' then raise; end if;
  end;
  begin
    perform public.cuotas_editar_pago(10, null, 2000, '[{"mes":"2020-13-01","monto":2000}]', original);
    raise exception 'Se aceptó un mes inválido';
  exception when raise_exception then
    if sqlerrm <> 'Ingresa meses y montos aplicados válidos' then raise; end if;
  end;
  perform public.cuotas_editar_pago(10, '2020-02-03', 2500, nuevo, original);
  perform public.cuotas_editar_pago(14, '2020-02-05', 1000, '[]', '{"fecha":null,"monto":1000,"aplicaciones":[]}');
  begin
    perform public.cuotas_editar_pago(10, '2020-02-04', 2500, nuevo, original);
    raise exception 'Se aceptó una edición desactualizada';
  exception when raise_exception then
    if sqlerrm <> 'El pago cambió desde que se abrió. Busca el comprobante nuevamente' then raise; end if;
  end;
  begin
    perform public.cuotas_editar_pago(12, null, 1000, '[]', '{}');
    raise exception 'Se aceptó fecha vacía para pago nuevo';
  exception when raise_exception then
    if sqlerrm <> 'La fecha es obligatoria para pagos no históricos' then raise; end if;
  end;
  begin
    perform public.cuotas_editar_pago(13, null, 1000, '[]', '{}');
    raise exception 'Se aceptó editar un pago anulado';
  exception when raise_exception then
    if sqlerrm <> 'No se puede modificar un pago anulado' then raise; end if;
  end;
end;
$$;
reset role;
do $$
begin
  if not exists (select 1 from cuotas_privado.pagos where id = 10 and monto = 2500 and fecha = '2020-02-03') then
    raise exception 'No se guardó la modificación';
  end if;
  if not exists (select 1 from cuotas_privado.pagos where id = 14 and fecha = '2020-02-05' and monto = 1000)
    or exists (select 1 from cuotas_privado.aplicaciones where pago_id = 14) then
    raise exception 'La corrección de fecha alteró un pago sin aplicaciones';
  end if;
  if (select count(*) from cuotas_privado.aplicaciones where pago_id = 10) <> 2
    or not exists (select 1 from cuotas_privado.aplicaciones where pago_id = 10 and mes = '2021-02-01' and monto = 2000)
    or not exists (select 1 from cuotas_privado.aplicaciones where pago_id = 10 and mes = '2019-12-01' and monto = 500) then
    raise exception 'Las aplicaciones no se actualizaron';
  end if;
  if not exists (select 1 from cuotas_privado.aplicaciones where pago_id = 11 and mes = '2020-01-01' and monto = 1000)
    or not exists (select 1 from cuotas_privado.aplicaciones where pago_id = 12 and mes = '2020-01-01' and monto = 1000) then
    raise exception 'Se alteraron otros pagos';
  end if;
  if (select count(*) from cuotas_privado.ediciones_pagos where pago_id = 10
    and usuario_id = '00000000-0000-0000-0000-000000000001'
    and (antes->>'monto')::integer = 2000 and (despues->>'monto')::integer = 2500) <> 1 then
    raise exception 'No se conservó el registro de modificación';
  end if;
end;
$$;
rollback;
