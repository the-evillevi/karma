import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { filterAuditHistory, projectAuditHistory } from "./audit-history.mjs";

const PAGE_SIZE = 40;

function dateLabel(instant, timeZone) {
  try {
    return new Intl.DateTimeFormat("es-MX", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(instant));
  } catch {
    return "Instante UTC capturado";
  }
}

function safeText(value) {
  return typeof value === "string" ? value : "Sin dato";
}

export default function AuditHistoryPanel({
  inventoryState,
  recipeCatalog,
  inventoryError = "",
  recipeError = "",
  branchTimeZone = "America/Mexico_City",
  canView = false,
}) {
  const [timeZone, setTimeZone] = useState(branchTimeZone || "America/Mexico_City");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [action, setAction] = useState("all");
  const [actorId, setActorId] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [shown, setShown] = useState(PAGE_SIZE);

  const projection = useMemo(() => {
    if (inventoryError || recipeError)
      return { events: [], error: "El historial local requiere revisión. No se muestran cambios." };
    try {
      return { events: projectAuditHistory({ inventoryState, recipeCatalog }), error: "" };
    } catch {
      return { events: [], error: "El historial local requiere revisión. No se muestran cambios." };
    }
  }, [inventoryError, inventoryState, recipeCatalog, recipeError]);

  const filteredResult = useMemo(() => {
    if (projection.error) return { events: [], error: projection.error };
    try {
      return {
        events: filterAuditHistory(projection.events, { from, through, timeZone, entityType, action, actorId }),
        error: "",
      };
    } catch (error) {
      return { events: [], error: error?.code === "invalid_time_zone" ? "La zona horaria no es válida. Escribe una zona IANA reconocida." : "Revisa los filtros del historial." };
    }
  }, [action, actorId, entityType, from, projection, through, timeZone]);

  const events = filteredResult.events;
  const selected = events.find((event) => event.id === selectedId) || events[0] || null;
  const actors = [...new Map(projection.events.map((event) => [event.actorId, { id: event.actorId, name: event.actorName }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, "es-MX") || a.id.localeCompare(b.id));
  const actions = [...new Map(projection.events.map((event) => [event.action, event.actionLabel])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "es-MX"));
  const visible = events.slice(0, shown);
  const resetPage = setter => event => { setter(event.target.value); setShown(PAGE_SIZE); setSelectedId(null); };

  if (!canView) return null;

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Historial de cambios">
      <Card className="gap-2 border-amber-500/40 p-4">
        <h2 className="m-0 text-base font-medium">Historial local de inventario y recetas</h2>
        <p className="m-0 text-sm text-muted-foreground">Vista de solo lectura basada en cambios guardados en esta estación. Cada evento conserva su actor y hora original; las fechas se filtran como calendario local en la zona indicada.</p>
        <p className="m-0 text-sm text-muted-foreground">El modelo actual registra el archivo de artículos y las publicaciones de recetas; no registra eliminaciones de recetas ni eventos de resolución remota.</p>
        <p className="m-0 text-sm text-muted-foreground">Los datos locales no contienen versiones remotas ni confirmaciones de resolución de conflictos. No se muestra ni se promete una resolución que no tenga un evento durable.</p>
      </Card>

      {filteredResult.error ? <Card role="alert" className="border-destructive/40 p-4">{filteredResult.error}</Card> : <>
        <Card className="gap-4 p-4">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="audit-from">Desde (incluida)</Label><Input id="audit-from" type="date" value={from} onChange={resetPage(setFrom)} /></div>
            <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="audit-through">Hasta (incluida)</Label><Input id="audit-through" type="date" value={through} onChange={resetPage(setThrough)} /></div>
            <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="audit-time-zone">Zona horaria IANA</Label><Input id="audit-time-zone" value={timeZone} maxLength={100} onChange={resetPage(setTimeZone)} /></div>
            <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="audit-entity">Entidad</Label><select id="audit-entity" className="h-11 rounded-md border bg-background px-3 text-sm" value={entityType} onChange={resetPage(setEntityType)}><option value="all">Todas</option><option value="inventory">Existencias</option><option value="catalog">Catálogo de insumos</option><option value="recipe">Recetas</option><option value="conflict">Conflicto / resolución</option></select></div>
            <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="audit-action">Acción</Label><select id="audit-action" className="h-11 rounded-md border bg-background px-3 text-sm" value={action} onChange={resetPage(setAction)}><option value="all">Todas</option>{actions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="conflict_resolution">Resolución de conflicto</option></select></div>
            <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="audit-actor">Persona</Label><select id="audit-actor" className="h-11 rounded-md border bg-background px-3 text-sm" value={actorId} onChange={resetPage(setActorId)}><option value="all">Todas</option>{actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></div>
          </div>
          <p className="m-0 text-xs text-muted-foreground">El filtro usa instantes UTC guardados y la fecha de calendario en {timeZone || "la zona seleccionada"}. Las etiquetas históricas sin instante verificable se excluyen; no se reconstruyen a partir de textos de fecha.</p>
          <div className="flex flex-wrap items-center gap-2" role="status"><Badge variant="outline">{events.length} {events.length === 1 ? "cambio" : "cambios"}</Badge><span className="text-xs text-muted-foreground">En orden cronológico, del más reciente al más antiguo.</span></div>
        </Card>

        {entityType === "conflict" || action === "conflict_resolution" ? <Card role="status" className="p-4 text-sm">No hay eventos locales verificables de resolución de conflictos. La resolución durable requiere versiones remotas y registro atómico, aún no disponible en esta estación.</Card> : null}

        {events.length === 0 ? <Card className="p-6 text-center text-sm text-muted-foreground">No hay cambios que coincidan con estos filtros.</Card> : <>
          <div className="text-xs text-muted-foreground lg:hidden">Desliza horizontalmente para revisar evento, responsable y hora →</div>
          <Card className="gap-0 overflow-hidden p-0"><Table containerProps={{ "aria-label": "Cambios locales de inventario y recetas", tabIndex: 0 }} className="min-w-[900px]">
            <TableHeader><TableRow><TableHead>Hora local</TableHead><TableHead>Entidad</TableHead><TableHead>Acción</TableHead><TableHead>Registró</TableHead><TableHead>Origen y estado</TableHead><TableHead>Detalle</TableHead></TableRow></TableHeader>
            <TableBody>{visible.map((event) => <TableRow key={event.id} aria-selected={event.id === selected?.id}>
              <TableCell className="text-muted-foreground">{dateLabel(event.occurredAt, timeZone)}</TableCell>
              <TableCell><span className="font-medium">{safeText(event.entityLabel)}</span><span className="block text-xs text-muted-foreground">{event.entityType === "inventory" ? "Existencias" : event.entityType === "catalog" ? "Catálogo de insumos" : "Receta"} · {safeText(event.entityId)}</span></TableCell>
              <TableCell>{safeText(event.actionLabel)}</TableCell>
              <TableCell>{safeText(event.actorName)}<span className="block text-xs text-muted-foreground">{safeText(event.actorId)}</span></TableCell>
              <TableCell><span>{safeText(event.status)}</span><span className="block text-xs text-muted-foreground">{safeText(event.source)}</span></TableCell>
              <TableCell><Button type="button" size="sm" variant="outline" aria-label={`Ver cambio ${event.actionLabel} · ${event.entityLabel}`} aria-pressed={event.id === selected?.id} onClick={() => setSelectedId(event.id)}>Ver detalle</Button></TableCell>
            </TableRow>)}</TableBody>
          </Table></Card>

          {visible.length < events.length && <Button type="button" variant="outline" className="self-start" onClick={() => setShown((count) => count + PAGE_SIZE)}>Ver siguientes {Math.min(PAGE_SIZE, events.length - visible.length)}</Button>}

          {selected && <Card role="region" aria-label={`Detalle del cambio ${selected.actionLabel} · ${selected.entityLabel}`} className="gap-3 p-4">
            <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><h3 className="m-0 text-base font-medium">{selected.actionLabel} · {selected.entityLabel}</h3><p className="m-0 break-all text-xs text-muted-foreground">Identificador local: {selected.id}</p></div><Badge variant="outline">{selected.status}</Badge></div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Fecha y hora local</dt><dd className="m-0">{dateLabel(selected.occurredAt, timeZone)} · {timeZone}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Responsable original</dt><dd className="m-0">{selected.actorName} · {selected.actorId}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Entidad</dt><dd className="m-0">{selected.entityType} · {selected.entityId}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Fuente registrada</dt><dd className="m-0">{selected.source} · revisión {selected.sourceRevision}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Motivo</dt><dd className="m-0 whitespace-pre-wrap break-words">{selected.reason}</dd></div>
            </dl>
            <div className="text-sm font-medium">Campos antes y después</div>
            <div className="grid min-w-0 gap-2">{selected.changes.map((change, index) => <div key={`${selected.id}:${index}`} className="grid min-w-0 gap-1 rounded-md border p-3 sm:grid-cols-[minmax(160px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
              <strong className="break-words text-sm">{change.field}</strong>
              <div className="min-w-0 break-words text-sm"><span className="mr-1 text-xs text-muted-foreground">Antes:</span>{change.beforeValue}</div>
              <div className="min-w-0 break-words text-sm"><span className="mr-1 text-xs text-muted-foreground">Después:</span>{change.afterValue}</div>
            </div>)}</div>
          </Card>}
        </>}
      </>}
    </section>
  );
}
