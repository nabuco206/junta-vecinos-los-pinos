-- Ejecutar solo en una base de prueba después de pagos_historicos.sql.
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000001', 'tesorero@example.invalid');
insert into cuotas_privado.autorizados values ('00000000-0000-0000-0000-000000000001');
insert into cuotas_privado.vecinos(id, nombre, rut, inicio) overriding system value values
  (1, 'Ana', '11.111.111-1', '2020-01-01'),
  (2, 'Luis', '6.528.355-7', '2020-01-01');
insert into cuotas_privado.aranceles(anio, monto) values (2020, 1000);
insert into cuotas_privado.pagos(id, vecino_id, monto, fecha, comprobante, historico, creado_por)
overriding system value values
  (10, 1, 2000, null, '123', true, '00000000-0000-0000-0000-000000000001'),
  (11, 2, 1000, null, '123', true, '00000000-0000-0000-0000-000000000001');
insert into cuotas_privado.aplicaciones values (10, '2019-12-01', 1000), (10, '2020-01-01', 1000), (11, '2020-01-01', 1000);
select setval(pg_get_serial_sequence('cuotas_privado.pagos', 'id'), 11);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.cuotas_cambiar_clave_portal('clave-prueba');
do $$
declare resultado jsonb;
begin
  resultado := public.cuotas_historial_vecino(1);
  if jsonb_array_length(resultado) <> 1 or resultado->0->'fecha' <> 'null'::jsonb then
    raise exception 'La fecha desconocida no aparece en el historial: %', resultado;
  end if;
  resultado := public.vecino_mis_cuotas(2019, '111111111', 'clave-prueba');
  if (resultado->>'anio_inicio')::int <> 2019 or jsonb_array_length(resultado->'pagos') <> 1
    or resultado->'pagos'->0->'fecha' <> 'null'::jsonb then
    raise exception 'No se muestran los pagos anteriores al inicio: %', resultado;
  end if;
  resultado := public.vecino_mis_cuotas(2020, '111111111', 'clave-prueba');
  if (resultado->'cuotas'->0->>'pagado')::int <> 1000 then
    raise exception 'No se aplicó el pago histórico a la cuota: %', resultado;
  end if;
  perform public.cuotas_registrar_pago(1, 1000, '2020-02-01', '123');
  begin
    perform public.cuotas_registrar_pago(2, 1000, '2020-02-01', '123');
    raise exception 'Se permitió repetir comprobantes entre pagos nuevos';
  exception when raise_exception then
    if sqlerrm <> 'El número de comprobante ya está registrado en otro pago' then raise; end if;
  end;
end;
$$;
reset role;
do $$
begin
  begin
    insert into cuotas_privado.pagos(vecino_id, monto, fecha, creado_por)
    values (1, 1000, null, '00000000-0000-0000-0000-000000000001');
    raise exception 'Se permitió un pago nuevo sin fecha';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
