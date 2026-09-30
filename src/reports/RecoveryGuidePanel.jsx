import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function RecoveryGuidePanel({
  canView = false,
  demoMode = false,
  online = false,
  localSaveStatus = 'unknown',
  pendingEvidence = null,
  onOpenSalesReport = () => {},
}) {
  if (!canView) return null;

  const saveLabel = localSaveStatus === 'saved'
    ? 'El último intento de guardado en este navegador terminó correctamente.'
    : localSaveStatus === 'failed'
      ? 'El último intento de guardado en este navegador falló. Revisa antes de repetir cualquier operación.'
      : 'Aún no hay resultado de guardado observado en esta sesión.';
  const evidenceLabel = Array.isArray(pendingEvidence)
    ? demoMode
      ? `${pendingEvidence.length} ${pendingEvidence.length === 1 ? 'etiqueta' : 'etiquetas'} de demostración; no representan comandos enviados a un servidor.`
      : `${pendingEvidence.length} ${pendingEvidence.length === 1 ? 'etiqueta heredada local' : 'etiquetas heredadas locales'} sin acuse verificable; no se pueden reintentar desde aquí.`
    : 'Las etiquetas heredadas locales no tienen un formato verificable; no se pueden reintentar desde aquí.';

  return (
    <Card role="region" className="gap-3 border-amber-500/40 p-4" aria-label="Estado local y recuperación">
      <h2 className="m-0 text-base font-medium">Estado local y recuperación</h2>
      <p className="m-0 text-sm text-muted-foreground">
        {demoMode
          ? 'Modo Demo: los datos y la conectividad son de prueba. No se contacta ningún servidor.'
          : 'Esta estación usa guardado local del navegador. La red del dispositivo está ' + (online ? 'disponible' : 'sin conexión') + ', pero la recepción del servidor POS es desconocida.'}
      </p>
      <p className="m-0 text-sm text-muted-foreground">{saveLabel}</p>
      <p className="m-0 text-sm text-muted-foreground">{evidenceLabel}</p>
      <div className="grid gap-2 rounded-md bg-muted p-3 text-sm">
        <strong>Respaldo y recuperación</strong>
        <span>No se crea un respaldo automático ni se conserva una retención programada.</span>
        <span>El CSV de Reportes contiene ventas y hechos financieros disponibles para el periodo; no restaura cuentas abiertas, inventario, configuración, usuarios ni el diario operativo.</span>
        <span>La recuperación completa en este dispositivo aún no está disponible. No importes un CSV como si fuera una copia restaurable.</span>
      </div>
      <p className="m-0 text-sm text-muted-foreground">Si no sabes si un cobro quedó registrado, consulta primero el estado de esta estación y el reporte antes de intentar cobrar otra vez.</p>
      <Button type="button" variant="outline" className="self-start" onClick={onOpenSalesReport}>
        Abrir Reportes y exportar CSV
      </Button>
    </Card>
  );
}
