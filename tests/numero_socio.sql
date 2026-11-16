-- Ejecutar solo en una base de prueba después de instalar los scripts.
begin;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000001', 'tesorero@example.invalid');
insert into cuotas_privado.autorizados values ('00000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.cuotas_crear_vecino('Ana', '12.345.678-K', '2026-01-01', false, '0012');
select public.cuotas_crear_vecino('Luis', '11.111.111-1', '2026-01-01', false, null);
reset role;
select set_config('test.ana_id', (select id::text from cuotas_privado.vecinos where rut = '12.345.678-K'), true);
select set_config('test.luis_id', (select id::text from cuotas_privado.vecinos where rut = '11.111.111-1'), true);
set local role authenticated;
select public.cuotas_editar_vecino(current_setting('test.ana_id')::bigint, 'Ana', '12.345.678-K', '2026-01-01', false, '34');

do $$
declare v_ana bigint;
begin
  v_ana := current_setting('test.ana_id')::bigint;
  begin
    perform public.cuotas_editar_vecino(v_ana, 'Ana', '12.345.678-K', '2026-01-01', false, '0012');
    perform public.cuotas_editar_vecino(
      current_setting('test.luis_id')::bigint,
      'Luis', '11.111.111-1', '2026-01-01', false, '0012'
    );
    raise exception 'Se permitió repetir un número de socio';
  exception when raise_exception then
    if sqlerrm <> 'Ya existe un vecino con ese número de socio' then raise; end if;
  end;
  begin
    perform public.cuotas_editar_vecino(v_ana, 'Ana', '12.345.678-K', '2026-01-01', false, 'socio-1');
    raise exception 'Se permitió un número de socio no numérico';
  exception when raise_exception then
    if sqlerrm <> 'El número de socio debe contener entre 1 y 30 dígitos' then raise; end if;
  end;
end;
$$;

reset role;
do $$
begin
  if not exists (
    select 1 from cuotas_privado.vecinos
    where id = current_setting('test.ana_id')::bigint and numero_socio = '34'
  ) then raise exception 'El número de socio no se guardó al modificar'; end if;
  if not exists (
    select 1 from cuotas_privado.vecinos
    where id = current_setting('test.luis_id')::bigint and numero_socio is null
  ) then raise exception 'El número de socio debe ser opcional'; end if;
end;
$$;

rollback;
