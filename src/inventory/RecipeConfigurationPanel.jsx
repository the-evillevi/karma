import React, { useEffect, useMemo, useState } from 'react';
import productCatalog from '../../catalog/catalog.json';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { previewRecipePublication } from './recipe-ledger.mjs';
import { formatBaseUnits } from './inventory-ledger.mjs';

const blankLine = () => ({ itemId: '', quantityText: '', unit: 'g' });

function mappedLine(line) {
  return { itemId: line.itemId, quantityText: line.quantityText, unit: line.unitSnapshot };
}

function recipeErrorMessage(error) {
  const messages = new Map([
    ['invalid_recipe_catalog', 'El historial de recetas requiere revisión. No se hicieron cambios.'],
    ['invalid_product_catalog', 'El catálogo del menú requiere revisión.'],
    ['invalid_inventory', 'El historial de inventario requiere revisión.'],
    ['unknown_product', 'El producto seleccionado ya no existe en el catálogo.'],
    ['inactive_product', 'El producto está inactivo y no acepta cambios de receta.'],
    ['unknown_item', 'Selecciona un artículo de inventario existente.'],
    ['archived_item', 'El artículo archivado no se puede asignar a una receta.'],
    ['item_kind_mismatch', 'El tipo de artículo no corresponde con esta receta.'],
    ['unit_mismatch', 'La unidad debe corresponder con la unidad base del artículo.'],
    ['invalid_quantity', 'Captura una cantidad positiva con hasta tres decimales.'],
    ['fractional_base_unit', 'La cantidad debe respetar la unidad mínima del inventario.'],
    ['unsafe_quantity', 'La cantidad excede el rango seguro.'],
    ['duplicate_item', 'Cada artículo puede aparecer una sola vez en la receta base.'],
    ['modifier_not_configured', 'El modificador debe pertenecer a este producto y seguir activo.'],
    ['invalid_substitution', 'Una sustitución debe retirar un ingrediente que ya esté en la receta base.'],
    ['ambiguous_substitution', 'Para una sustitución, el grupo debe permitir elegir una sola opción.'],
    ['incomplete_recipe', 'Agrega todos los artículos y cantidades de la receta antes de publicar.'],
    ['stale_source_revision', 'Cambió el catálogo o el inventario. Actualiza la configuración antes de publicar.'],
    ['stale_recipe_revision', 'Otra persona publicó una versión nueva. Actualiza la configuración antes de continuar.'],
    ['stale_preview', 'La vista previa quedó desactualizada. Revísala de nuevo antes de publicar.'],
    ['command_conflict', 'Este identificador ya se usó para otros datos. Actualiza la configuración antes de continuar.'],
    ['not_authorized', 'Tu acceso actual no permite publicar cambios de receta.'],
  ]);
  return messages.get(error?.code) || 'No se pudo preparar la receta. Revisa los campos e intenta de nuevo.';
}

function makeEditor(product, saved, recipeCatalog, productCatalog, inventoryState, actorKey, createCommandId) {
  const savedEffects = new Map((saved?.modifierEffects || []).map(effect => [`${effect.groupId}\u0000${effect.optionId}`, effect]));
  const modifierRows = [];
  for (const groupId of product.modifierGroupIds) {
    const group = productCatalog.modifierGroups.find(candidate => candidate.id === groupId && candidate.active);
    for (const option of group?.options.filter(candidate => candidate.active) || []) {
      const prior = savedEffects.get(`${group.id}\u0000${option.id}`);
      modifierRows.push({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        effect: prior?.effect || '',
        remove: prior?.remove.map(mappedLine) || [],
        add: prior?.add.map(mappedLine) || [],
      });
    }
  }
  return {
    productId: product.id,
    expectedRecipeCatalogRevision: recipeCatalog.revision,
    expectedRecipeRevision: saved?.recipeRevision || 0,
    expectedProductCatalogRevision: productCatalog.revision,
    expectedInventoryRevision: inventoryState.revision,
    expectedInventoryCatalogRevision: inventoryState.catalogRevision ?? 0,
    actorKey,
    commandId: createCommandId(),
    occurredAt: new Date().toISOString(),
    mode: saved?.mode || '',
    evidence: saved?.evidence || '',
    reason: '',
    items: saved?.items.map(mappedLine) || [blankLine()],
    finishedGood: saved?.finishedGood ? mappedLine(saved.finishedGood) : blankLine(),
    modifierRows,
    previewAcknowledged: false,
  };
}

function draftFromEditor(editor) {
  return {
    mode: editor.mode,
    evidence: editor.evidence.trim(),
    items: editor.mode === 'recipe' ? editor.items : [],
    finishedGood: editor.mode === 'piece' ? editor.finishedGood : null,
    modifierEffects: ['recipe', 'piece'].includes(editor.mode)
      ? editor.modifierRows.filter(row => row.effect).map(row => ({
          groupId: row.groupId,
          optionId: row.optionId,
          effect: row.effect,
          remove: row.effect === 'substitute' ? row.remove : [],
          add: ['add', 'substitute'].includes(row.effect) ? row.add : [],
        }))
      : [],
  };
}

function LineEditor({ id, label, line, inventoryItems, itemKinds, onChange, onRemove, removable = true }) {
  const candidates = inventoryItems.filter(item => itemKinds.includes(item.kind));
  const selected = candidates.find(item => item.itemId === line.itemId);
  const unitOptions = selected?.baseUnit === 'g' ? ['g', 'kg']
    : selected?.baseUnit === 'ml' ? ['ml', 'L']
      : selected?.baseUnit === 'pz' ? ['pz'] : [];
  return (
    <div className="grid min-w-0 gap-2 rounded-md border p-3 sm:grid-cols-[minmax(150px,1.3fr)_minmax(100px,.7fr)_minmax(90px,.5fr)_auto] sm:items-end">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={`${id}-item`}>{label}</Label>
        <select id={`${id}-item`} aria-label={label} className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm" value={line.itemId} onChange={event => {
          const item = candidates.find(candidate => candidate.itemId === event.target.value);
          onChange({ ...line, itemId: item?.itemId || '', unit: item?.displayUnit || line.unit });
        }}>
          <option value="">Selecciona artículo por nombre e ID</option>
          {candidates.map(item => <option key={item.itemId} value={item.itemId} disabled={item.archived}>
            {item.name} · {item.itemId} · {item.baseUnit}{item.archived ? ' · archivado' : ''}
          </option>)}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={`${id}-quantity`}>Cantidad</Label>
        <Input id={`${id}-quantity`} aria-label={`${label} cantidad`} inputMode="decimal" maxLength={32} value={line.quantityText} onChange={event => onChange({ ...line, quantityText: event.target.value })} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={`${id}-unit`}>Unidad</Label>
        <select id={`${id}-unit`} aria-label={`${label} unidad`} className="h-10 rounded-md border bg-background px-3 text-sm" value={line.unit} onChange={event => onChange({ ...line, unit: event.target.value })} disabled={!selected}>
          {unitOptions.map(unit => <option key={unit} value={unit}>{unit}</option>)}
        </select>
      </div>
      {removable && <Button type="button" size="sm" variant="outline" aria-label={`Quitar ${label}`} className="min-h-10" onClick={onRemove}>Quitar</Button>}
    </div>
  );
}

export default function RecipeConfigurationPanel({ inventoryState, recipeCatalog, canManage, actorKey = '', storageError = '', createCommandId, onPublish, onEditingChange }) {
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const isEditing = !!editor;
  useEffect(() => {
    onEditingChange?.(isEditing);
    return () => { if (isEditing) onEditingChange?.(false); };
  }, [isEditing, onEditingChange]);
  const products = useMemo(() => productCatalog.products.filter(product => product.active && (
    !search || product.name.toLocaleLowerCase('es-MX').includes(search.toLocaleLowerCase('es-MX')) || product.id.toLocaleLowerCase('es-MX').includes(search.toLocaleLowerCase('es-MX'))
  )), [productCatalog, search]);
  const recipeByProduct = new Map((recipeCatalog?.recipes || []).map(recipe => [recipe.productId, recipe]));
  const sourceChanged = !!editor && (
    !recipeCatalog || !inventoryState ||
    recipeCatalog.revision !== editor.expectedRecipeCatalogRevision ||
    productCatalog.revision !== editor.expectedProductCatalogRevision ||
    inventoryState.revision !== editor.expectedInventoryRevision ||
    (inventoryState.catalogRevision ?? 0) !== editor.expectedInventoryCatalogRevision ||
    (recipeByProduct.get(editor.productId)?.recipeRevision || 0) !== editor.expectedRecipeRevision
  );
  const authorityChanged = !!editor && editor.actorKey !== actorKey;
  let preview = null;
  let previewError = '';
  let draft = null;
  if (editor && recipeCatalog && inventoryState && !sourceChanged) {
    try {
      draft = draftFromEditor(editor);
      preview = previewRecipePublication(recipeCatalog, productCatalog, inventoryState, editor.productId, draft);
    } catch (error) {
      previewError = recipeErrorMessage(error);
    }
  }
  const updateEditor = updater => {
    setEditor(current => {
      if (!current) return current;
      const updated = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      return { ...updated, commandId: createCommandId(), occurredAt: new Date().toISOString(), previewAcknowledged: false };
    });
    setSaveError('');
  };
  const openEditor = product => {
    if (!canManage || !inventoryState || !recipeCatalog || storageError) return;
    setEditor(makeEditor(product, recipeByProduct.get(product.id), recipeCatalog, productCatalog, inventoryState, actorKey, createCommandId));
    setSaveError('');
  };
  const inventoryItems = inventoryState?.items || [];
  const updateLine = (collection, index, value) => updateEditor(current => ({
    ...current,
    [collection]: current[collection].map((line, lineIndex) => lineIndex === index ? value : line),
  }));
  const updateModifierLine = (index, which, lineIndex, value) => updateEditor(current => ({
    ...current,
    modifierRows: current.modifierRows.map((row, rowIndex) => rowIndex === index ? { ...row, [which]: row[which].map((line, currentIndex) => currentIndex === lineIndex ? value : line) } : row),
  }));
  const addModifierLine = (index, which) => updateEditor(current => ({
    ...current,
    modifierRows: current.modifierRows.map((row, rowIndex) => rowIndex === index ? { ...row, [which]: [...row[which], blankLine()] } : row),
  }));
  const removeModifierLine = (index, which, lineIndex) => updateEditor(current => ({
    ...current,
    modifierRows: current.modifierRows.map((row, rowIndex) => rowIndex === index ? { ...row, [which]: row[which].filter((_line, currentIndex) => currentIndex !== lineIndex) } : row),
  }));
  const save = async () => {
    if (!editor || !preview || sourceChanged || authorityChanged || !editor.previewAcknowledged || !canManage || !onPublish) return;
    setSaving(true);
    setSaveError('');
    const command = {
      commandId: editor.commandId,
      occurredAt: editor.occurredAt,
      productId: editor.productId,
      expectedRecipeCatalogRevision: editor.expectedRecipeCatalogRevision,
      expectedRecipeRevision: editor.expectedRecipeRevision,
      expectedProductCatalogRevision: editor.expectedProductCatalogRevision,
      expectedInventoryRevision: editor.expectedInventoryRevision,
      expectedInventoryCatalogRevision: editor.expectedInventoryCatalogRevision,
      reason: editor.reason.trim(),
      draft,
      preview,
    };
    try {
      const result = await onPublish(command);
      if (result?.ok) setEditor(null);
      else setSaveError(result?.message || 'No se pudo guardar la receta. Revisa el historial e intenta de nuevo.');
    } catch {
      setSaveError('No se pudo guardar la receta. Revisa el historial e intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };
  const product = editor ? productCatalog.products.find(item => item.id === editor.productId) : null;
  const groups = product ? product.modifierGroupIds.map(id => productCatalog.modifierGroups.find(group => group.id === id && group.active)).filter(Boolean) : [];
  const productHistory = product && recipeCatalog
    ? recipeCatalog.events.filter(event => event.command.productId === product.id).slice(-10).reverse()
    : [];
  const catalogStatus = productCatalog.importGate.readyForValidatedBusinessUse ? 'Origen del catálogo validado' : 'Catálogo de productos sin validar · los nombres no se usan para asignar ingredientes';

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">Recetas y productos terminados</div>
            <p role="note" className="mb-0 mt-1 max-w-3xl text-xs text-muted-foreground">{catalogStatus}. Elige cada producto e ingrediente por su identificador. Los datos de demostración no representan existencias físicas ni activan descuentos automáticos.</p>
          </div>
          <Badge variant="outline">Guardado local</Badge>
        </div>
        {storageError && <p role="alert" className="m-0 text-sm text-destructive">{storageError}</p>}
        {!inventoryState && <p role="alert" className="m-0 text-sm text-destructive">El historial de inventario no está disponible. No se puede configurar ni publicar una receta.</p>}
        <Label htmlFor="recipe-product-search">Buscar producto</Label>
        <Input id="recipe-product-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre o identificador del catálogo…" />
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {products.map(item => {
            const recipe = recipeByProduct.get(item.id);
            return <div key={item.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{item.name}</div>
                <div className="truncate text-xs text-muted-foreground">{item.id}</div>
                <div className="mt-1 text-xs text-muted-foreground">{recipe ? `Versión de receta ${recipe.recipeRevision}` : `Control declarado: ${item.stockControl.mode} · sin receta publicada`}</div>
              </div>
              <Button type="button" size="sm" variant="outline" disabled={!canManage || !inventoryState || !!storageError} onClick={() => openEditor(item)}>{recipe ? 'Revisar' : 'Configurar'}</Button>
            </div>;
          })}
          {!products.length && <p className="m-0 text-sm text-muted-foreground">No hay productos que coincidan con la búsqueda.</p>}
        </div>
        {!canManage && <p className="m-0 text-xs text-muted-foreground">Solo Dueña o Encargado puede publicar cambios. Los demás roles pueden consultar el estado.</p>}
      </Card>

      {editor && product && <Card className="min-w-0 gap-4 p-4" aria-label={`Editor de receta ${product.name}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="m-0 text-base font-medium">Configurar {product.name}</h2><p className="m-0 mt-1 text-xs text-muted-foreground">Producto {product.id} · los cambios crean una versión nueva y conservan las anteriores.</p></div>
          <Button type="button" variant="ghost" onClick={() => setEditor(null)}>Cerrar</Button>
        </div>
        {productHistory.length > 0 && <section className="flex min-w-0 flex-col gap-2 rounded-md border p-3" aria-label="Historial inmutable de recetas"><div><h3 className="m-0 text-sm font-medium">Historial inmutable · {recipeByProduct.get(product.id)?.recipeRevision} revisiones</h3><p className="m-0 mt-1 text-xs text-muted-foreground">Solo lectura. Cada cambio crea una versión nueva y conserva los ingredientes originales de esa fecha.</p></div>{productHistory.map(event => <div key={event.command.commandId} className="flex min-w-0 flex-col gap-1 border-t pt-2 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong>Versión {event.recipeRevision} · {event.after.mode === 'recipe' ? 'Receta de ingredientes' : event.after.mode === 'piece' ? 'Producto terminado' : 'Sin control'}</strong><span className="text-muted-foreground">{new Date(event.command.occurredAt).toLocaleString('es-MX')}</span></div><span>{event.command.actorName} · {event.command.roleSnapshot} · {event.command.reason}</span><span>Referencia revisada: {event.after.evidence}</span><span className="text-muted-foreground">{event.after.mode === 'recipe' ? event.after.items.map(line => `${line.itemNameSnapshot} ${line.quantityText} ${line.unitSnapshot}`).join(' · ') : event.after.finishedGood ? `${event.after.finishedGood.itemNameSnapshot} ${event.after.finishedGood.quantityText} ${event.after.finishedGood.unitSnapshot}` : 'Sin descuento de existencias'}</span></div>)}</section>}
        {sourceChanged && <p role="alert" className="m-0 rounded-md border border-destructive/40 p-3 text-sm">Cambió el catálogo, inventario o receta mientras editabas. Cierra y vuelve a abrir la configuración para ver la versión actual.</p>}
        {authorityChanged && <p role="alert" className="m-0 rounded-md border border-destructive/40 p-3 text-sm">Cambió la identidad o el rol durante la edición. Cierra y vuelve a abrir para registrar la autorización actual.</p>}
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5"><Label htmlFor="recipe-control-mode">Control de inventario</Label><select id="recipe-control-mode" className="h-10 rounded-md border bg-background px-3 text-sm" value={editor.mode} onChange={event => updateEditor(current => ({ ...current, mode: event.target.value, modifierRows: event.target.value === 'piece' ? current.modifierRows.map(row => row.effect === 'substitute' ? { ...row, effect: '', remove: [], add: [] } : row) : current.modifierRows }))}><option value="">Elige una clasificación explícita</option><option value="recipe">Receta de ingredientes</option><option value="piece">Producto terminado por pieza</option><option value="none">Sin control de inventario</option></select></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="recipe-evidence">Referencia de configuración</Label><Input id="recipe-evidence" maxLength={250} value={editor.evidence} onChange={event => updateEditor({ ...editor, evidence: event.target.value })} placeholder="Describe la referencia que revisaste" /></div>
        </div>

        {editor.mode === 'recipe' && <section className="flex min-w-0 flex-col gap-2" aria-label="Ingredientes base de la receta"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-sm font-medium">Ingredientes por unidad vendida</h3><Button type="button" size="sm" variant="outline" onClick={() => updateEditor(current => ({ ...current, items: [...current.items, blankLine()] }))}>Agregar ingrediente</Button></div>{editor.items.map((line, index) => <LineEditor key={`base-${index}`} id={`base-${index}`} label={`Ingrediente ${index + 1}`} line={line} inventoryItems={inventoryItems} itemKinds={['Ingrediente', 'Insumo']} onChange={value => updateLine('items', index, value)} onRemove={() => updateEditor(current => ({ ...current, items: current.items.filter((_item, rowIndex) => rowIndex !== index) }))} />)}</section>}
        {editor.mode === 'piece' && <section className="flex min-w-0 flex-col gap-2" aria-label="Producto terminado"><h3 className="m-0 text-sm font-medium">Producto terminado por pieza</h3><LineEditor id="finished-good" label="Artículo terminado" line={editor.finishedGood} inventoryItems={inventoryItems} itemKinds={['Producto terminado']} onChange={value => updateEditor({ ...editor, finishedGood: value })} removable={false} /><p className="m-0 text-xs text-muted-foreground">La unidad base debe ser piezas completas. Los modificadores pueden agregar insumos; no se puede sustituir una pieza terminada.</p></section>}

        {['recipe', 'piece'].includes(editor.mode) && groups.length > 0 && <section className="flex min-w-0 flex-col gap-3" aria-label="Efectos de inventario de modificadores"><div><h3 className="m-0 text-sm font-medium">Consumo por modificador</h3><p className="m-0 mt-1 text-xs text-muted-foreground">Declara cada opción por su par de identificadores. Las opciones sin revisar quedan como pendientes y desactivan el consumo automático.</p></div>
          {editor.modifierRows.map((row, index) => {
            const group = groups.find(candidate => candidate.id === row.groupId);
            const maySubstitute = group?.selection.max <= 1 && editor.mode === 'recipe';
            const modifierLineKinds = ['Ingrediente', 'Insumo'];
            return <div key={`${row.groupId}/${row.optionId}`} className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><div className="text-sm font-medium">{row.groupName}: {row.optionName}</div><div className="text-xs text-muted-foreground">{row.groupId} / {row.optionId}</div></div><Badge variant={row.effect ? 'secondary' : 'outline'}>{row.effect ? 'Configurado' : 'Pendiente'}</Badge></div>
              <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor={`modifier-effect-${index}`}>Efecto en inventario</Label><select id={`modifier-effect-${index}`} aria-label={`Efecto ${row.groupName}: ${row.optionName}`} className="h-10 rounded-md border bg-background px-3 text-sm" value={row.effect} onChange={event => {
                const effect = event.target.value;
                updateEditor(current => ({ ...current, modifierRows: current.modifierRows.map((item, rowIndex) => rowIndex !== index ? item : {
                  ...item,
                  effect,
                  remove: effect === 'substitute' ? (item.remove.length ? item.remove : [blankLine()]) : [],
                  add: ['add', 'substitute'].includes(effect) ? (item.add.length ? item.add : [blankLine()]) : [],
                }) }));
              }}><option value="">Pendiente de revisión</option><option value="none">Sin consumo de inventario</option><option value="add">Agregar insumo</option>{maySubstitute && <option value="substitute">Sustituir ingrediente base</option>}</select></div>
              {row.effect === 'add' && <>{row.add.map((line, lineIndex) => <LineEditor key={`modifier-add-${index}-${lineIndex}`} id={`modifier-add-${index}-${lineIndex}`} label={`Artículo que agrega ${row.optionName} ${lineIndex + 1}`} line={line} inventoryItems={inventoryItems} itemKinds={modifierLineKinds} onChange={value => updateModifierLine(index, 'add', lineIndex, value)} onRemove={() => removeModifierLine(index, 'add', lineIndex)} />)}<Button type="button" size="sm" variant="outline" className="self-start" onClick={() => addModifierLine(index, 'add')}>Agregar otro artículo</Button></>}
              {row.effect === 'substitute' && <><p className="m-0 text-xs text-muted-foreground">Retira ingredientes de la receta base y agrega sus reemplazos. El grupo solo permite una opción por producto.</p>{row.remove.map((line, lineIndex) => <LineEditor key={`modifier-remove-${index}-${lineIndex}`} id={`modifier-remove-${index}-${lineIndex}`} label={`Artículo que retira ${row.optionName} ${lineIndex + 1}`} line={line} inventoryItems={inventoryItems} itemKinds={modifierLineKinds} onChange={value => updateModifierLine(index, 'remove', lineIndex, value)} onRemove={() => removeModifierLine(index, 'remove', lineIndex)} />)}<Button type="button" size="sm" variant="outline" className="self-start" onClick={() => addModifierLine(index, 'remove')}>Agregar ingrediente que retira</Button>{row.add.map((line, lineIndex) => <LineEditor key={`modifier-substitute-add-${index}-${lineIndex}`} id={`modifier-substitute-add-${index}-${lineIndex}`} label={`Artículo que agrega ${row.optionName} ${lineIndex + 1}`} line={line} inventoryItems={inventoryItems} itemKinds={modifierLineKinds} onChange={value => updateModifierLine(index, 'add', lineIndex, value)} onRemove={() => removeModifierLine(index, 'add', lineIndex)} />)}<Button type="button" size="sm" variant="outline" className="self-start" onClick={() => addModifierLine(index, 'add')}>Agregar reemplazo</Button></>}
            </div>;
          })}
        </section>}

        <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="recipe-change-reason">Motivo del cambio</Label><Textarea id="recipe-change-reason" maxLength={250} value={editor.reason} onChange={event => updateEditor({ ...editor, reason: event.target.value })} placeholder="Motivo obligatorio para el historial" /></div>
        <section className="flex min-w-0 flex-col gap-3 rounded-md border p-3" aria-label="Vista previa de receta">
          <div><h3 className="m-0 text-sm font-medium">Vista previa antes de publicar</h3><p className="m-0 mt-1 text-xs text-muted-foreground">Proyección por producto para revisión. No descuenta existencias ni afecta órdenes.</p></div>
          {previewError && <p role="alert" className="m-0 text-sm text-destructive">{previewError}</p>}
          {sourceChanged && <p className="m-0 text-sm text-destructive">Actualiza la configuración para generar una vista previa con las revisiones actuales.</p>}
          {preview && <>
            {preview.baseConsumption.length ? <div className="flex flex-col gap-1"><strong className="text-xs">Receta base · una unidad</strong>{preview.baseConsumption.map(row => <div key={row.itemId} className="flex flex-wrap justify-between gap-x-3 text-sm"><span>{row.itemNameSnapshot} · {row.itemId}</span><span>{formatBaseUnits(row.quantityBaseUnits, row.baseUnitSnapshot)} · saldo proyectado {formatBaseUnits(row.projectedStockBaseUnits, row.baseUnitSnapshot)}</span></div>)}</div> : <p className="m-0 text-sm text-muted-foreground">Esta clasificación no registra consumo base.</p>}
            {preview.modifierScenarios.map(row => <div key={`${row.groupId}/${row.optionId}`} className="flex min-w-0 flex-col gap-1 border-t pt-2"><strong className="text-xs">{row.groupNameSnapshot}: {row.optionNameSnapshot}</strong>{row.consumption.length ? row.consumption.map(item => <div key={item.itemId} className="flex flex-wrap justify-between gap-x-3 text-sm"><span>{item.itemNameSnapshot} · {item.itemId}</span><span>{formatBaseUnits(item.quantityBaseUnits, item.baseUnitSnapshot)} · saldo proyectado {formatBaseUnits(item.projectedStockBaseUnits, item.baseUnitSnapshot)}</span></div>) : <p className="m-0 text-sm text-muted-foreground">Sin cambio de existencias.</p>}</div>)}
            {preview.warnings.length > 0 && <div role="status" className="flex flex-col gap-1 rounded-md bg-muted p-3 text-xs"><strong>Requiere revisión antes del consumo automático</strong>{preview.warnings.slice(0, 10).map((warning, index) => <span key={`${warning.code}-${index}`}>{warning.message}</span>)}{preview.warnings.length > 10 && <span>Hay {preview.warnings.length - 10} avisos adicionales.</span>}</div>}
            <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={editor.previewAcknowledged} onChange={event => setEditor(current => current ? { ...current, previewAcknowledged: event.target.checked } : current)} /><span>Revisé las cantidades y advertencias de esta vista previa.</span></label>
          </>}
        </section>
        {saveError && <p role="alert" className="m-0 text-sm text-destructive">{saveError}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditor(null)}>Cancelar</Button><Button type="button" disabled={!canManage || saving || !preview || sourceChanged || authorityChanged || !editor.reason.trim() || !editor.previewAcknowledged} onClick={save}>{saving ? 'Guardando…' : 'Publicar revisión'}</Button></div>
      </Card>}
    </div>
  );
}
