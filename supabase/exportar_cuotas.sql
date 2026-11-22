-- Ejecutar después de numero_socio.sql y pagos_historicos.sql.
begin;

create or replace function public.cuotas_exportar_cuotas() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare resultado jsonb;
begin
  perform cuotas_privado.verificar_acceso();
  select jsonb_build_object(
    'vecinos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'nombre', v.nombre, 'rut', v.rut,
        'numero_socio', v.numero_socio, 'inicio', v.inicio,
        'no_paga_cuota', v.no_paga_cuota
      ) order by v.nombre, v.id)
      from cuotas_privado.vecinos v
    ), '[]'::jsonb),
    'pagos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'vecino_id', p.vecino_id, 'comprobante', p.comprobante,
        'fecha', p.fecha, 'monto', p.monto, 'anulado_en', p.anulado_en,
        'aplicaciones', coalesce((
          select jsonb_agg(jsonb_build_object('mes', ap.mes, 'monto', ap.monto) order by ap.mes)
          from cuotas_privado.aplicaciones ap where ap.pago_id = p.id
        ), '[]'::jsonb)
      ) order by p.vecino_id, p.id)
      from cuotas_privado.pagos p
    ), '[]'::jsonb)
  ) into resultado;
  return resultado;
end;
$$;

revoke all on function public.cuotas_exportar_cuotas() from public, anon;
grant execute on function public.cuotas_exportar_cuotas() to authenticated;
notify pgrst, 'reload schema';
commit;
