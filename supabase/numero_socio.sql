-- Ejecutar después de exencion_cuotas.sql.
begin;

alter table cuotas_privado.vecinos
  add column if not exists numero_socio text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vecinos_numero_socio_formato'
      and conrelid = 'cuotas_privado.vecinos'::regclass
  ) then
    alter table cuotas_privado.vecinos
      add constraint vecinos_numero_socio_formato
      check (numero_socio is null or numero_socio ~ '^[0-9]{1,30}$');
  end if;
end;
$$;

create unique index if not exists vecinos_numero_socio_unico
  on cuotas_privado.vecinos (numero_socio)
  where numero_socio is not null;

create or replace function public.cuotas_crear_vecino(
  p_nombre text, p_rut text, p_inicio date, p_no_paga_cuota boolean, p_numero_socio text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_numero_socio text := nullif(btrim(p_numero_socio), '');
  v_constraint text;
begin
  perform cuotas_privado.verificar_acceso();
  if v_numero_socio is not null and v_numero_socio !~ '^[0-9]{1,30}$' then
    raise exception 'El número de socio debe contener entre 1 y 30 dígitos';
  end if;
  perform public.cuotas_crear_vecino(p_nombre, p_rut, p_inicio, p_no_paga_cuota);
  update cuotas_privado.vecinos set numero_socio = v_numero_socio where rut = btrim(p_rut);
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'vecinos_numero_socio_unico' then
    raise exception 'Ya existe un vecino con ese número de socio';
  end if;
  raise;
end;
$$;

create or replace function public.cuotas_editar_vecino(
  p_vecino bigint, p_nombre text, p_rut text, p_inicio date, p_no_paga_cuota boolean, p_numero_socio text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_numero_socio text := nullif(btrim(p_numero_socio), '');
  v_constraint text;
begin
  perform cuotas_privado.verificar_acceso();
  if v_numero_socio is not null and v_numero_socio !~ '^[0-9]{1,30}$' then
    raise exception 'El número de socio debe contener entre 1 y 30 dígitos';
  end if;
  perform public.cuotas_editar_vecino(p_vecino, p_nombre, p_rut, p_inicio, p_no_paga_cuota);
  update cuotas_privado.vecinos set numero_socio = v_numero_socio where id = p_vecino;
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'vecinos_numero_socio_unico' then
    raise exception 'Ya existe un vecino con ese número de socio';
  end if;
  raise;
end;
$$;

revoke all on function public.cuotas_crear_vecino(text, text, date, boolean, text) from public, anon;
revoke all on function public.cuotas_editar_vecino(bigint, text, text, date, boolean, text) from public, anon;
grant execute on function public.cuotas_crear_vecino(text, text, date, boolean, text) to authenticated;
grant execute on function public.cuotas_editar_vecino(bigint, text, text, date, boolean, text) to authenticated;

notify pgrst, 'reload schema';

commit;
