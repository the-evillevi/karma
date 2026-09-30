import React from 'react';
import { css } from './css.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import SalesStation from './SalesStation.jsx';
import { captureProductLine } from './catalog/catalog-domain.mjs';
import { normalizeCatalog } from '../scripts/catalog/catalog-normalizer.mjs';
import { saveMenuProduct } from './catalog/menu-products.mjs';
import { toggleModifierSelection } from './catalog/sales-selection.mjs';
import { sameCapturedModifiers } from './catalog/captured-modifiers.mjs';
import { cancelKitchenTicket, upsertKitchenTicket } from './domain/kitchen-queue.js';
import { planSaleCompensation, compensationTotalCents, saleTotalCents } from './domain/sale-compensation.js';
import { calculateTender, centsToMoney, moneyToCents, paymentMethodTotalsCents, paymentNetCents } from './domain/payment-tender.js';
import { canPerform, resolveAccessAction, seededRoleToAccessRole } from './access/role-policy.ts';
import { parseVerifiedAccessContext } from './access/offline-identity.ts';

const compensationMethodLabels = new Map([['cash', 'Efectivo'], ['card', 'Tarjeta'], ['transfer', 'Transferencia']]);
const DEFAULT_TABLE_COUNT = 12;
const MAX_TABLE_COUNT = 50;

function validTableCount(value) {
  const count = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{1,2}$/.test(value)
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_TABLE_COUNT
    ? count
    : DEFAULT_TABLE_COUNT;
}

function textField(value, maxLength = 160) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function tableFromReference(reference) {
  if (typeof reference !== 'string') return '';
  const match = /^\s*mesa\s+(.+?)\s*$/i.exec(reference);
  return match && match[1] !== '—' ? match[1].slice(0, 32) : '';
}

function restoreStoredOrder(savedOrder) {
  return {
    ...savedOrder,
    mesa: textField(savedOrder.mesa, 32),
    name: textField(savedOrder.name, 100),
    phone: textField(savedOrder.phone, 40),
    address: textField(savedOrder.address, 240),
    items: (savedOrder.items || []).map((item, index) => ({
      ...item,
      lineId: item.lineId || `restored-${item.prodId || 'item'}-${index}`,
    })),
  };
}

// Hover: replicates the DC `style-hover` directive for the 3 elements that used
// it (keypad key, product card, sales row). Merges base + hover style on hover.
function Hover({ tag = 'button', base, hover, children, ...rest }) {
  const [on, setOn] = React.useState(false);
  return React.createElement(
    tag,
    {
      ...rest,
      style: on ? { ...base, ...hover } : base,
      onMouseEnter: () => setOn(true),
      onMouseLeave: () => setOn(false),
    },
    children
  );
}

function PosSidebarNavigation({ items, goPos }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = callback => {
    callback();
    if (isMobile) setOpenMobile(false);
  };

  return (
    <>
      <SidebarHeader className="gap-3 px-3 pb-4 pt-1">
        <div className="px-2">
          <div className="font-[Georgia,serif] text-[27px] italic leading-none">Karma</div>
          <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[.16em] text-muted-foreground">Abboth · Centro</div>
        </div>
        <Button className="w-full justify-start" onClick={() => navigate(goPos)}>+ Nueva venta</Button>
      </SidebarHeader>
      <SidebarContent className="px-2">
        <SidebarMenu aria-label="Áreas del punto de venta">
          {items.map(item => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton
                type="button"
                isActive={item.active}
                aria-current={item.active ? 'page' : undefined}
                aria-disabled={!item.allowed}
                className="min-h-11 w-full justify-between"
                onClick={() => navigate(item.go)}
              >
                <span>{item.label}</span>
                {item.hasBadge && <SidebarMenuBadge aria-label={`${item.badge} órdenes abiertas`}>{item.badge}</SidebarMenuBadge>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
    </>
  );
}

// Ported verbatim from design/Karma POS.dc.html. The original
// `class Component extends DCLogic` becomes a real React.Component (identical
// setState / lifecycle / props semantics). All ~30 helper methods and
// renderVals() are unchanged; render() binds V (renderVals output) to JSX
// converted mechanically from the original <x-dc> template.
export default class PosApp extends React.Component {
  constructor(props) {
    super(props);
    this._dialogReturnFocus = null;
    const D = window.KARMA;
    this._secureStorage = props.accessMode === 'secure';
    this._storageKey = this._secureStorage ? (props.accessStorageKey || 'karma-pos-secure-v1:unconfigured:unconfigured') : 'karma-pos-v1';
    let sv = {}; try { sv = JSON.parse(localStorage.getItem(this._storageKey)) || {}; } catch (e) {}
    const orderSettings = { tableCount: validTableCount(sv.orderSettings?.tableCount) };
    this._folio = sv.folioSeq || 1051;
    const savedOrder = sv.order || this.blank();
    const restoredOrder = restoreStoredOrder(savedOrder);
    this.state = {
      loading: true,
      session: this._secureStorage ? null : sv.session || null,
      pick: sv.pick || 'u3', pin: '', pinErr: '',
      module: 'pos',
      online: this._secureStorage ? navigator.onLine : sv.online !== false,
      syncing: false,
      pending: sv.pending || (this._secureStorage ? [] : ['Venta A-1047', 'Orden A-1049']),
      toasts: [],
      order: restoredOrder,
      orderSettings,
      tableCountDraft: String(orderSettings.tableCount),
      open: sv.open || (this._secureStorage ? [] : D.seedOrders.map(o => ({ ...o }))),
      kitchenTickets: Array.isArray(sv.kitchenTickets) ? sv.kitchenTickets : (sv.open || (this._secureStorage ? [] : D.seedOrders.map(o => ({ ...o })))),
      sales: sv.sales || (this._secureStorage ? [] : D.sales.map(s => ({ ...s }))),
      prods: sv.prods || D.products.map(p => ({ ...p })),
      usersX: this._secureStorage ? [] : sv.usersX || D.users.map(u => ({ ...u })),
      movs: D.movements.slice(),
      ed: null, dlg: null, ck: null,
      cat: 'concafe', search: '',
      admCat: 'all', admSearch: '', admSel: null, admForm: null,
      invTab: 'stock', invSearch: '', invLow: false,
      range: 'hoy', repSel: null,
      cfgTab: 'usuarios', selUser: null, suForm: null, createdCredential: null,
      flags: sv.flags || { autoprint: true, fpEfectivo: true, fpTarjeta: true, fpTransfer: true, propCustom: true, cancelMotivo: true, cancelAut: true }
    };
  }
  blank() { return { folio: null, type: 'local', mesa: '', name: '', items: [], discount: 0, discountReason: '', actorId: null, actorName: null, actorHistory: [] }; }
  stampOrder(order, action = 'order_updated') {
    if (!this.isSecureMode()) return order;
    const actor = this.user();
    if (!actor) return order;
    return {
      ...order,
      actorId: order.actorId || actor.id,
      actorName: order.actorName || actor.name,
      lastModifiedActorId: actor.id,
      lastModifiedActorName: actor.name,
      actorHistory: [...(Array.isArray(order.actorHistory) ? order.actorHistory : []), {
        actorId: actor.id,
        actorName: actor.name,
        action,
        occurredAt: new Date().toISOString(),
      }],
    };
  }
  mutateOrder(action, transform, callback) {
    if (!this.requireAction('openOrder')) return false;
    this.up({ order: this.stampOrder(transform(this.state.order), action) }, callback);
    return true;
  }
  componentDidMount() {
    this.reportPwaUpdateSafety();
    this._t = setTimeout(() => this.setState({ loading: false }), 650);
    this._online = () => { if (this._secureStorage) this.setState({ online: navigator.onLine }); };
    window.addEventListener('online', this._online);
    window.addEventListener('offline', this._online);
    this._sl = e => {
      if (e.key === this._storageKey && e.newValue) {
        try {
          const v = JSON.parse(e.newValue);
          this.setState({
            ...(Array.isArray(v.open) ? { open: v.open } : {}),
            ...(Array.isArray(v.kitchenTickets) ? { kitchenTickets: v.kitchenTickets } : {}),
          });
        } catch (_) {}
      }
    };
    window.addEventListener('storage', this._sl);
  }
  componentDidUpdate() {
    this.reportPwaUpdateSafety();
    if (this.state.createdCredential) {
      const context = this.accessContext();
      if (!context || context.role !== 'duena' || context.userId !== this.state.createdCredential.ownerUserId) this.setState({ createdCredential: null });
    }
  }
  reportPwaUpdateSafety() {
    const report = this.props.onUpdateSafetyChange;
    if (typeof report !== 'function') return;
    const s = this.state;
    if (s.loading) return report({ status: 'unknown', reason: 'La estación todavía está cargando.' });
    if (this._secureStorage && this.role() === 'duena' && s.createdCredential?.ownerUserId === this.accessContext()?.userId) return report({ status: 'blocked', reason: 'Hay una contraseña inicial visible. Entrégala a la persona y ciérrala con «Listo, cerrar credencial» antes de actualizar.' });
    if (s.module === 'checkout' && s.ck) return report({ status: 'blocked', reason: 'Hay un cobro abierto. Termina el cobro o vuelve a la orden antes de actualizar.' });
    if (s.dlg || s.ed) return report({ status: 'blocked', reason: 'Hay un diálogo o edición abierta. Ciérrala y revisa los cambios antes de actualizar.' });
    if (s.admSel || s.admForm || s.selUser || s.suForm || s.repSel || s.pin) return report({ status: 'blocked', reason: 'Hay una edición, detalle o captura abierta. Ciérrala y revisa los cambios antes de actualizar.' });
    const order = s.order || this.blank();
    const dirty = !!(order.folio || order.items?.length || order.name?.trim() || order.mesa?.trim() || order.discount || order.type !== 'local');
    if (dirty) return report({ status: 'blocked', reason: 'Hay una orden en captura. Guárdala como cuenta abierta o termina la venta; deja la estación limpia y revisada para actualizar.' });
    return report({ status: 'safe', reason: '' });
  }
  componentWillUnmount() { clearTimeout(this._t); window.removeEventListener('storage', this._sl); window.removeEventListener('online', this._online); window.removeEventListener('offline', this._online); }
  persist() {
    const s = this.state;
    try {
      localStorage.setItem(this._storageKey, JSON.stringify({
        ...(this._secureStorage ? {} : { session: s.session, pick: s.pick }), online: s.online, pending: s.pending, order: s.order,
        orderSettings: s.orderSettings,
        open: s.open, kitchenTickets: s.kitchenTickets,
        sales: s.sales, prods: s.prods, usersX: s.usersX, flags: s.flags, folioSeq: this._folio
      }));
    } catch (e) {}
  }
  up(p, cb) { this.setState(p, () => { this.persist(); cb && cb(); }); }
  toast(msg, kind) {
    const id = Date.now() + Math.random();
    this.setState(s => ({ toasts: [...s.toasts, { id, msg, kind: kind || 'ok' }] }));
    setTimeout(() => this.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 4200);
  }
  fmt(n) { return '$' + Number(n || 0).toFixed(2); }
  now() { return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }
  nf() { const f = 'A-' + this._folio; this._folio += 1; return f; }
  isSecureMode() { return this.props.accessMode === 'secure'; }
  accessContext() {
    try {
      const context = parseVerifiedAccessContext(this.props.accessContext);
      const now = Date.now();
      if (Date.parse(context.expiresAt) <= now || Date.parse(context.verifiedAt) > now + 30_000) return null;
      const expectedBranchId = this.props.accessBranchId || import.meta.env.VITE_KARMA_BRANCH_ID;
      const expectedDeviceId = this.props.accessDeviceId || import.meta.env.VITE_KARMA_DEVICE_ID;
      if (!expectedBranchId || !expectedDeviceId || context.branchId !== expectedBranchId || context.deviceId !== expectedDeviceId) return null;
      return context;
    } catch { return null; }
  }
  user() {
    if (this.isSecureMode()) {
      const context = this.accessContext();
      return context ? { id: context.userId, name: context.displayName, role: context.role, active: true } : null;
    }
    return this.state.usersX.find(u => u.id === this.state.session) || null;
  }
  role() {
    if (this.isSecureMode()) return this.accessContext()?.role || null;
    const u = this.user(); return u ? u.role : 'cajero';
  }
  roleLabel(role = this.role()) {
    if (this.isSecureMode()) return ({ duena: 'Dueña', encargado: 'Encargado', barra: 'Barra', mesero: 'Mesero' })[role] || '';
    return window.KARMA.roleLabels[role] || '';
  }
  can(act) {
    const action = resolveAccessAction(act);
    if (!action) return false;
    const context = this.isSecureMode() ? this.accessContext() : null;
    if (this.isSecureMode() && context?.capability !== 'cash_register') return false;
    const role = this.isSecureMode() ? context?.role : seededRoleToAccessRole(this.role());
    return canPerform(role, action);
  }
  requireAction(action, reason) {
    if (!this.user() || !this.can(action)) {
      this.notAllowed(action);
      return false;
    }
    const reasonRequired = ['cancelWithReason', 'refundSaleWithReason', 'cancelPreparationWithReason', 'discountWithReason', 'reprintWithReason', 'editMenu', 'adjustInventory'].includes(resolveAccessAction(action));
    if (this.isSecureMode() && reasonRequired && reason !== undefined) {
      if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 250) {
        this.toast('Captura un motivo de entre 1 y 250 caracteres.', 'warn');
        return false;
      }
    }
    return true;
  }
  needsOrderContact(order) {
    if (order.type === 'domicilio') {
      if (!hasText(order.name) || !hasText(order.phone) || !hasText(order.address)) {
        this.toast('Para domicilio captura nombre, teléfono y dirección.', 'warn');
        return false;
      }
    }
    if (['llevar', 'recoger'].includes(order.type) && (!hasText(order.name) || !hasText(order.phone))) {
      this.toast('Para recoger captura nombre y teléfono.', 'warn');
      return false;
    }
    return true;
  }
  navAllowed(m) {
    if (this.isSecureMode()) {
      if (m === 'config') return this.can('manageUsers') || this.can('configureTables');
      const action = ({ pos: 'openOrder', ordenes: 'openOrder', menu: 'editMenu', inventario: 'viewStock', reportes: 'viewReports', config: 'manageUsers' })[m];
      return Boolean(action && this.can(action));
    }
    const r = this.role();
    const L = {
      pos: ['dueno', 'encargado', 'cajero'], ordenes: ['dueno', 'encargado', 'cajero', 'cocina'],
      menu: ['dueno', 'encargado'], inventario: ['dueno', 'encargado', 'cajero'],
      reportes: ['dueno', 'encargado'], config: ['dueno', 'encargado']
    };
    return (L[m] || []).includes(r);
  }
  notAllowed(what) {
    if (what === 'refundSaleWithReason') what = 'registrar reembolsos o anular ventas';
    this.setState({ dlg: { title: 'Acción no permitida', body: 'Tu rol (' + this.roleLabel() + ') no tiene permiso para ' + what + '. Solicita apoyo a un encargado o a la dueña.', closeLabel: 'Entendido', onConfirm: null } });
  }
  lineUnit(l) {
    if (l?.capturedSnapshot && Object.prototype.hasOwnProperty.call(l.capturedSnapshot, 'unitPriceCents')) {
      return Number.isSafeInteger(l.capturedSnapshot.unitPriceCents) && l.capturedSnapshot.unitPriceCents >= 0
        ? l.capturedSnapshot.unitPriceCents / 100
        : null;
    }
    // Older saved accounts store their captured per-unit total in MXN.
    if (typeof l?.unit === 'number' && Number.isFinite(l.unit)) return l.unit;
    return null;
  }
  previewLineUnit(l) {
    const D = window.KARMA;
    const p = this.state.prods.find(x => x.id === l.prodId);
    if (!p) return null;
    let total = p.price;
    Object.keys(l.mods || {}).forEach(groupId => {
      const group = D.modGroups[groupId]; if (!group) return;
      (l.mods[groupId] || []).forEach(optionId => {
        const option = group.options.find(item => item.id === optionId);
        if (option) total += option.price;
      });
    });
    return total;
  }
  modsText(l) {
    if (typeof l?.modsTextSnapshot === 'string') return l.modsTextSnapshot;
    if (typeof l?.modsText === 'string') return l.modsText;
    const D = window.KARMA; const parts = [];
    Object.keys(l.mods || {}).forEach(g => {
      const G = D.modGroups[g]; if (!G) return;
      (l.mods[g] || []).forEach(oid => { const o = G.options.find(x => x.id === oid); if (o) parts.push(o.label + (o.price ? ' +$' + o.price : '')); });
    });
    return parts.join(' · ');
  }
  orderLineUnitCents(line) {
    if (line?.capturedSnapshot && Object.prototype.hasOwnProperty.call(line.capturedSnapshot, 'unitPriceCents')) {
      const captured = line.capturedSnapshot.unitPriceCents;
      return Number.isSafeInteger(captured) && captured >= 0 ? captured : null;
    }
    try { return moneyToCents(line?.unit); } catch { return null; }
  }
  orderTotalsCents(order) {
    if (!Array.isArray(order?.items)) return null;
    let subCents = 0;
    try {
      for (const line of order.items) {
        if (!Number.isSafeInteger(line?.qty) || line.qty < 1) return null;
        const unitCents = this.orderLineUnitCents(line);
        if (unitCents === null) return null;
        const lineCents = unitCents * line.qty;
        const next = subCents + lineCents;
        if (!Number.isSafeInteger(lineCents) || !Number.isSafeInteger(next)) return null;
        subCents = next;
      }
      const discountCents = Math.min(moneyToCents(order.discount || 0), subCents);
      const totalCents = subCents - discountCents;
      if (!Number.isSafeInteger(totalCents)) return null;
      return { subCents, discountCents, totalCents };
    } catch {
      return null;
    }
  }
  orderTotals(order) {
    const totals = this.orderTotalsCents(order);
    if (!totals) return { sub: null, disc: 0, total: null };
    return { sub: centsToMoney(totals.subCents), disc: centsToMoney(totals.discountCents), total: centsToMoney(totals.totalCents) };
  }
  persistedOrderState() {
    try { return JSON.parse(localStorage.getItem(this._storageKey || 'karma-pos-v1')) || {}; } catch { return {}; }
  }
  orderSourceStatus(folio, kind = 'station', stationOrder = this.state.order) {
    if (stationOrder?.sync === 'conflicto') return 'conflict';
    if (!folio) return kind === 'open' ? 'missing' : 'available';
    const persisted = this.persistedOrderState();
    const stateOpen = this.state.open.find(entry => entry.folio === folio);
    const stateTicket = this.state.kitchenTickets.find(ticket => ticket.folio === folio);
    const savedOpen = Array.isArray(persisted.open) ? persisted.open.find(entry => entry?.folio === folio) : null;
    const savedTicket = Array.isArray(persisted.kitchenTickets) ? persisted.kitchenTickets.find(ticket => ticket?.folio === folio) : null;
    if ([stateOpen, stateTicket, savedOpen, savedTicket].some(record => record?.sync === 'conflicto')) return 'conflict';
    if (kind === 'open') return stateOpen && (!Array.isArray(persisted.open) || savedOpen) ? 'available' : 'missing';
    if (stateOpen || stateTicket || savedOpen || savedTicket || (stationOrder?.folio === folio && Array.isArray(stationOrder.items))) return 'available';
    return 'missing';
  }
  blockOrderSource(status) {
    this.toast(status === 'conflict'
      ? 'La cuenta tiene un conflicto de sincronización pendiente; espera a que se concilie antes de continuar.'
      : 'La cuenta ya no está disponible. Vuelve a Órdenes abiertas y revisa su estado.', 'warn');
  }
  typeLabel(t) { return ({ local: 'En local', mesa: 'Mesa', llevar: 'Para llevar', domicilio: 'Domicilio', recoger: 'Recoger' })[t] || t; }
  refOf(o) { return o.type === 'mesa' ? ('Mesa ' + (o.mesa || '—')) : (o.name || this.typeLabel(o.type)); }
  needItems() { if (!this.state.order.items.length) { this.toast('Agrega productos a la orden primero', 'warn'); return false; } return true; }
  hasCapturedPrice(line) { return this.orderLineUnitCents(line) !== null; }
  needCapturedPrices(lines = this.state.order.items) {
    if (lines.every(line => this.hasCapturedPrice(line))) return true;
    this.toast('Hay productos sin precio capturado. Revisa el historial antes de guardar o cobrar; el precio actual del menú no sustituye el dato faltante.', 'warn');
    return false;
  }
  openEntry(o) {
    const totals = this.orderTotalsCents(o);
    const totalCents = totals?.totalCents ?? null;
    const responsible = textField(o.responsible || o.user || o.actorName || this.user()?.name || '—', 100);
    const createdBy = textField(o.user || responsible, 100);
    return {
      folio: o.folio, type: o.type, ref: this.refOf(o), reference: this.refOf(o), time: textField(o.time || this.now(), 40),
      user: createdBy, responsible, totalCents, actorId: o.actorId || this.user()?.id, actorName: o.actorName || createdBy, actorHistory: o.actorHistory || [],
      phone: textField(o.phone, 40), address: textField(o.address, 240),
      mesa: textField(o.mesa, 32), prep: 'en-cola', sync: this.state.online ? 'sincronizada' : 'pendiente',
      items: o.items.map(l => ({ ...l, prodId: l.prodId, name: l.capturedSnapshot?.name || l.productNameSnapshot || l.name || (this.state.prods.find(p => p.id === l.prodId) || {}).name, qty: l.qty, mods: l.mods, modsText: this.modsText(l), notes: l.notes, unit: this.orderLineUnitCents(l) === null ? null : centsToMoney(this.orderLineUnitCents(l)) })),
      name: o.name, discount: o.discount || 0
    };
  }
  saveOpen(keepStation) {
    if (!this.requireAction('openOrder')) return;
    if (!this.needItems()) return;
    if (!this.needCapturedPrices()) return;
    const s = this.state; const o = { ...s.order };
    if (!this.orderTotalsCents(o)) {
      this.toast('No se puede guardar la cuenta: revisa que todos los precios y el total sean importes válidos.', 'warn');
      return;
    }
    const sourceStatus = this.orderSourceStatus(o.folio, 'station', o);
    if (sourceStatus !== 'available') { this.blockOrderSource(sourceStatus); return; }
    if (!this.needsOrderContact(o)) return;
    if (!o.folio) o.folio = this.nf();
    const entry = this.openEntry(o);
    const prev = s.kitchenTickets.find(x => x.folio === o.folio) || s.open.find(x => x.folio === o.folio);
    if (prev) { entry.prep = prev.prep; entry.time = prev.time; entry.user = prev.user; entry.responsible = prev.responsible || prev.user; entry.actorId = prev.actorId || entry.actorId; entry.actorName = prev.actorName || entry.actorName; }
    const open = [entry, ...s.open.filter(x => x.folio !== o.folio)];
    const ticketEntry = { ...entry };
    delete ticketEntry.phone;
    delete ticketEntry.address;
    const kitchenBase = s.kitchenTickets.map(ticket => {
      if (ticket.folio !== entry.folio) return ticket;
      const safeTicket = { ...ticket };
      delete safeTicket.phone;
      delete safeTicket.address;
      return safeTicket;
    });
    const kitchenTickets = upsertKitchenTicket(kitchenBase, ticketEntry);
    const pending = s.online ? s.pending : [...s.pending, 'Orden ' + o.folio];
    if (keepStation) this.up({ open, kitchenTickets, pending, order: o });
    else this.up({ open, kitchenTickets, pending, order: this.blank() });
    return o.folio;
  }
  startCheckout(folio, lines, discount, type, fromStation) {
    if (!this.requireAction('checkout')) return;
    let sourceOrder;
    if (fromStation) {
      sourceOrder = this.state.order;
      folio = sourceOrder.folio;
      lines = sourceOrder.items;
      discount = sourceOrder.discount;
      type = this.typeLabel(sourceOrder.type) + (sourceOrder.type === 'mesa' && sourceOrder.mesa ? ' ' + sourceOrder.mesa : '');
      const sourceStatus = this.orderSourceStatus(folio, 'station', sourceOrder);
      if (sourceStatus !== 'available') { this.blockOrderSource(sourceStatus); return; }
    } else {
      sourceOrder = this.state.open.find(entry => entry.folio === folio);
      const sourceStatus = this.orderSourceStatus(folio, 'open');
      if (sourceStatus !== 'available' || !sourceOrder) { this.blockOrderSource(sourceStatus); return; }
      lines = sourceOrder.items;
      discount = sourceOrder.discount;
      type = this.typeLabel(sourceOrder.type) + ' · ' + (sourceOrder.reference || sourceOrder.ref || this.typeLabel(sourceOrder.type));
    }
    if (!this.needCapturedPrices(lines)) return;
    if (sourceOrder && !this.needsOrderContact(sourceOrder)) return;
    const sourceSnapshot = this.checkoutSourceSnapshot({ folio, fromStation }, this.state);
    let subCents;
    let discCents;
    try {
      subCents = lines.reduce((sum, line) => {
        if (!Number.isSafeInteger(line.qty) || line.qty < 1) throw new RangeError('quantity must be a positive safe integer');
        const unitCents = this.orderLineUnitCents(line);
        if (unitCents === null) throw new RangeError('captured unit price is invalid');
        const lineCents = unitCents * line.qty;
        const next = sum + lineCents;
        if (!Number.isSafeInteger(next)) throw new RangeError('order total exceeds safe centavos');
        return next;
      }, 0);
      discCents = Math.min(moneyToCents(discount || 0), subCents);
    } catch (error) {
      this.toast('No se puede abrir el cobro: revisa productos, cantidades, precios y descuento de la orden.', 'warn');
      return;
    }
    const baseCents = subCents - discCents;
    const tipSel = String(this.props.propinaInicial ?? '0');
    const tipCents = Math.round(baseCents * (parseInt(tipSel, 10) || 0) / 100);
    const totalCents = baseCents + tipCents;
    this.up({
      module: 'checkout',
      ck: {
        folio, sourceFolio: folio || null, fromStation, sourceSnapshot, type, step: 'review', ok: null, error: '', change: 0,
        actorId: this.user()?.id, actorName: this.user()?.name, originalActorId: sourceOrder.actorId || this.user()?.id, originalActorName: sourceOrder.actorName || sourceOrder.user || sourceOrder.responsible || this.user()?.name, createdTime: sourceOrder.time || null,
        lines: lines.map(l => ({ name: l.name || (this.state.prods.find(p => p.id === l.prodId) || {}).name, qty: l.qty, modsText: l.modsText != null ? l.modsText : this.modsText(l), unit: centsToMoney(this.orderLineUnitCents(l)) })),
        subCents, discCents, tipSel, tipCustom: '',
        sub: centsToMoney(subCents), disc: centsToMoney(discCents),
        pays: [{ id: 1, method: 'efectivo', amount: centsToMoney(totalCents).toFixed(2) }]
      }
    });
  }
  checkoutSourceSnapshot(checkout, state) {
    if (checkout.fromStation) return JSON.stringify({ kind: 'station', record: state.order ? restoreStoredOrder(state.order) : null });
    if (checkout.folio) return JSON.stringify({ kind: 'open', record: state.open.find(o => o.folio === checkout.folio) || null });
    return JSON.stringify({ kind: 'new', record: null });
  }
  ckMath(ck) {
    let subCents; let discCents; let baseCents; let tipCents; let totalCents;
    try {
      subCents = ck.subCents ?? moneyToCents(ck.sub);
      discCents = ck.discCents ?? moneyToCents(ck.disc);
      if (discCents > subCents) throw new RangeError('discount exceeds subtotal');
      baseCents = subCents - discCents;
      tipCents = ck.tipSel === 'otro'
        ? moneyToCents(ck.tipCustom || '0')
        : Math.round(baseCents * (parseInt(ck.tipSel, 10) || 0) / 100);
      totalCents = baseCents + tipCents;
      if (!Number.isSafeInteger(totalCents)) throw new RangeError('order total exceeds safe centavos');
    } catch (error) {
      return { valid: false, error: 'Revisa los importes: usa cantidades MXN no negativas con máximo dos decimales.', base: 0, tip: 0, total: 0, paid: 0, remaining: 0, over: 0, change: 0, hasCash: false, payments: [] };
    }
    const tender = calculateTender(totalCents, ck.pays, { tipCents });
    const tenderedCents = tender.tenderedCents || 0;
    const changeCents = tender.changeCents || 0;
    const hasCash = ck.pays.some(p => {
      if (p.method !== 'efectivo') return false;
      try { return moneyToCents(p.amount) > 0; } catch { return false; }
    });
    return {
      ...tender,
      baseCents, tipCents, totalCents, tenderedCents, changeCents, hasCash,
      base: centsToMoney(baseCents), tip: centsToMoney(tipCents), total: centsToMoney(totalCents),
      paid: centsToMoney(tenderedCents), remaining: centsToMoney(tender.remainingCents || 0),
      over: centsToMoney(changeCents), change: centsToMoney(changeCents), valid: tender.valid,
    };
  }
  setCk(patch) {
    const checkout = this.state.ck;
    if (!checkout || !this.requireAction('checkout')) return false;
    if (this.isSecureMode() && checkout.actorId !== this.accessContext()?.userId) {
      this.notAllowed('continuar el cobro iniciado por otra identidad');
      return false;
    }
    this.setState(s => ({ ck: { ...s.ck, ...patch } }));
    return true;
  }
  register() {
    const s = this.state; const ck = s.ck;
    if (!ck || ck.step === 'processing' || (ck.step === 'result' && ck.ok)) return;
    if (!this.requireAction('checkout')) return;
    if (this.isSecureMode() && ck.actorId !== this.accessContext()?.userId) {
      this.notAllowed('continuar el cobro iniciado por otra identidad');
      return;
    }
    const m = this.ckMath(ck);
    if (!m.valid) return;
    const folio = ck.folio || this.nf();
    const sourceSnapshot = ck.sourceSnapshot;
    this.setCk({ folio, step: 'processing' });
    setTimeout(() => {
      const st = this.state;
      if (st.ck?.folio !== folio || st.ck?.step !== 'processing') return;
      if (!this.requireAction('checkout') || (this.isSecureMode() && st.ck.actorId !== this.accessContext()?.userId)) {
        this.setState({ ck: null, module: 'pos' }, () => this.toast('La identidad que inició el cobro perdió su autorización. La orden queda en la estación para revisión.', 'warn'));
        return;
      }
      if (st.sales.some(sale => sale.folio === folio && sale.status === 'completada')) return;
      const persisted = this.persistedOrderState();
      const persistedState = { ...st, open: Array.isArray(persisted.open) ? persisted.open : [], order: persisted.order || this.blank() };
      const sourceStatus = ck.sourceFolio
        ? this.orderSourceStatus(ck.sourceFolio, ck.fromStation ? 'station' : 'open', st.order)
        : ck.fromStation ? 'available' : 'missing';
      if (sourceStatus !== 'available' || !sourceSnapshot || this.checkoutSourceSnapshot(ck, st) !== sourceSnapshot || this.checkoutSourceSnapshot(ck, persistedState) !== sourceSnapshot) {
        if (sourceStatus !== 'available') this.blockOrderSource(sourceStatus);
        this.setCk({ step: 'result', ok: false, error: 'La cuenta cambió mientras se confirmaba el cobro. Revisa la cuenta antes de volver a intentar.' });
        return;
      }
      const ml = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };
      const sale = {
        folio, day: 0, fecha: 'Hoy · ' + this.now(), creo: ck.originalActorName, createdTime: ck.createdTime, actorId: ck.originalActorId, cobro: ck.actorName, paidByActorId: ck.actorId, paidByActorName: ck.actorName,
        tipo: ck.type, items: ck.lines.map(l => ({ name: l.name, qty: l.qty, mods: l.modsText, total: l.unit * l.qty })),
        payments: m.payments.filter(p => p.netAmountCents > 0).map(p => ({
          paymentId: `${folio}:payment:${p.id}`,
          method: p.method,
          methodLabel: ({ cash: ml.efectivo, card: ml.tarjeta, transfer: ml.transferencia })[p.method],
          netAmountCents: p.netAmountCents, amountCents: p.netAmountCents,
          amount: centsToMoney(p.netAmountCents), tipCents: p.tipCents,
          recordMode: 'manual',
          verificationStatus: p.method === 'cash' ? 'not_applicable' : 'manual_unverified',
          ...(p.method === 'cash' ? { cashReceivedCents: p.tenderedCents, changeCents: p.changeCents } : {}),
        })),
        tenders: m.payments.filter(p => p.tenderedCents > 0).map(p => ({
          tenderId: `${folio}:tender:${p.id}`,
          method: p.method,
          methodLabel: ({ cash: ml.efectivo, card: ml.tarjeta, transfer: ml.transferencia })[p.method],
          tenderedCents: p.tenderedCents,
          netAmountCents: p.netAmountCents,
          changeCents: p.changeCents,
          tipCents: p.tipCents,
        })),
        tip: centsToMoney(m.tipCents), tipCents: m.tipCents, total: centsToMoney(m.totalCents), totalCents: m.totalCents,
        currency: 'MXN', status: 'completada', sync: st.online ? 'sincronizada' : 'pendiente',
        paymentRecordMode: 'manual',
        externalPaymentVerification: m.payments.some(p => p.netAmountCents > 0 && p.method !== 'cash') ? 'manual_unverified' : 'not_applicable',
        audit: [[this.now(), 'Orden creada', ck.actorName], [this.now(), 'Pago neto registrado (' + m.payments.filter(p => p.netAmountCents > 0).map(p => ({ cash: ml.efectivo, card: ml.tarjeta, transfer: ml.transferencia })[p.method]).join(' + ') + ')', ck.actorName]]
      };
      this.up({
        sales: [sale, ...st.sales],
        open: st.open.filter(o => o.folio !== folio),
        order: ck.fromStation ? this.blank() : st.order,
        pending: st.online ? st.pending : [...st.pending, 'Venta ' + folio],
        ck: { ...this.state.ck, step: 'result', ok: true, change: m.change, folio }
      });
    }, 1400);
  }
  doSync() {
    if (this.isSecureMode()) {
      this.toast('Las operaciones se conservan en esta caja. La sincronización entre dispositivos aún no está disponible.', 'warn');
      return;
    }
    const s = this.state;
    if (!s.online) { this.toast('Sin conexión — no es posible sincronizar ahora', 'warn'); return; }
    if (!s.pending.length) { this.toast('Todo está sincronizado'); return; }
    this.setState({ syncing: true });
    setTimeout(() => {
      this.up({
        syncing: false, pending: [],
        open: this.state.open.map(o => o.sync === 'pendiente' ? { ...o, sync: 'sincronizada' } : o),
        sales: this.state.sales.map(x => x.sync === 'pendiente' ? { ...x, sync: 'sincronizada' } : x)
      }, () => this.toast('Sincronización completa — ' + 0 + ' operaciones pendientes'));
    }, 1600);
  }
  requestReprint(folio, kind) {
    if (!this.can('reprintWithReason')) { this.notAllowed('solicitar una reimpresión'); return; }
    this.setState({ dlg: {
      title: 'Registrar reimpresión',
      body: 'La solicitud quedará asociada a tu identidad y motivo. La impresora física no está conectada en esta etapa.',
      needReason: true,
      confirmLabel: 'Registrar solicitud',
      onConfirm: d => {
        if (!this.requireAction('reprintWithReason', d.reason || '')) return 'keep';
        const actor = this.user();
        const entry = { id: 'rp' + Date.now(), kind, folio, occurredAt: new Date().toISOString(), reason: d.reason.trim(), actorId: actor.id, actorName: actor.name };
        const addEntry = record => ({ ...record, reprints: [...(record.reprints || []), entry] });
        this.up({
          open: this.state.open.map(record => record.folio === folio ? addEntry(record) : record),
          kitchenTickets: this.state.kitchenTickets.map(record => record.folio === folio ? addEntry(record) : record),
          sales: this.state.sales.map(record => record.folio === folio ? addEntry(record) : record),
        }, () => this.toast('Solicitud de reimpresión registrada localmente; falta conectar la impresora.'));
      }
    } });
  }
  cancelOpen(folio) { this.openCancellation({ folio, fromStation: false }); }
  openCancellation({ folio, fromStation }) {
    if (!this.can('cancelar')) { this.notAllowed('cancelar cuentas'); return; }
    const source = fromStation ? this.state.order : this.state.open.find(x => x.folio === folio);
    if (source?.sync === 'conflicto') { this.toast('La cuenta tiene un conflicto pendiente. Revísalo antes de cancelar.', 'warn'); return; }
    if (!source || !Array.isArray(source.items) || (!source.items.length && !source.folio)) { this.toast('No hay orden que cancelar', 'warn'); return; }
    const target = { folio: source.folio || folio, fromStation };
    const expectedSource = this.checkoutSourceSnapshot(target, this.state);
    const commandId = globalThis.crypto.randomUUID();
    this.setState({ dlg: {
      title: fromStation ? 'Cancelar orden actual' : 'Cancelar ' + folio,
      body: 'La cuenta quedará registrada como cancelada con su motivo y responsable.',
      needReason: true, danger: true, confirmLabel: fromStation ? 'Cancelar orden' : 'Cancelar cuenta',
      onConfirm: d => this.confirmCancellation(target, expectedSource, commandId, d.reason)
    } });
  }
  confirmCancellation(target, expectedSource, commandId, reason) {
    // Recheck the current identity when the action executes, including stale dialogs.
    if (typeof this.requireAction === 'function') {
      if (!this.requireAction('cancelWithReason', reason)) return 'keep';
    } else if (!this.can('cancelar')) { this.notAllowed('cancelar cuentas'); return 'keep'; }
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 250) {
      this.toast('Captura un motivo de cancelación de 1 a 250 caracteres', 'warn'); return 'keep';
    }
    const st = this.state;
    let persisted;
    try { persisted = JSON.parse(localStorage.getItem(this._storageKey || 'karma-pos-v1')) || {}; }
    catch { this.toast('No se pudo leer el estado guardado. Revisa la cuenta antes de cancelar.', 'warn'); return 'keep'; }
    if (persisted.order && (!Array.isArray(persisted.order.items) || typeof persisted.order !== 'object')) {
      this.toast('La orden guardada requiere revisión antes de cancelar.', 'warn'); return 'keep';
    }
    const persistedState = {
      ...st, ...persisted,
      order: persisted.order ? {
        ...persisted.order,
        items: (persisted.order.items || []).map((item, index) => ({
          ...item, lineId: item.lineId || `restored-${item.prodId || 'item'}-${index}`,
        })),
      } : st.order,
      open: Array.isArray(persisted.open) ? persisted.open : st.open,
      sales: Array.isArray(persisted.sales) ? persisted.sales : st.sales,
      kitchenTickets: Array.isArray(persisted.kitchenTickets) ? persisted.kitchenTickets : st.kitchenTickets,
    };
    // Repeating an already committed confirmation never creates a second audit entry.
    if (persistedState.sales.some(sale => sale.cancellationCommandId === commandId)) return;
    if (target.folio && persistedState.sales.some(sale => sale.folio === target.folio && ['completada', 'cancelada'].includes(sale.status))) {
      this.toast('La cuenta ya fue cobrada o cancelada. Revisa su historial.', 'warn'); return 'keep';
    }
    if (this.checkoutSourceSnapshot(target, st) !== expectedSource || this.checkoutSourceSnapshot(target, persistedState) !== expectedSource) {
      this.toast('La cuenta cambió mientras confirmabas. Revísala y vuelve a cancelar.', 'warn'); return 'keep';
    }
    const source = target.fromStation ? st.order : st.open.find(x => x.folio === target.folio);
    if (!source || !this.needCapturedPrices(source.items)) return 'keep';
    if (Number.isSafeInteger(persisted.folioSeq) && persisted.folioSeq > this._folio) this._folio = persisted.folioSeq;
    let folio = source.folio;
    if (!folio) {
      do { folio = this.nf(); } while ([...persistedState.open, ...persistedState.sales, ...persistedState.kitchenTickets].some(record => record.folio === folio));
    }
    const actor = this.user();
    if (!actor?.id || !actor?.name) { this.notAllowed('cancelar cuentas'); return 'keep'; }
    const occurredAt = new Date().toISOString();
    const origin = persistedState.kitchenTickets.find(ticket => ticket.folio === folio);
    let subtotalCents; let totalCents;
    try {
      subtotalCents = source.items.reduce((sum, item) => {
        if (!Number.isSafeInteger(item.qty) || item.qty < 1) throw new RangeError('invalid quantity');
        const next = sum + moneyToCents(this.lineUnit(item)) * item.qty;
        if (!Number.isSafeInteger(next)) throw new RangeError('invalid total');
        return next;
      }, 0);
      totalCents = subtotalCents - Math.min(subtotalCents, moneyToCents(source.discount || 0));
    } catch {
      this.toast('Revisa cantidades y precios antes de cancelar.', 'warn'); return 'keep';
    }
    const trimmedReason = reason.trim();
    const sale = {
      folio, cancellationCommandId: commandId, day: 0, fecha: 'Hoy · ' + this.now(),
      createdTime: source.time || origin?.time || null,
      creo: source.user || source.responsible || source.actorName || origin?.user || actor.name,
      actorId: source.actorId || origin?.actorId || actor.id, actorName: source.actorName || source.user || source.responsible || origin?.user || actor.name,
      cobro: '—', tipo: source.ref || this.refOf(source),
      items: source.items.map(item => ({ ...item, name: item.capturedSnapshot?.name || item.productNameSnapshot || item.name,
        qty: item.qty, mods: this.modsText(item), unit: this.lineUnit(item), total: this.lineUnit(item) * item.qty })),
      payments: [], tip: 0, subtotalCents, discount: source.discount || 0,
      total: centsToMoney(totalCents), status: 'cancelada', sync: st.online ? 'sincronizada' : 'pendiente',
      motivo: trimmedReason, cancelledAt: occurredAt, cancelledBy: actor.name, cancelledById: actor.id, cancelledByActorId: actor.id, cancelledByActorName: actor.name,
      audit: [[occurredAt, 'Cancelada · ' + trimmedReason, actor.name]]
    };
    const patch = {
      open: persistedState.open.filter(account => account.folio !== folio),
      kitchenTickets: cancelKitchenTicket(persistedState.kitchenTickets, folio, actor.name, occurredAt, trimmedReason),
      sales: [sale, ...persistedState.sales],
      order: target.fromStation || st.order.folio === folio ? this.blank() : st.order,
      pending: st.online ? persistedState.pending || st.pending : [...(persistedState.pending || st.pending), 'Cancelación ' + folio],
    };
    // Store before announcing success or clearing the station; failed storage leaves it repairable.
    try {
      localStorage.setItem(this._storageKey || 'karma-pos-v1', JSON.stringify({ ...persisted, ...patch, folioSeq: this._folio }));
    } catch { this.toast('No se pudo guardar la cancelación. La cuenta sigue abierta.', 'warn'); return 'keep'; }
    this.setState(patch);
    this.toast(folio + ' cancelada');
  }
  openSaleCompensation(folio, kind) {
    if (!this.requireAction('refundSaleWithReason')) return;
    const sale = this.state.sales.find(record => record.folio === folio);
    let remaining;
    try { remaining = saleTotalCents(sale) - compensationTotalCents(sale); }
    catch { this.toast('El historial de pagos requiere revisión antes de devolver dinero.', 'warn'); return; }
    if (sale.status !== 'completada' || remaining <= 0 || (kind === 'void' && compensationTotalCents(sale) !== 0)) {
      this.toast('Esta venta ya no admite la devolución propuesta.', 'warn'); return;
    }
    const expectedSnapshot = JSON.stringify(sale);
    const commandId = globalThis.crypto.randomUUID();
    this.setState({ repSel: null, dlg: {
      title: kind === 'void' ? 'Anular venta ' + folio : 'Registrar reembolso de ' + folio,
      body: 'Registra solo dinero ya devuelto manualmente. Se conservarán la venta y los pagos originales. La devolución externa y la compensación de inventario requieren verificación aparte.',
      needReason: true, confirmLabel: kind === 'void' ? 'Registrar anulación manual' : 'Registrar reembolso manual',
      ...(kind === 'refund' ? { refundPaymentOptions: (Array.isArray(sale.payments) ? sale.payments : []).filter(payment => payment && typeof payment === 'object').map((payment, index) => ({ id: payment.paymentId || `${sale.folio}:legacy-payment:${index}`, label: payment.methodLabel || compensationMethodLabels.get(payment.method) || payment.method })), fields: [{ key: 'monto', label: 'Importe devuelto', value: centsToMoney(remaining).toFixed(2) }] } : {}),
      onConfirm: dialog => this.confirmSaleCompensation({ folio, kind, commandId, expectedSnapshot, paymentId: dialog.paymentId || null, amount: kind === 'void' ? centsToMoney(remaining).toFixed(2) : dialog.fields?.[0]?.value, reason: dialog.reason }),
    } });
  }
  confirmSaleCompensation({ folio, kind, commandId, expectedSnapshot, paymentId, amount, reason }) {
    if (!this.requireAction('refundSaleWithReason', reason)) return 'keep';
    let persisted; let source; let planned;
    try {
      persisted = JSON.parse(localStorage.getItem(this._storageKey || 'karma-pos-v1')) || {};
      if (!Array.isArray(persisted.sales)) throw new Error('missing history');
      for (const key of ['open', 'kitchenTickets', 'pending', 'prods']) if (persisted[key] !== undefined && !Array.isArray(persisted[key])) throw new Error('invalid saved collection');
      if (persisted.order !== undefined && (!persisted.order || typeof persisted.order !== 'object' || !Array.isArray(persisted.order.items))) throw new Error('invalid saved draft');
      if (persisted.orderSettings !== undefined && (!persisted.orderSettings || typeof persisted.orderSettings !== 'object' || !Number.isInteger(persisted.orderSettings.tableCount) || persisted.orderSettings.tableCount < 1 || persisted.orderSettings.tableCount > MAX_TABLE_COUNT)) throw new Error('invalid table settings');
      if (persisted.folioSeq !== undefined && (!Number.isSafeInteger(persisted.folioSeq) || persisted.folioSeq < 1)) throw new Error('invalid folio sequence');
      source = persisted.sales.find(record => record.folio === folio);
      const live = this.state.sales.find(record => record.folio === folio);
      const duplicate = Array.isArray(source?.compensations) && source.compensations.some(event => event.commandId === commandId);
      if (!duplicate && (JSON.stringify(source) !== expectedSnapshot || JSON.stringify(live) !== expectedSnapshot)) throw new Error('changed source');
      const actor = this.user();
      planned = planSaleCompensation(source, { commandId, kind, amount, paymentId, reason, actorId: actor.id, actorName: actor.name, occurredAt: new Date().toISOString() });
    } catch {
      this.toast('No se registró la devolución. Revisa importe, motivo, pagos capturados y cambios en el historial.', 'warn'); return 'keep';
    }
    if (!planned.changed) { this.toast('La devolución ya está registrada.'); return; }
    const sales = persisted.sales.map(record => record.folio === folio ? planned.sale : record);
    const oldPending = Array.isArray(persisted.pending) ? persisted.pending : this.state.pending;
    const pending = [...oldPending, 'Devolución ' + commandId];
    try { localStorage.setItem(this._storageKey || 'karma-pos-v1', JSON.stringify({ ...persisted, sales, pending })); }
    catch { this.toast('No se pudo guardar la devolución. El historial sigue intacto; intenta de nuevo.', 'warn'); return 'keep'; }
    const restored = { sales, pending, repSel: folio };
    for (const key of ['open', 'kitchenTickets', 'prods', 'flags', 'orderSettings']) if (persisted[key] !== undefined) restored[key] = persisted[key];
    if (persisted.order) restored.order = restoreStoredOrder(persisted.order);
    this._folio = Math.max(this._folio, persisted.folioSeq || 0);
    this.setState(restored, () => this.toast('Devolución manual registrada; verifica por separado dinero e inventario.'));
  }
  invDialog(tipo, label, needsPerm) {
    if (!this.requireAction('adjustInventory')) return;
    this.setState({
      dlg: {
        title: label, body: 'La operación quedará registrada en movimientos con tu usuario y fecha.', needReason: true, confirmLabel: 'Registrar',
        fields: [{ key: 'item', label: 'Artículo', ph: 'P. ej. Leche entera', value: '' }, { key: 'qty', label: 'Cantidad y unidad', ph: 'P. ej. −2 L', value: '' }],
        onConfirm: d => {
          if (!this.requireAction('adjustInventory', d.reason || '')) return 'keep';
          const f = {}; (d.fields || []).forEach(x => f[x.key] = x.value);
          if (!f.item || !f.qty) { this.toast('Captura artículo y cantidad', 'warn'); return 'keep'; }
          const actor = this.user();
          this.setState(s => ({ movs: [{ id: 'm' + Date.now(), tipo, item: f.item, qty: f.qty, user: actor.name, actorId: actor.id, date: 'Hoy · ' + this.now(), motivo: d.reason.trim() }, ...s.movs] }));
          this.toast(label + ' registrada');
        }
      }
    });
  }
  renderVals() {
    const D = window.KARMA;
    const s = this.state;
    const acc = '#836953', tint = '#f6e5df', paper = '#faf9f5', ink = '#141413', mut = '#6b6a63', line = '#e2e0d6', bg = '#f0eee6';
    const chip = on => ({ padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: '1px solid ' + (on ? acc : line), background: on ? acc : paper, color: on ? paper : ink, whiteSpace: 'nowrap' });
    const chipSm = on => ({ padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid ' + (on ? acc : line), background: on ? acc : paper, color: on ? paper : ink, whiteSpace: 'nowrap' });
    const tag = (b, c) => ({ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 999, background: b, color: c, whiteSpace: 'nowrap', justifySelf: 'start' });
    const prepTags = { 'en-cola': ['En cola', bg, mut], preparando: ['Preparando', tint, acc], listo: ['Listo', acc, paper], entregado: ['Entregado', bg, mut] };
    const syncTags = { sincronizada: ['Sincronizada', 'transparent', '#a8a69c'], pendiente: ['Por sincronizar', tint, acc], conflicto: ['Conflicto', ink, paper] };
    const secureMode = this.isSecureMode();
    const accessContext = secureMode ? this.accessContext() : null;
    const V = { loading: secureMode ? false : s.loading, two: 2, dlgFields: [] };

    // ---- login
    const pu = s.usersX.find(u => u.id === s.pick) || s.usersX[0];
    V.isLogin = !secureMode && !s.loading && !s.session;
    V.isSecureGate = secureMode && (!accessContext || accessContext.capability !== 'cash_register');
    V.accessScreen = this.props.accessScreen;
    V.accessControls = this.props.accessControls;
    V.loginUsers = s.usersX.map(u => ({
      name: u.name.split(' ')[0], roleLabel: D.roleLabels[u.role], active: u.id === s.pick, enabled: u.active,
      pick: () => this.up({ pick: u.id, pin: '', pinErr: u.active ? '' : 'Acceso desactivado — contacta a la dueña' })
    }));
    V.pickName = pu ? pu.name.split(' ')[0] : '';
    V.pinDots = [0, 1, 2, 3].map(i => ({ style: { width: 13, height: 13, borderRadius: '50%', border: '1px solid ' + (i < s.pin.length ? acc : line), background: i < s.pin.length ? acc : 'transparent' } }));
    V.pinMsg = s.pinErr || ' ';
    V.pinMsgStyle = { fontSize: 12.5, minHeight: 16, color: acc, textAlign: 'center' };
    V.keypad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', 'C'].map(k => ({
      label: k,
      press: () => {
        let pin = s.pin;
        if (k === 'C') pin = ''; else if (k === '←') pin = pin.slice(0, -1); else if (pin.length < 4) pin += k;
        if (pin.length === 4) {
          const u = this.state.usersX.find(x => x.id === this.state.pick);
          if (u && u.active && u.pin === pin) {
            this.up({ session: u.id, pin: '', pinErr: '', module: u.role === 'cocina' ? 'ordenes' : 'pos' }, () => this.toast('Hola, ' + u.name.split(' ')[0] + ' — estación abierta'));
          } else this.setState({ pin: '', pinErr: u && !u.active ? 'Acceso desactivado' : 'PIN incorrecto, intenta de nuevo' });
        } else this.setState({ pin, pinErr: '' });
      }
    }));

    // ---- shell
    const me = this.user();
    V.isApp = secureMode ? Boolean(accessContext && accessContext.capability === 'cash_register') : !s.loading && !!s.session;
    V.userName = me ? me.name : ''; V.userRoleLabel = me ? this.roleLabel() : '';
    V.userInitials = me ? me.name.split(' ').map(x => x[0]).slice(0, 2).join('') : '';
    V.switchUser = () => {
      if (secureMode) this.setState({ ck: null, dlg: null, ed: null, module: 'pos', selUser: null, suForm: null, createdCredential: null }, () => { this.persist(); this.props.onSwitchIdentity?.(); });
      else this.up({ session: null, pin: '', pinErr: '' });
    };
    V.goPos = () => this.navAllowed('pos') ? this.up({ module: 'pos', ck: null }) : this.notAllowed('usar la estación de venta');
    const mods = [['pos', 'Punto de venta'], ['ordenes', 'Órdenes abiertas'], ['menu', 'Menú'], ['inventario', 'Inventario'], ['reportes', 'Reportes'], ['config', 'Usuarios y configuración']];
    V.navItems = mods.map(([id, label]) => {
      const active = s.module === id; const allowed = this.navAllowed(id);
      return {
        label, active, allowed, hasBadge: id === 'ordenes' && s.open.length > 0, badge: s.open.length,
        go: () => this.navAllowed(id) ? this.up({ module: id, ck: null, repSel: null }) : this.notAllowed('abrir «' + label + '»')
      };
    });
    V.online = s.online; V.offline = !s.online && !!me && !s.loading;
    V.connDotStyle = { width: 9, height: 9, borderRadius: '50%', flex: 'none', background: s.online ? acc : 'transparent', border: '1px solid ' + acc };
    V.connLabel = s.online ? 'Conectado' : 'Sin conexión';
    V.connSub = secureMode ? 'Datos locales · sincronización entre dispositivos pendiente' : s.syncing ? 'Sincronizando…' : (s.pending.length ? s.pending.length + ' operaciones pendientes' : 'Todo sincronizado');
    V.connToggleLabel = s.online ? 'Simular pérdida de conexión' : 'Restablecer conexión';
    V.showConnectionToggle = !secureMode;
    V.toggleOnline = () => {
      const on = !s.online;
      this.up({ online: on }, () => {
        if (!on) this.toast('Modo sin conexión — el flujo de venta sigue disponible', 'warn');
        else if (this.state.pending.length) this.doSync();
      });
    };
    V.showSyncBtn = !secureMode && s.online && s.pending.length > 0 && !s.syncing;
    V.pendingCount = s.pending.length; V.syncNow = () => this.doSync(); V.syncing = s.syncing;
    V.toasts = s.toasts.map(t => ({ msg: t.msg, kind: t.kind }));

    // ---- module flags
    V.mPos = s.module === 'pos'; V.mOrders = s.module === 'ordenes'; V.mMenu = s.module === 'menu';
    V.mInv = s.module === 'inventario'; V.mRep = s.module === 'reportes'; V.mCfg = s.module === 'config';
    V.mCheckout = s.module === 'checkout' && !!s.ck;

    // ---- POS catalog
    const vista = this.props.vistaCatalogo ?? 'cuadricula';
    const showAgotados = this.props.mostrarAgotados ?? true;
    V.search = s.search; V.setSearch = e => this.setState({ search: e.target.value });
    V.cats = D.categories.map(c => ({ label: c.label, active: s.cat === c.id && !s.search, pick: () => this.setState({ cat: c.id, search: '' }) }));
    let plist = s.prods.filter(p => s.search ? p.name.toLowerCase().includes(s.search.toLowerCase()) : p.cat === s.cat);
    if (!showAgotados) plist = plist.filter(p => p.available);
    V.prodsEmpty = plist.length === 0;
    V.gridStyle = vista === 'lista' ? { display: 'flex', flexDirection: 'column', gap: 8 } : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 };
    V.prods = plist.map(p => ({
      id: p.id, name: p.name, price: this.fmt(p.price), unavailable: !p.available,
      style: { display: 'flex', flexDirection: vista === 'lista' ? 'row' : 'column', justifyContent: 'space-between', gap: 8, alignItems: vista === 'lista' ? 'center' : 'stretch', textAlign: 'left', padding: '13px 14px', background: paper, border: '1px solid ' + line, borderRadius: 10, cursor: p.available ? 'pointer' : 'default', opacity: p.available ? 1 : 0.55, minHeight: vista === 'lista' ? 0 : 76 },
      open: () => {
        if (!this.requireAction('openOrder')) return;
        if (!p.available) { this.toast(p.name + ' está agotado hoy', 'warn'); return; }
        const m = {}; p.mods.forEach(g => { const G = D.modGroups[g]; const first = G && G.options.find(op => op.active !== false); if (G && G.min > 0 && first) m[g] = [first.id]; });
        this.setState({ ed: { prodId: p.id, qty: 1, mods: m, notes: '', lineId: null } });
      }
    }));

    // ---- current order
    const o = s.order; const ot = this.orderTotals(o);
    V.hasFolio = !!o.folio; V.orderFolio = o.folio || '';
    V.typeBtns = [['local', 'En local'], ['mesa', 'Mesa'], ['llevar', 'Llevar'], ['domicilio', 'Domicilio'], ['recoger', 'Recoger']].map(([id, label]) => ({ label, active: o.type === id, pick: () => this.mutateOrder('order_type_changed', order => ({ ...order, type: id })) }));
    V.showMesa = o.type === 'mesa';
    const tableOptions = Array.from({ length: s.orderSettings.tableCount }, (_, index) => ({ value: String(index + 1), label: 'Mesa ' + (index + 1) }));
    const currentMesa = textField(o.mesa, 32);
    if (currentMesa && !tableOptions.some(option => option.value === currentMesa)) {
      tableOptions.push({ value: currentMesa, label: /^\d+$/.test(currentMesa) ? 'Mesa ' + currentMesa + ' · histórica' : 'Referencia histórica · ' + currentMesa });
    }
    V.tableOptions = tableOptions;
    V.mesa = currentMesa;
    V.mesaSelection = currentMesa ? 'mesa:' + currentMesa : '__sin_mesa__';
    V.setMesa = value => {
      const mesa = value === '__sin_mesa__' ? '' : typeof value === 'string' && value.startsWith('mesa:') ? textField(value.slice(5), 32) : '';
      this.mutateOrder('table_assignment_changed', order => ({ ...order, mesa }));
    };
    V.orderName = o.name; V.setOrderName = e => this.mutateOrder('order_name_changed', order => ({ ...order, name: e.target.value }));
    V.orderNameLabel = o.type === 'domicilio' ? 'Nombre de quien recibe' : ['llevar', 'recoger'].includes(o.type) ? 'Nombre para recoger' : 'Nombre o referencia';
    V.orderNameRequired = o.type === 'domicilio' || ['llevar', 'recoger'].includes(o.type);
    V.showOrderPhone = V.orderNameRequired;
    V.orderPhone = o.phone || ''; V.setOrderPhone = e => this.mutateOrder('order_phone_changed', order => ({ ...order, phone: e.target.value }));
    V.showOrderAddress = o.type === 'domicilio';
    V.orderAddress = o.address || ''; V.setOrderAddress = e => this.mutateOrder('order_address_changed', order => ({ ...order, address: e.target.value }));
    V.linesEmpty = o.items.length === 0;
    V.lines = o.items.map(l => ({
      lineId: l.lineId,
      qty: l.qty, name: l.capturedSnapshot?.name || l.productNameSnapshot || l.name || (s.prods.find(p => p.id === l.prodId) || {}).name || '—',
      modsText: this.modsText(l), hasMods: !!this.modsText(l), notes: l.notes, hasNotes: !!l.notes,
      total: this.lineUnit(l) === null ? 'Precio por verificar' : this.fmt(this.lineUnit(l) * l.qty),
      inc: () => this.mutateOrder('quantity_increased', order => ({ ...order, items: order.items.map(x => {
        if (x.lineId !== l.lineId) return x;
        const qty = x.qty + 1;
        return { ...x, qty, ...(x.capturedSnapshot ? { capturedSnapshot: { ...x.capturedSnapshot, quantity: qty, lineTotalCents: x.capturedSnapshot.unitPriceCents * qty } } : {}) };
      }) })),
      dec: () => this.mutateOrder('quantity_decreased', order => ({ ...order, items: order.items.map(x => {
        if (x.lineId !== l.lineId) return x;
        const qty = Math.max(1, x.qty - 1);
        return { ...x, qty, ...(x.capturedSnapshot ? { capturedSnapshot: { ...x.capturedSnapshot, quantity: qty, lineTotalCents: x.capturedSnapshot.unitPriceCents * qty } } : {}) };
      }) })),
      remove: () => this.mutateOrder('line_removed', order => ({ ...order, items: order.items.filter(x => x.lineId !== l.lineId) }), () => this.toast('Producto eliminado de la orden')),
      edit: () => this.requireAction('openOrder') && this.setState({ ed: { prodId: l.prodId, qty: l.qty, mods: JSON.parse(JSON.stringify(l.mods || {})), notes: l.notes || '', lineId: l.lineId, capturedSnapshot: l.capturedSnapshot, name: l.capturedSnapshot?.name || l.productNameSnapshot || l.name, unit: l.unit, modsText: this.modsText(l) } })
    }));
    V.itemCount = o.items.reduce((a, l) => a + l.qty, 0);
    V.subtotal = ot.sub === null ? 'Precio por verificar' : this.fmt(ot.sub); V.hasDiscount = ot.disc > 0; V.discount = this.fmt(ot.disc); V.total = ot.total === null ? 'Precio por verificar' : this.fmt(ot.total);
    V.addDiscount = () => {
      if (!this.can('discountWithReason')) { this.notAllowed('aplicar descuentos'); return; }
      this.setState({ dlg: { title: 'Aplicar descuento', body: 'El descuento se resta del subtotal y queda auditado con tu usuario.', needReason: true, confirmLabel: 'Aplicar', fields: [{ key: 'monto', label: 'Monto (MXN)', ph: '0.00', value: '' }], onConfirm: d => { if (!this.requireAction('discountWithReason', d.reason || '') || !this.needItems()) return 'keep'; const f = (d.fields || []).find(x => x.key === 'monto'); const v = parseFloat(f && f.value) || 0; if (v <= 0) { this.toast('Captura un monto válido', 'warn'); return 'keep'; } const actor = this.user(); this.mutateOrder('discount_applied', order => ({ ...order, discount: v, discountReason: d.reason.trim(), discountActorId: actor.id, discountActorName: actor.name })); this.toast('Descuento de ' + this.fmt(v) + ' aplicado'); } } });
    };
    V.saveOpen = () => { const f = this.saveOpen(); if (f) this.toast('Cuenta ' + f + ' guardada como abierta'); };
    V.sendComanda = () => {
      if (!this.requireAction('openOrder')) return;
      if (!this.needItems()) return;
      if (!this.needCapturedPrices()) return;
      const f = this.saveOpen(true);
      if (!f) return;
      this.toast('Comanda ' + f + ' enviada a cocina y barra');
    };
    V.goCharge = () => { if (!this.requireAction('checkout') || !this.needItems()) return; const oo = this.state.order; this.startCheckout(oo.folio, oo.items, oo.discount, this.typeLabel(oo.type) + (oo.type === 'mesa' && oo.mesa ? ' ' + oo.mesa : ''), true); };
    V.cancelOrder = () => this.openCancellation({ folio: this.state.order.folio, fromStation: true });

    // ---- editor
    const ed = s.ed;
    V.ed = !!ed;
    if (ed) {
      const p = s.prods.find(x => x.id === ed.prodId) || { name: ed.name || '', price: 0, mods: [] };
      const unit = this.lineUnit(ed) ?? (!ed.lineId ? this.previewLineUnit(ed) : null);
      V.edName = ed.name || p.name; V.edPrice = ed.unit != null ? this.fmt(ed.unit) : (ed.capturedSnapshot ? this.fmt(ed.capturedSnapshot.unitPriceCents / 100) : (!ed.lineId ? this.fmt(p.price) : 'Precio por verificar')); V.edQty = ed.qty;
      V.edInc = () => this.setState({ ed: { ...ed, qty: ed.qty + 1 } });
      V.edDec = () => this.setState({ ed: { ...ed, qty: Math.max(1, ed.qty - 1) } });
      V.edGroups = p.mods.map(gid => {
        const G = D.modGroups[gid]; if (!G || G.active === false) return null;
        const sel = ed.mods[gid] || [];
        return {
          label: G.label, hint: G.min > 0 ? 'Obligatorio · elige ' + G.min + (G.max > G.min ? '–' + G.max : '') : (G.max === 1 ? 'Elige hasta 1' : 'Opcional, varios'),
          options: G.options.filter(op => op.active !== false).map(op => {
            const on = sel.includes(op.id);
            return {
              text: op.label + (op.price ? ' +$' + op.price : ''), active: on,
              disabled: on && G.max !== 1 && sel.length <= G.min,
              toggle: () => {
                const ns = toggleModifierSelection(sel, op.id, { min: G.min, max: G.max });
                if (on && ns.length === sel.length) { this.toast('Elige al menos ' + G.min + ' opción(es) para ' + G.label, 'warn'); return; }
                this.setState({ ed: { ...this.state.ed, mods: { ...this.state.ed.mods, [gid]: ns } } });
              }
            };
          })
        };
      }).filter(Boolean);
      V.edNotes = ed.notes; V.edSetNotes = e => this.setState({ ed: { ...this.state.ed, notes: e.target.value } });
      V.edConfirmLabel = (ed.lineId ? 'Guardar' : 'Agregar') + ' · ' + (unit === null ? 'Precio por verificar' : this.fmt(unit * ed.qty));
      V.edCancel = () => this.setState({ ed: null });
      V.edConfirm = () => {
        if (!this.requireAction('openOrder')) return;
        const st = this.state; const e2 = st.ed;
        if (e2.lineId) {
          const original = st.order.items.find(x => x.lineId === e2.lineId);
          const oldMods = original?.mods || {};
          const sameMods = sameCapturedModifiers(oldMods, e2.mods);
          if (!sameMods) {
            this.toast('Para cambiar modificadores, elimina el producto y agrégalo de nuevo. Así se confirma cualquier precio vigente.', 'warn');
            return;
          }
          const items = st.order.items.map(x => x.lineId === e2.lineId ? {
            ...x, qty: e2.qty, notes: e2.notes,
            ...(x.capturedSnapshot ? { capturedSnapshot: { ...x.capturedSnapshot, quantity: e2.qty, notes: e2.notes, lineTotalCents: x.capturedSnapshot.unitPriceCents * e2.qty } } : {})
          } : x);
          this.up({ order: this.stampOrder({ ...st.order, items }, 'line_updated'), ed: null }, () => this.toast((e2.name || p.name) + ' actualizado'));
          return;
        }
        let normalizedMods;
        let currentCatalog;
        let captured;
        try {
          // Reconcile only at capture time, so a malformed legacy localStorage
          // price cannot break rendering or prevent the menu editor from fixing it.
          currentCatalog = normalizeCatalog({ ...window.KARMA, products: st.prods });
        } catch (error) {
          this.toast('No se puede agregar hasta corregir el catálogo. Revisa los precios en Menú y guarda las correcciones.', 'warn');
          return;
        }
        try {
          const product = st.prods.find(x => x.id === e2.prodId);
          const selections = Object.fromEntries((product?.mods || []).flatMap(gid => {
            const group = currentCatalog.modifierGroups.find(item => item.id === gid);
            if (!group?.active) return [];
            const optionIds = e2.mods[gid] ?? (group.selection.defaultOptionId ? [group.selection.defaultOptionId] : []);
            return [[gid, { optionIds }]];
          }));
          captured = captureProductLine(currentCatalog, { productId: e2.prodId, quantity: e2.qty, selections, notes: e2.notes });
          normalizedMods = Object.fromEntries(Object.entries(selections).map(([groupId, selection]) => [groupId, selection.optionIds]));
        } catch (error) {
          this.toast(error.message || 'Revisa las opciones obligatorias', 'warn');
          return;
        }
        const linePatch = { prodId: e2.prodId, qty: e2.qty, mods: normalizedMods, notes: e2.notes };
        let items;
        items = [...st.order.items, {
          lineId: 'l' + Date.now(), ...linePatch,
          capturedSnapshot: captured, name: captured.name, productNameSnapshot: captured.name,
          unit: captured.unitPriceCents / 100,
          modsText: this.modsText({ mods: normalizedMods })
        }];
        const actor = this.user();
        this.up({ order: this.stampOrder({ ...st.order, items, actorId: st.order.actorId || actor.id, actorName: st.order.actorName || actor.name }, 'line_added'), ed: null }, () => this.toast(p.name + ' agregado a la orden'));
      };
    } else { V.edName = ''; V.edPrice = ''; V.edQty = 1; V.edGroups = []; V.edNotes = ''; V.edSetNotes = () => {}; V.edInc = V.edDec = V.edCancel = V.edConfirm = () => {}; V.edConfirmLabel = ''; }

    // ---- open orders
    V.ordersCount = s.open.length; V.ordersEmpty = s.open.length === 0;
    V.orders = s.open.map(oo => {
      const totals = this.orderTotalsCents(oo);
      const prep = (s.kitchenTickets.find(ticket => ticket.folio === oo.folio) || oo).prep;
      const pt = prepTags[prep] || prepTags['en-cola']; const st2 = syncTags[oo.sync] || syncTags.sincronizada;
      return {
        folio: oo.folio, total: totals === null ? 'Precio por verificar' : this.fmt(centsToMoney(totals.totalCents)),
        prepLabel: pt[0], prepVariant: prep === 'listo' ? 'success' : prep === 'preparando' ? 'pending' : 'outline',
        syncLabel: st2[0], syncVariant: oo.sync === 'pendiente' ? 'pending' : oo.sync === 'conflicto' ? 'conflict' : 'outline',
        meta: this.typeLabel(oo.type) + ' · ' + textField(oo.reference || oo.ref || this.typeLabel(oo.type)) + ' · ' + textField(oo.time || '—', 40) + ' · ' + textField(oo.responsible || oo.user || '—', 100),
        itemsText: oo.items.map(l => l.qty + '× ' + l.name).join(' · '),
        conflict: oo.sync === 'conflicto',
        resume: () => {
          if (!this.requireAction('openOrder')) return;
          const status = this.orderSourceStatus(oo.folio, 'open');
          const source = this.state.open.find(entry => entry.folio === oo.folio);
          if (status !== 'available' || !source) { this.blockOrderSource(status); return; }
          const items = source.items.map((l, i) => ({ ...l, lineId: 'l' + Date.now() + i, prodId: l.prodId, qty: l.qty, mods: l.mods || {}, notes: l.notes || '', unit: this.lineUnit(l), name: l.capturedSnapshot?.name || l.productNameSnapshot || l.name, modsText: this.modsText(l) }));
          const mesa = source.type === 'mesa' ? textField(source.mesa, 32) || tableFromReference(source.reference || source.ref) : '';
          this.up({ order: this.stampOrder({ folio: source.folio, type: source.type, mesa, name: textField(source.name, 100), phone: textField(source.phone, 40), address: textField(source.address, 240), user: textField(source.user || source.responsible, 100), responsible: textField(source.responsible || source.user, 100), time: textField(source.time, 40), items, discount: source.discount || 0, actorId: source.actorId, actorName: source.actorName || source.user, actorHistory: source.actorHistory || [] }, 'order_resumed'), open: this.state.open.filter(x => x.folio !== source.folio), module: 'pos' }, () => this.toast(source.folio + ' abierta en la estación'));
        },
        charge: () => this.startCheckout(oo.folio, oo.items, oo.discount, this.typeLabel(oo.type) + ' · ' + oo.ref, false),
        reprint: () => {
          const status = this.orderSourceStatus(oo.folio, 'open');
          if (status !== 'available') { this.blockOrderSource(status); return; }
          this.requestReprint(oo.folio, 'preparation');
        },
        split: () => {
          if (!this.requireAction('openOrder')) return;
          const status = this.orderSourceStatus(oo.folio, 'open');
          const source = this.state.open.find(entry => entry.folio === oo.folio);
          if (status !== 'available' || !source) { this.blockOrderSource(status); return; }
          if (source.items.length < 2) { this.toast('La cuenta necesita al menos 2 productos para dividirse', 'warn'); return; }
          this.setState({ dlg: { title: 'Dividir ' + oo.folio, body: 'Se creará un folio nuevo con la mitad de los productos. Después podrás cobrar cada cuenta por separado.', confirmLabel: 'Dividir cuenta', onConfirm: () => {
            if (!this.requireAction('openOrder')) return 'keep';
            const st = this.state;
            const currentStatus = this.orderSourceStatus(oo.folio, 'open');
            const src = st.open.find(entry => entry.folio === oo.folio);
            if (currentStatus !== 'available' || !src) { this.blockOrderSource(currentStatus); return 'keep'; }
            if (src.items.length < 2) { this.toast('La cuenta necesita al menos 2 productos para dividirse', 'warn'); return 'keep'; }
            const half = Math.ceil(src.items.length / 2); const nfo = this.nf(); const b = { ...src, folio: nfo, items: src.items.slice(half), time: this.now(), ref: src.ref + ' (2)' }; const a = { ...src, items: src.items.slice(0, half) };
            this.up({ open: [b, ...st.open.map(x => x.folio === oo.folio ? a : x)] }); this.toast(oo.folio + ' dividida — nueva cuenta ' + nfo);
          } } });
        },
        cancel: () => this.cancelOpen(oo.folio)
      };
    });

    // ---- checkout
    const ck = s.ck;
    if (ck) {
      const m = this.ckMath(ck);
      V.ckFolio = ck.folio || 'Nueva venta'; V.ckTypeLabel = ck.type;
      const stepIdx = { review: 0, pay: 1, confirm: 2, processing: 2, result: 2 }[ck.step] || 0;
      V.ckSteps = ['Resumen', 'Pago', 'Confirmación'].map((label, i) => ({ label, state: i === stepIdx ? 'current' : i < stepIdx ? 'complete' : 'upcoming' }));
      V.ckLines = ck.lines.map(l => ({ qty: l.qty, name: l.name, modsText: l.modsText, hasMods: !!l.modsText, total: this.fmt(l.unit * l.qty) }));
      V.ckItemCount = ck.lines.reduce((a, l) => a + l.qty, 0);
      V.ckSubtotal = this.fmt(ck.sub); V.ckHasDiscount = ck.disc > 0; V.ckDiscount = this.fmt(ck.disc);
      V.ckTip = this.fmt(m.tip); V.ckTotal = this.fmt(m.total);
      V.ckReview = ck.step === 'review'; V.ckPay = ck.step === 'pay'; V.ckConfirm = ck.step === 'confirm';
      V.ckProcessing = ck.step === 'processing'; V.ckResult = ck.step === 'result';
      V.ckOk = ck.ok === true; V.ckFail = ck.ok === false; V.ckError = ck.error;
      const retune = (patch) => {
        const nk = { ...this.state.ck, ...patch };
        if (nk.pays.length === 1) { const m2 = this.ckMath({ ...nk, pays: [{ ...nk.pays[0], amount: '0' }] }); nk.pays = [{ ...nk.pays[0], amount: m2.total.toFixed(2) }]; }
        this.setState({ ck: nk });
      };
      V.tipBtns = [['0', 'Sin propina'], ['5', '5%'], ['10', '10%'], ['15', '15%'], ['20', '20%'], ['otro', 'Otra']].map(([id, label]) => ({ label, active: ck.tipSel === id, pick: () => retune({ tipSel: id }) }));
      V.showTipCustom = ck.tipSel === 'otro' && (s.flags.propCustom !== false);
      V.tipCustom = ck.tipCustom; V.setTipCustom = e => retune({ tipCustom: e.target.value });
      V.tipEquivalent = V.showTipCustom && m.baseCents > 0
        ? `Equivale a ${(m.tipCents / m.baseCents * 100).toFixed(2)}% del subtotal después del descuento.`
        : '';
      const methodList = [['efectivo', 'Efectivo', s.flags.fpEfectivo], ['tarjeta', 'Tarjeta', s.flags.fpTarjeta], ['transferencia', 'Transferencia', s.flags.fpTransfer]].filter(x => x[2] !== false);
      V.pays = ck.pays.map(p => ({
        amount: p.amount,
        methods: methodList.map(([id, label]) => ({ label, active: p.method === id, pick: () => this.setCk({ pays: ck.pays.map(x => x.id === p.id ? { ...x, method: id } : x) }) })),
        amountLabel: 'Monto con ' + (methodList.find(([id]) => id === p.method)?.[1] || 'método de pago'),
        setAmount: e => this.setCk({ pays: this.state.ck.pays.map(x => x.id === p.id ? { ...x, amount: e.target.value } : x) }),
        fillRest: () => {
          const m2 = this.ckMath(ck);
          let otherTenderCents = 0;
          for (const entry of ck.pays.filter(x => x.id !== p.id)) {
            try { otherTenderCents += moneyToCents(entry.amount); } catch { /* Blank/invalid rows remain flagged until edited. */ }
          }
          const amountCents = Math.max(0, (m2.totalCents || 0) - otherTenderCents);
          this.setCk({ pays: ck.pays.map(x => x.id === p.id ? { ...x, amount: centsToMoney(amountCents).toFixed(2) } : x) });
        },
        canRemove: ck.pays.length > 1,
        remove: () => this.setCk({ pays: ck.pays.filter(x => x.id !== p.id) })
      }));
      V.addPay = () => this.setCk({ pays: [...ck.pays, { id: Date.now(), method: 'tarjeta', amount: m.remaining.toFixed(2) }] });
      V.paid = this.fmt(m.paid); V.remaining = this.fmt(m.remaining);
      V.hasChange = m.change > 0; V.change = this.fmt(m.change);
      V.hasPayMsg = !m.valid;
      V.payMsg = m.error || (m.over > 0 && !m.hasCash ? 'El monto capturado excede el total y no hay efectivo para dar cambio.' : 'El monto cubierto aún no coincide con el total de la orden.');
      V.payValid = m.valid;
      V.confirmPays = (m.payments || []).filter(p => p.tenderedCents > 0).map(p => ({
        method: ({ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' })[p.method],
        amount: this.fmt(centsToMoney(p.netAmountCents)),
        hasCashChange: p.method === 'cash' && p.changeCents > 0,
        tendered: this.fmt(centsToMoney(p.tenderedCents)),
        change: this.fmt(centsToMoney(p.changeCents)),
      }));
      V.hasManualExternalPayment = (m.payments || []).some(p => p.netAmountCents > 0 && p.method !== 'cash');
      V.manualExternalPaymentNote = 'Tarjeta y transferencia se registran manualmente; su autorización externa no está verificada.';
      V.ckNext = () => { if (ck.step === 'review') this.setCk({ step: 'pay' }); else if (ck.step === 'pay' && m.valid) this.setCk({ step: 'confirm' }); };
      V.ckBack = () => this.setCk({ step: ck.step === 'confirm' ? 'pay' : 'review' });
      V.ckExit = () => this.up({ ck: null, module: ck.fromStation ? 'pos' : 'ordenes' });
      V.ckRegister = () => this.register();
      V.ckRetry = () => this.register();
      V.ckChangeMethod = () => this.setCk({ step: 'pay', ok: null });
      V.hasResultChange = ck.change > 0; V.resultChange = this.fmt(ck.change);
      V.resultSyncNote = s.online ? 'Venta ' + (ck.folio || '') + ' sincronizada con el respaldo.' : 'Venta guardada localmente — se sincronizará al reconectar.';
      V.ckPrint = () => this.requestReprint(ck.folio, 'receipt');
      V.ckNew = () => this.up({ ck: null, module: 'pos' });
    } else {
      Object.assign(V, { ckFolio: '', ckTypeLabel: '', ckSteps: [], ckLines: [], ckItemCount: 0, ckSubtotal: '', ckHasDiscount: false, ckDiscount: '', ckTip: '', ckTotal: '', ckReview: false, ckPay: false, ckConfirm: false, ckProcessing: false, ckResult: false, ckOk: false, ckFail: false, ckError: '', tipBtns: [], showTipCustom: false, tipCustom: '', tipEquivalent: '', setTipCustom: () => {}, pays: [], addPay: () => {}, paid: '', remaining: '', hasChange: false, change: '', hasPayMsg: false, payMsg: '', payValid: false, confirmPays: [], hasManualExternalPayment: false, manualExternalPaymentNote: '', ckNext: () => {}, ckBack: () => {}, ckExit: () => {}, ckRegister: () => {}, ckRetry: () => {}, ckChangeMethod: () => {}, hasResultChange: false, resultChange: '', resultSyncNote: '', ckPrint: () => {}, ckNew: () => {} });
    }

    // ---- menu admin
    const counts = {}; s.prods.forEach(p => counts[p.cat] = (counts[p.cat] || 0) + 1);
    V.admCats = [{ id: 'all', label: 'Todo el menú' }, ...D.categories].map(c => ({
      label: c.label, count: c.id === 'all' ? s.prods.length : (counts[c.id] || 0),
      active: s.admCat === c.id,
      pick: () => this.setState({ admCat: c.id })
    }));
    V.admNewCat = () => this.toast('Editor de categorías y grupos — próximamente en esta etapa', 'warn');
    V.admSearch = s.admSearch; V.setAdmSearch = e => this.setState({ admSearch: e.target.value });
    const aplist = s.prods.filter(p => (s.admCat === 'all' || p.cat === s.admCat) && (!s.admSearch || p.name.toLowerCase().includes(s.admSearch.toLowerCase())));
    const catLabel = id => (D.categories.find(c => c.id === id) || {}).label || id;
    V.admProds = aplist.map(p => ({
      name: p.name, catLabel: catLabel(p.cat), price: this.fmt(p.price),
      availLabel: p.available ? 'Activo' : 'Inactivo', availVariant: p.available ? 'success' : 'outline',
      active: s.admSel === p.id,
      pick: () => this.requireAction('editMenu') && this.setState({ admSel: p.id, admForm: { name: p.name, price: String(p.price), cat: p.cat, available: p.available } })
    }));
    V.admNew = () => this.requireAction('editMenu') && this.setState({ admSel: 'new', admForm: { name: '', price: '', cat: s.admCat === 'all' ? 'concafe' : s.admCat, available: true } });
    const af = s.admForm;
    V.hasAdmSel = !!s.admSel && !!af;
    V.catOptions = D.categories.map(c => ({ id: c.id, label: c.label }));
    if (af) {
      const selP = s.prods.find(p => p.id === s.admSel);
      V.fName = af.name; V.setFName = e => this.requireAction('editMenu') && this.setState({ admForm: { ...this.state.admForm, name: e.target.value } });
      V.fPrice = af.price; V.setFPrice = e => this.requireAction('editMenu') && this.setState({ admForm: { ...this.state.admForm, price: e.target.value } });
      V.fCat = af.cat; V.setFCat = value => this.requireAction('editMenu') && this.setState({ admForm: { ...this.state.admForm, cat: value } });
      V.fAvailLabel = af.available ? 'Disponible en el POS' : 'No disponible (agotado)';
      V.fAvailStyle = chipSm(af.available);
      V.fToggleAvail = () => this.requireAction('editMenu') && this.setState({ admForm: { ...this.state.admForm, available: !this.state.admForm.available } });
      V.fMods = (selP ? selP.mods : []).map(g => ({ label: D.modGroups[g].label, meta: D.modGroups[g].options.length + ' opciones' + (D.modGroups[g].min ? ' · obligatorio' : '') }));
      const rec = D.recipes.find(r => selP && r.product === selP.name);
      V.fInv = rec ? rec.items.map(([n, use]) => ({ name: n, use: use + ' por unidad' })) : [{ name: 'Sin receta asociada', use: '' }];
      V.pvName = af.name || 'Nuevo producto'; V.pvPrice = this.fmt(parseFloat(af.price) || 0);
      V.admClose = () => this.setState({ admSel: null, admForm: null });
      V.admSave = () => {
        if (!this.can('editMenu')) { this.notAllowed('editar productos del menú'); return; }
        const saveProduct = reason => {
          const st = this.state; const f = st.admForm;
          let prods;
          try {
            const saved = saveMenuProduct(st.prods, st.admSel, f, 'x' + Date.now());
            if (this.isSecureMode()) {
              const actor = this.user();
              prods = saved.map(product => product.id === (st.admSel === 'new' ? saved[0]?.id : st.admSel)
                ? { ...product, lastModifiedActorId: actor.id, lastModifiedActorName: actor.name, lastModifiedReason: reason.trim() }
                : product);
            } else prods = saved;
          } catch (error) {
            this.toast(error.message || 'Revisa nombre, categoría y precio del producto', 'warn');
            return 'keep';
          }
          this.up({ prods, admSel: null, admForm: null }, () => this.toast(this.isSecureMode() ? '«' + f.name + '» guardado localmente con el motivo registrado' : '«' + f.name + '» guardado en el menú'));
        };
        if (!this.isSecureMode()) { saveProduct(''); return; }
        this.setState({ dlg: { title: 'Guardar cambios del menú', body: 'La razón y la identidad que autorizó este cambio quedarán en el registro local de la estación.', needReason: true, confirmLabel: 'Guardar cambios', onConfirm: d => {
          if (!this.requireAction('editMenu', d.reason || '')) return 'keep';
          return saveProduct(d.reason || '');
        } } });
      };
    } else { Object.assign(V, { fName: '', setFName: () => {}, fPrice: '', setFPrice: () => {}, fCat: '', setFCat: () => {}, fAvailLabel: '', fAvailStyle: {}, fToggleAvail: () => {}, fMods: [], fInv: [], pvName: '', pvPrice: '', admClose: () => {}, admSave: () => {} }); }

    // ---- inventory
    V.invTabs = [['stock', 'Existencias'], ['mov', 'Movimientos'], ['rec', 'Recetas']].map(([id, label]) => ({ label, active: s.invTab === id, pick: () => this.setState({ invTab: id }) }));
    V.tStock = s.invTab === 'stock'; V.tMov = s.invTab === 'mov'; V.tRec = s.invTab === 'rec';
    V.invSearch = s.invSearch; V.setInvSearch = e => this.setState({ invSearch: e.target.value });
    V.toggleLow = () => this.setState({ invLow: !s.invLow });
    V.lowToggleActive = s.invLow;
    let inv = D.inventory.filter(i => !s.invSearch || i.name.toLowerCase().includes(s.invSearch.toLowerCase()));
    if (s.invLow) inv = inv.filter(i => i.qty <= i.min);
    V.stockEmpty = inv.length === 0;
    V.stock = inv.map(i => {
      const low = i.qty <= i.min;
      return { name: i.name, kind: i.kind, qty: i.qty + ' ' + i.unit, min: i.min + ' ' + i.unit, tagLabel: low ? 'Stock bajo' : 'OK', tagVariant: low ? 'pending' : 'outline' };
    });
    const movTags = { entrada: ['Entrada', 'pending'], merma: ['Merma', 'destructive'], ajuste: ['Ajuste', 'outline'], venta: ['Venta', 'secondary'] };
    V.movs = s.movs.map(mv => { const t = movTags[mv.tipo]; return { tipoLabel: t[0], tagVariant: t[1], item: mv.item, qty: mv.qty, user: mv.user, date: mv.date, motivo: mv.motivo }; });
    V.recs = D.recipes.map(r => ({ product: r.product, items: r.items.map(([name, use, conv]) => ({ name, use, conv })) }));
    V.regEntrada = () => this.invDialog('entrada', 'Registrar entrada', false);
    V.regMerma = () => this.invDialog('merma', 'Registrar merma', false);
    V.regAjuste = () => this.invDialog('ajuste', 'Ajuste manual de inventario', true);

    // ---- reports
    V.ranges = [['hoy', 'Hoy'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días']].map(([id, label]) => ({ label, active: s.range === id, pick: () => this.setState({ range: id }) }));
    const lim = s.range === 'hoy' ? 0 : s.range === '7d' ? 6 : 30;
    const rs = s.sales.filter(x => (x.day || 0) <= lim);
    const done = rs.filter(x => x.status === 'completada');
    V.repVentas = this.fmt(done.reduce((a, x) => a + x.total, 0));
    V.repTickets = done.length;
    V.repProps = this.fmt(done.reduce((a, x) => a + x.tip, 0));
    V.repCanc = rs.length - done.length;
    const mmCents = paymentMethodTotalsCents(done);
    const mmax = Math.max(1, ...Object.values(mmCents));
    V.methods = Object.keys(mmCents).map(k => ({ label: k, amount: this.fmt(centsToMoney(mmCents[k])), barStyle: { height: 5, borderRadius: 999, background: acc, width: (mmCents[k] / mmax * 100).toFixed(0) + '%' } }));
    const tp = {}; done.forEach(x => x.items.forEach(i => { tp[i.name] = tp[i.name] || { q: 0, a: 0 }; tp[i.name].q += i.qty; tp[i.name].a += i.total; }));
    V.topProds = Object.keys(tp).sort((a, b) => tp[b].a - tp[a].a).slice(0, 6).map(k => ({ name: k, qty: tp[k].q, amount: this.fmt(tp[k].a) }));
    const bu = {}; done.forEach(x => { bu[x.cobro] = bu[x.cobro] || { t: 0, a: 0 }; bu[x.cobro].t += 1; bu[x.cobro].a += x.total; });
    V.byUser = Object.keys(bu).map(k => ({ name: k, meta: bu[k].t + ' tickets', amount: this.fmt(bu[k].a) }));
    let refundedCents = 0;
    let voidCount = 0;
    let refundCount = 0;
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - lim);
    for (const sale of s.sales) {
      for (const event of Array.isArray(sale.compensations) ? sale.compensations : []) {
        if (event && ['refund', 'void'].includes(event.kind) && Number.isSafeInteger(event.amountCents) && event.amountCents > 0 && Date.parse(event.occurredAt) >= start.getTime() && Date.parse(event.occurredAt) <= Date.now()) {
          const next = refundedCents + event.amountCents;
          if (Number.isSafeInteger(next)) refundedCents = next;
          if (event.kind === 'void') voidCount += 1; else refundCount += 1;
        }
      }
    }
    V.repRefunds = this.fmt(centsToMoney(refundedCents)); V.repRefundCount = refundCount; V.repVoids = voidCount;
    V.repNet = this.fmt(done.reduce((sum, sale) => sum + sale.total, 0) - centsToMoney(refundedCents));
    const stTags = { completada: ['Completada', 'success'], cancelada: ['Cancelada', 'destructive'], reembolsada: ['Reembolsada', 'outline'] };
    const compensationLabel = sale => {
      if (!Array.isArray(sale.compensations) || !sale.compensations.length) return stTags[sale.status][0];
      try {
        const returned = compensationTotalCents(sale);
        const suffix = sale.compensations.some(event => event.kind === 'void') ? 'anulada' : returned === saleTotalCents(sale) ? 'reembolsada' : 'reembolso parcial';
        return stTags[sale.status][0] + ' · ' + suffix;
      } catch { return stTags[sale.status][0] + ' · devoluciones por revisar'; }
    };
    V.repSales = rs.map(x => ({ folio: x.folio, fecha: x.fecha, tipo: x.tipo, user: x.cobro, total: this.fmt(x.total), statusLabel: compensationLabel(x), statusVariant: stTags[x.status][1], syncLabel: x.sync === 'pendiente' ? 'Por sincronizar' : 'Sincronizada', syncVariant: x.sync === 'pendiente' ? 'pending' : 'outline', open: () => this.setState({ repSel: x.folio }) }));
    V.exportar = () => this.toast('ventas_abboth_' + s.range + '.xlsx exportado (simulado)');
    const sel = s.sales.find(x => x.folio === s.repSel);
    V.hasRepSel = !!sel;
    if (sel) {
      V.dFolio = sel.folio; V.dStatusLabel = compensationLabel(sel); V.dStatusVariant = stTags[sel.status][1];
      V.dMeta = sel.fecha + ' · ' + sel.tipo + ' — creó ' + sel.creo + ' · cobró ' + sel.cobro + ' · ' + (sel.sync === 'pendiente' ? 'por sincronizar' : 'sincronizada');
      V.dHasMotivo = !!sel.motivo; V.dMotivo = sel.motivo || '';
      V.dItems = sel.items.map(i => ({ qty: i.qty, name: i.name, mods: i.mods, hasMods: !!i.mods, total: this.fmt(i.total) }));
      const isExternalPayment = payment => {
        const method = String(payment?.methodLabel || payment?.method || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return ['card', 'tarjeta', 'transfer', 'transferencia'].includes(method);
      };
      const externalPayments = (Array.isArray(sel.payments) ? sel.payments : []).filter(isExternalPayment);
      const externallyUnverified = sel.externalPaymentVerification === 'manual_unverified'
        || externalPayments.some(payment => payment.verificationStatus === 'manual_unverified');
      V.dPaymentVerificationMessage = externallyUnverified
        ? 'Registro manual · autorización externa no verificada.'
        : externalPayments.length > 0
          ? 'Verificación externa sin dato registrado en este historial.'
          : '';
      const salePaymentRows = Array.isArray(sel.tenders) ? sel.tenders : sel.payments;
      V.dPays = salePaymentRows.map(p => ({
        method: p.methodLabel || ({ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', credit: 'Crédito' })[p.method] || p.method,
        amount: this.fmt(centsToMoney(paymentNetCents(p) ?? 0)),
        hasCashChange: Number.isSafeInteger(p.tenderedCents ?? p.cashReceivedCents) && Number.isSafeInteger(p.changeCents) && p.changeCents > 0,
        tendered: Number.isSafeInteger(p.tenderedCents ?? p.cashReceivedCents) ? this.fmt(centsToMoney(p.tenderedCents ?? p.cashReceivedCents)) : '',
        change: Number.isSafeInteger(p.changeCents) ? this.fmt(centsToMoney(p.changeCents)) : '',
      }));
      V.dTip = this.fmt(sel.tip); V.dTotal = this.fmt(sel.total);
      V.dCompensations = (Array.isArray(sel.compensations) ? sel.compensations : []).map(event => ({ id: event.commandId, kind: event.kind === 'void' ? 'Anulación manual' : 'Reembolso manual', amount: this.fmt(centsToMoney(event.amountCents)), actor: event.actorName, date: event.occurredAt, reason: event.reason, allocations: (Array.isArray(event.allocations) ? event.allocations : []).map(entry => ({ label: compensationMethodLabels.get(entry.method) || 'Pago', amount: this.fmt(centsToMoney(entry.amountCents)) })) }));
      let availableRefund = false; let availableVoid = false;
      try { const refunded = compensationTotalCents(sel); availableRefund = refunded < saleTotalCents(sel); availableVoid = refunded === 0; } catch { /* Require reconciliation before any compensation. */ }
      V.canRefundSale = this.can('refundSaleWithReason') && sel.status === 'completada' && availableRefund;
      V.canVoidSale = V.canRefundSale && availableVoid;
      V.refundSale = () => this.openSaleCompensation(sel.folio, 'refund'); V.voidSale = () => this.openSaleCompensation(sel.folio, 'void');
      V.dAudit = sel.audit.map(a => ({ t: a[0], e: a[1], u: a[2] }));
      V.closeDetail = () => this.setState({ repSel: null });
    } else { Object.assign(V, { dFolio: '', dStatusLabel: '', dStatusVariant: 'outline', dMeta: '', dHasMotivo: false, dMotivo: '', dItems: [], dPaymentVerificationMessage: '', dPays: [], dTip: '', dTotal: '', dAudit: [], dCompensations: [], canRefundSale: false, canVoidSale: false, refundSale: () => {}, voidSale: () => {}, closeDetail: () => {} }); }

    // ---- users & config
    V.cfgTabs = (this.isSecureMode() && !this.can('manageUsers') ? [['config', 'Configuración']] : [['usuarios', 'Usuarios'], ['config', 'Configuración']]).map(([id, label]) => ({ label, active: s.cfgTab === id, pick: () => this.setState({ cfgTab: id }) }));
    V.cUsers = s.cfgTab === 'usuarios' && (!this.isSecureMode() || this.can('manageUsers'));
    V.cCfg = s.cfgTab === 'config' || (this.isSecureMode() && !this.can('manageUsers') && this.can('configureTables'));
    V.tableCount = s.orderSettings.tableCount;
    V.tableCountDraft = s.tableCountDraft;
    V.setTableCountDraft = e => this.setState({ tableCountDraft: e.target.value });
    V.canConfigureTables = this.can('configureTables');
    V.saveTableCount = () => {
      const count = Number(this.state.tableCountDraft);
      if (!Number.isSafeInteger(count) || count < 1 || count > MAX_TABLE_COUNT) {
        this.toast('Elige un número de mesas entre 1 y ' + MAX_TABLE_COUNT + '.', 'warn');
        return;
      }
      const allowed = typeof this.requireAction === 'function'
        ? this.requireAction('configureTables')
        : this.can('configureTables');
      if (!allowed) {
        if (typeof this.requireAction !== 'function') this.notAllowed('configurar las mesas disponibles');
        return;
      }
      this.up({ orderSettings: { ...this.state.orderSettings, tableCount: count }, tableCountDraft: String(count) }, () => this.toast('Mesas disponibles actualizadas: ' + count));
    };
    V.newUser = (accountMethod = 'existing') => {
      if (!this.requireAction('manageUsers')) return;
      this.setState({ createdCredential: null, selUser: 'new', suForm: { name: '', userId: '', email: '', accountMethod, role: this.isSecureMode() ? 'barra' : 'cajero', active: true, perms: null } });
    };
    const memberRows = this.isSecureMode()
      ? (this.props.branchMembers || []).map(member => ({ id: member.userId, name: member.displayName, role: member.role, active: member.active, userId: member.userId }))
      : s.usersX;
    V.userCredentialHeading = this.isSecureMode() ? 'Cuenta Auth' : 'PIN';
    V.usersRows = memberRows.map(u => ({
      name: u.name, roleLabel: this.isSecureMode() ? this.roleLabel(u.role) : D.roleLabels[u.role], credentialLabel: this.isSecureMode() ? u.userId.slice(0, 8) + '…' : '••••',
      activeLabel: u.active ? 'Activo' : 'Inactivo', activeVariant: u.active ? 'success' : 'outline',
      toggleLabel: u.active ? 'Desactivar' : 'Activar',
      selected: s.selUser === u.id,
      pick: () => {
        if (!this.requireAction('manageUsers')) return;
        this.setState({ selUser: u.id, suForm: { name: u.name, userId: u.userId || u.id, role: u.role, active: u.active, perms: null } });
      },
      toggleActive: () => {
        if (!this.requireAction('manageUsers')) return;
        if (this.isSecureMode()) {
          Promise.resolve(this.props.onSetMemberActive?.(u.id, !u.active)).then(() => this.toast(u.name + (u.active ? ' desactivado' : ' activado'))).catch(error => this.toast(error.message || 'No se pudo actualizar el acceso', 'warn'));
          return;
        }
        this.up({ usersX: s.usersX.map(x => x.id === u.id ? { ...x, active: !x.active } : x) }, () => this.toast(u.name + (u.active ? ' desactivado' : ' activado')));
      }
    }));
    const permDefaults = r => ({
      dueno: ['Cobrar órdenes', 'Cancelar con motivo', 'Aplicar descuentos', 'Editar menú', 'Ajustar inventario', 'Ver reportes', 'Administrar usuarios'],
      encargado: ['Cobrar órdenes', 'Cancelar con motivo', 'Aplicar descuentos', 'Editar menú', 'Ajustar inventario', 'Ver reportes'],
      cajero: ['Cobrar órdenes'],
      cocina: []
    })[r] || [];
    const su = s.suForm;
    V.hasSelUser = !!s.selUser && !!su;
    if (su) {
      const perms = su.perms || permDefaults(su.role);
      V.suName = su.name; V.setSuName = e => this.setState({ suForm: { ...su, name: e.target.value } });
      const roleOptions = this.isSecureMode()
        ? [['duena', 'Dueña'], ['encargado', 'Encargado'], ['barra', 'Barra'], ['mesero', 'Mesero']]
        : Object.entries(D.roleLabels);
      V.suUserId = su.userId || '';
      V.setSuUserId = e => this.setState({ suForm: { ...su, userId: e.target.value } });
      V.suEmail = su.email || '';
      V.setSuEmail = e => this.setState({ suForm: { ...su, email: e.target.value } });
      V.suAccountMethod = su.accountMethod || 'existing';
      V.suRoles = roleOptions.map(([r, label]) => ({ label, active: su.role === r, pick: () => this.setState({ suForm: { ...su, role: r, perms: null } }) }));
      V.suPerms = this.isSecureMode() ? [] : ['Cobrar órdenes', 'Cancelar con motivo', 'Aplicar descuentos', 'Editar menú', 'Ajustar inventario', 'Ver reportes', 'Administrar usuarios'].map(p => {
        const on = perms.includes(p);
        return { label: p, active: on, toggle: () => this.setState({ suForm: { ...su, perms: on ? perms.filter(x => x !== p) : [...perms, p] } }) };
      });
      const audits = this.isSecureMode() ? [] : s.sales.flatMap(x => (x.audit || []).filter(a => a[2] === su.name).map(a => ({ t: x.fecha.split(' · ')[0] + ' ' + a[0], e: a[1] + ' · ' + x.folio }))).slice(0, 6);
      V.suAudit = audits.length ? audits : [{ t: '—', e: this.isSecureMode() ? 'El servidor aún no expone un historial de administración de cuentas.' : 'Sin acciones registradas todavía' }];
      V.suClose = () => this.setState({ selUser: null, suForm: null, createdCredential: null });
      V.createdCredential = this.isSecureMode() && this.role() === 'duena' && s.createdCredential?.ownerUserId === this.accessContext()?.userId ? s.createdCredential : null;
      V.dismissCreatedCredential = () => this.setState({ createdCredential: null });
      V.suSave = () => {
        if (!this.requireAction('manageUsers')) return;
        const st = this.state; const f = st.suForm;
        if (!f.name) { this.toast('El usuario necesita nombre', 'warn'); return; }
        if (this.isSecureMode()) {
          if (st.selUser === 'new' && f.accountMethod === 'create') {
            const ownerUserId = this.accessContext()?.userId;
            Promise.resolve(this.props.onCreateMember?.({ email: f.email, displayName: f.name, role: f.role, active: f.active })).then(credential => {
              if (this.accessContext()?.userId !== ownerUserId || this.role() !== 'duena') return;
              this.setState({ selUser: null, suForm: null, createdCredential: { ...credential, ownerUserId } }, () => this.toast('Cuenta Auth individual creada para «' + f.name + '»'));
            }).catch(error => this.toast(error.message || 'No se pudo crear la cuenta Auth', 'warn'));
            return;
          }
          const userId = st.selUser === 'new' ? f.userId : st.selUser;
          Promise.resolve(this.props.onManageMember?.({ userId, displayName: f.name, role: f.role, active: f.active })).then(() => {
            this.up({ selUser: null, suForm: null }, () => this.toast('Acceso de «' + f.name + '» guardado en Supabase'));
          }).catch(error => this.toast(error.message || 'No se pudo guardar el acceso', 'warn'));
          return;
        }
        let usersX;
        if (st.selUser === 'new') usersX = [...st.usersX, { id: 'u' + Date.now(), name: f.name, role: f.role, pin: '0000', active: f.active }];
        else usersX = st.usersX.map(u => u.id === st.selUser ? { ...u, name: f.name, role: f.role, active: f.active } : u);
        this.up({ usersX, selUser: null, suForm: null }, () => this.toast('Usuario «' + f.name + '» guardado' + (st.selUser === 'new' ? ' · PIN temporal 0000' : '')));
      };
    } else { Object.assign(V, { suName: '', setSuName: () => {}, suUserId: '', setSuUserId: () => {}, suRoles: [], suPerms: [], suAudit: [], suClose: () => {}, suSave: () => {} }); }
    V.createdCredential = this.isSecureMode() && this.role() === 'duena' && s.createdCredential?.ownerUserId === this.accessContext()?.userId ? s.createdCredential : null;
    V.dismissCreatedCredential = () => this.setState({ createdCredential: null });
    const togg = key => {
      const on = s.flags[key] !== false;
      return {
        hasToggle: true, hasValue: false,
        enabled: on,
        toggleId: 'setting-' + key,
        toggle: () => this.up({ flags: { ...this.state.flags, [key]: !on } })
      };
    };
    const row = (label, value) => ({ label, value, hasValue: true, hasToggle: false, toggle: () => {}, enabled: false, toggleId: '' });
    V.cfgCards = [
      { title: 'Datos del negocio', rows: [row('Nombre', 'Abboth'), row('Sucursal', 'Centro · única'), row('Moneda', 'MXN — pesos mexicanos'), row('Redes', '@Abboth.mx')], hasAction: false, action: () => {}, actionLabel: '' },
      { title: 'Impresión', rows: [row('Tickets', 'EPSON TM-T20 · Caja'), row('Comandas', 'Estrella SP700 · Cocina'), { label: 'Imprimir comanda automáticamente', ...togg('autoprint') }], hasAction: false, action: () => {}, actionLabel: '' },
      { title: 'Formas de pago', rows: [{ label: 'Efectivo', ...togg('fpEfectivo') }, { label: 'Tarjeta (registro manual)', ...togg('fpTarjeta') }, { label: 'Transferencia', ...togg('fpTransfer') }], hasAction: false, action: () => {}, actionLabel: '' },
      { title: 'Propinas', rows: [row('Sugerencias', '5% · 10% · 15% · 20%'), { label: 'Permitir propina personalizada', ...togg('propCustom') }], hasAction: false, action: () => {}, actionLabel: '' },
      { title: 'Reglas de cancelación', rows: [{ label: 'Requerir motivo', ...togg('cancelMotivo') }, { label: 'Autorización de encargado', ...togg('cancelAut') }], hasAction: false, action: () => {}, actionLabel: '' },
      { title: 'Respaldo y recuperación', rows: [row('Último respaldo', 'Hoy · 03:00'), row('Copias locales', '7 días retenidos')], hasAction: true, actionLabel: 'Respaldar ahora', action: () => this.toast('Respaldo local creado — Hoy · ' + this.now()) },
      { title: 'Sincronización', rows: [row('Estado', s.online ? 'Conectado' : 'Sin conexión'), row('Operaciones pendientes', String(s.pending.length)), row('Último contacto', s.online ? 'Hace unos segundos' : 'Hoy · 12:26')], hasAction: true, actionLabel: 'Forzar sincronización', action: () => this.doSync() }
    ];

    // ---- dialog
    const dg = s.dlg;
    V.dlg = !!dg;
    if (dg) {
      V.dlgTitle = dg.title; V.dlgBody = dg.body; V.dlgRefundPayments = dg.refundPaymentOptions || []; V.dlgRefundPayment = dg.paymentId ? 'payment:' + dg.paymentId : '__all__'; V.setDlgRefundPayment = value => this.setState({ dlg: { ...this.state.dlg, paymentId: value === '__all__' ? null : value.slice(8) } });
      V.dlgFields = (dg.fields || []).map(f => ({ label: f.label, value: f.value, ph: f.ph || '', inputMode: f.key === 'monto' ? 'decimal' : undefined, set: e => this.setState({ dlg: { ...this.state.dlg, fields: this.state.dlg.fields.map(x => x.key === f.key ? { ...x, value: e.target.value } : x) } }) }));
      V.dlgNeedReason = !!dg.needReason && s.flags.cancelMotivo !== false || !!dg.needReason;
      V.dlgReason = dg.reason || ''; V.setDlgReason = e => this.setState({ dlg: { ...this.state.dlg, reason: e.target.value } });
      V.hasDlgErr = !!dg.err; V.dlgErr = dg.err || '';
      V.dlgHasConfirm = !!dg.onConfirm;
      V.dlgCloseLabel = dg.onConfirm ? 'Volver' : (dg.closeLabel || 'Entendido');
      V.dlgConfirmLabel = dg.confirmLabel || 'Confirmar';
      V.dlgConfirmVariant = dg.danger ? 'destructive' : 'default';
      V.dlgClose = () => this.setState({ dlg: null });
      V.dlgConfirm = () => {
        const d = this.state.dlg;
        if (d.needReason && !(d.reason || '').trim()) { this.setState({ dlg: { ...d, err: 'El motivo es obligatorio para esta operación.' } }); return; }
        const r = d.onConfirm && d.onConfirm(d);
        if (r !== 'keep') this.setState({ dlg: null });
      };
    } else { Object.assign(V, { dlgTitle: '', dlgBody: '', dlgRefundPayments: [], dlgRefundPayment: '__all__', setDlgRefundPayment: () => {}, dlgFields: [], dlgNeedReason: false, dlgReason: '', setDlgReason: () => {}, hasDlgErr: false, dlgErr: '', dlgHasConfirm: false, dlgCloseLabel: '', dlgConfirmLabel: '', dlgConfirmStyle: {}, dlgClose: () => {}, dlgConfirm: () => {} }); }

    return V;
  }

  render() {
    const V = this.renderVals();
    return (
      <>

{(V.loading) && (<>
<div style={css("height:var(--karma-viewport-height,100vh);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px")}>
<div style={css("font-family:Georgia,serif;font-style:italic;font-size:36px")}>Karma</div>
<div style={css("width:22px;height:22px;border:2px solid #e2e0d6;border-top-color:#836953;border-radius:50%;animation:spin .8s linear infinite")}></div>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Cargando estación</div>
</div>
</>)}

{(V.isSecureGate) && V.accessScreen}

{(V.isLogin) && (<>
<div style={css("min-height:var(--karma-viewport-height,100vh);display:flex;align-items:center;justify-content:center;padding:32px")}>
<div style={css("width:420px;max-width:100%;display:flex;flex-direction:column;gap:24px;animation:rise .35s ease")}>
<div style={css("text-align:center")}>
<div style={css("font-family:Georgia,serif;font-style:italic;font-size:42px;line-height:1")}>Karma</div>
<div style={css("margin-top:8px;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Punto de venta · Abboth</div>
</div>
<div>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500;margin-bottom:10px")}>¿Quién abre la estación?</div>
<div style={css("display:flex;flex-wrap:wrap;gap:8px")}>
{(V.loginUsers).map((u, uI) => (<React.Fragment key={uI}>
<Button variant="outline" aria-pressed={u.active} aria-disabled={!u.enabled} className={`h-auto min-h-14 items-start flex-col px-3 py-2 ${u.active ? 'bg-accent text-accent-foreground' : ''} ${!u.enabled ? 'opacity-50' : ''}`} onClick={u.pick}><span className="font-medium text-sm">{u.name}</span><span className="text-xs text-muted-foreground">{u.roleLabel}</span></Button>
</React.Fragment>))}
</div>
</div>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:16px;align-items:center")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>PIN de {V.pickName}</div>
<div style={css("display:flex;gap:12px")}>
{(V.pinDots).map((d, dI) => (<React.Fragment key={dI}><span style={d.style}></span></React.Fragment>))}
</div>
<div style={V.pinMsgStyle}>{V.pinMsg}</div>
<div style={css("display:grid;grid-template-columns:repeat(3,72px);gap:10px")}>
{(V.keypad).map((k, kI) => (<React.Fragment key={kI}>
<Hover tag="button" onClick={k.press} base={css("height:56px;border:1px solid #e2e0d6;background:#faf9f5;border-radius:10px;font-size:19px;color:#141413;cursor:pointer")} hover={css("background:#f6e5df")}>{k.label}</Hover>
</React.Fragment>))}
</div>
</div>
<div style={css("text-align:center;font-size:12px;color:#6b6a63")}>Demo — Sofía 3333 · Iván 2222 · Marcela 1111</div>
</div>
</div>
</>)}

{(V.isApp) && (<>
{V.accessControls}
<SidebarProvider className="pos-shell" style={{ '--sidebar-width': '236px', '--sidebar-width-icon': '48px', '--sidebar-width-mobile': 'min(18rem, 88vw)' }}>
<Sidebar collapsible="offcanvas" className="pos-sidebar">
  <PosSidebarNavigation items={V.navItems} goPos={V.goPos} />
  <SidebarFooter className="gap-3 border-t border-sidebar-border px-3 pb-3 pt-3">
    <div className="flex min-w-0 items-center gap-2" aria-label={`Estado de conexión: ${V.connLabel}`}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={V.connDotStyle}></span>
      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{V.connLabel}</div><div className="truncate text-xs text-muted-foreground">{V.connSub}</div></div>
      <Badge variant={V.offline ? 'pending' : 'success'}>{V.pendingCount}</Badge>
    </div>
    {V.showSyncBtn && <Button variant="secondary" className="min-h-11 justify-start" onClick={V.syncNow}>Sincronizar ahora ({V.pendingCount})</Button>}
    {V.showConnectionToggle && <Button variant="outline" className="min-h-11 justify-start text-left" onClick={V.toggleOnline}>{V.connToggleLabel}</Button>}
    <a className="flex min-h-11 items-center px-1 text-sm" href={`${import.meta.env.BASE_URL}comanda.html`}>Ver comanda de cocina →</a>
    <div className="flex min-w-0 items-center gap-2 border-t border-sidebar-border pt-3">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">{V.userInitials}</span>
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{V.userName}</div><div className="text-xs text-muted-foreground">{V.userRoleLabel}</div></div>
      <Button variant="link" className="min-h-11 px-1" onClick={V.switchUser}>Salir</Button>
    </div>
  </SidebarFooter>
</Sidebar>

<main className="pos-main">
<header className="pos-mobile-bar">
  <SidebarTrigger className="size-11" aria-label="Abrir menú de navegación" />
  <div className="min-w-0 flex-1">
    <div className="truncate text-sm font-medium">Karma · {V.navItems.find(item => item.active)?.label || 'Punto de venta'}</div>
    <div className="truncate text-xs text-muted-foreground">{V.connLabel} · {V.pendingCount} pendientes</div>
  </div>
  <Button variant="ghost" className="min-h-11 shrink-0 px-2" onClick={V.switchUser} aria-label={`Salir de la estación de ${V.userName}`}>{V.userInitials} · Salir</Button>
</header>
{(V.offline) && (<>
<div className="pos-offline-banner" style={css("background:#f6e5df;color:#836953;font-size:12.5px;font-weight:500;padding:8px 24px;position:sticky;top:0;z-index:40")}>Sin conexión — puedes seguir vendiendo; las operaciones se guardan localmente y se sincronizarán al reconectar.</div>
</>)}

{(V.mPos) && (<SalesStation V={V} />)}

{(V.mOrders) && (<>
<div className="pos-module" style={css("padding:var(--pos-module-padding,22px 24px 40px);display:flex;flex-direction:column;gap:16px")}>
<div style={css("display:flex;align-items:baseline;gap:12px")}>
<h1 style={css("font-size:19px;font-weight:500;margin:0")}>Órdenes abiertas</h1>
<span style={css("font-size:12.5px;color:#6b6a63")}>{V.ordersCount} cuentas pendientes</span>
</div>
{(V.ordersEmpty) && (<>
<div style={css("padding:60px 20px;text-align:center;color:#6b6a63;font-size:13.5px;border:1px dashed #e2e0d6;border-radius:12px")}>No hay cuentas abiertas.<br />Guarda una orden desde el punto de venta para verla aquí.</div>
</>)}
<div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr));gap:12px")}>
{(V.orders).map((o, oI) => (<React.Fragment key={oI}>
<Card className="gap-3 p-4">
<div style={css("display:flex;align-items:center;gap:8px")}>
<span style={css("font-size:14px;font-weight:500")}>{o.folio}</span>
<Badge variant={o.prepVariant}>{o.prepLabel}</Badge>
<Badge variant={o.syncVariant}>{o.syncLabel}</Badge>
<span style={css("margin-left:auto;font-size:15px;font-weight:500")}>{o.total}</span>
</div>
<div style={css("font-size:12.5px;color:#6b6a63")}>{o.meta}</div>
<div style={css("font-size:12.5px;color:#141413;line-height:1.5")}>{o.itemsText}</div>
{(o.conflict) && (<>
<div style={css("background:#f6e5df;border-radius:8px;padding:9px 12px;display:flex;align-items:center;gap:10px")}>
<span style={css("font-size:12px;color:#836953;flex:1")}>Conflicto pendiente: las versiones requieren revisión de sincronización. Esta cuenta está bloqueada para cambios y cobros.</span>
</div>
</>)}
<div style={css("display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid #e2e0d6;padding-top:10px")}>
<Button size="sm" onClick={o.resume} disabled={o.conflict}>Abrir</Button>
<Button size="sm" variant="secondary" onClick={o.charge} disabled={o.conflict}>Cobrar</Button>
<Button size="sm" variant="outline" onClick={o.reprint} disabled={o.conflict}>Comanda</Button>
<Button size="sm" variant="outline" onClick={o.split} disabled={o.conflict}>Dividir</Button>
<Button size="sm" variant="ghost" className="ml-auto" onClick={o.cancel} disabled={o.conflict}>Cancelar</Button>
</div>
</Card>
</React.Fragment>))}
</div>
</div>
</>)}

{(V.mCheckout) && (<>
<div className="pos-module" style={css("max-width:960px;margin:0 auto;padding:var(--pos-module-padding,22px 24px 48px);display:flex;flex-direction:column;gap:18px")}>
<div style={css("display:flex;align-items:center;gap:14px;flex-wrap:wrap")}>
<Button type="button" variant="outline" onClick={V.ckExit}>← Volver</Button>
<h1 style={css("font-size:19px;font-weight:500;margin:0")}>Cobro · {V.ckFolio}</h1>
<div style={css("margin-left:auto;display:flex;gap:6px;flex-wrap:wrap")} aria-label="Progreso del cobro">
{(V.ckSteps).map((s, sI) => (<Badge key={sI} variant={s.state === 'current' ? 'default' : s.state === 'complete' ? 'secondary' : 'outline'} aria-current={s.state === 'current' ? 'step' : undefined}>{s.label}</Badge>))}
</div>
</div>
<div style={css("display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap")}>
<Card className="min-w-0 flex-[1_1_260px] gap-3 p-4 sm:flex-none sm:basis-[340px]">
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Resumen · {V.ckTypeLabel}</div>
<div style={css("display:flex;flex-direction:column")}>
{(V.ckLines).map((l, lI) => (<React.Fragment key={lI}>
<div style={css("display:flex;gap:8px;padding:8px 0;border-bottom:1px solid #e2e0d6;font-size:13px")}>
<span style={css("color:#6b6a63;flex:none")}>{l.qty}×</span>
<span style={css("flex:1;min-width:0")}><span style={css("font-weight:500")}>{l.name}</span>{(l.hasMods) && (<><span style={css("color:#6b6a63")}> · {l.modsText}</span></>)}</span>
<span style={css("flex:none")}>{l.total}</span>
</div>
</React.Fragment>))}
</div>
<div style={css("display:flex;justify-content:space-between;font-size:13px;color:#6b6a63")}><span>Subtotal</span><span>{V.ckSubtotal}</span></div>
{(V.ckHasDiscount) && (<><div style={css("display:flex;justify-content:space-between;font-size:13px;color:#836953")}><span>Descuento</span><span>−{V.ckDiscount}</span></div></>)}
<div style={css("display:flex;justify-content:space-between;font-size:13px;color:#6b6a63")}><span>Propina</span><span>{V.ckTip}</span></div>
<div style={css("display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #e2e0d6;padding-top:10px")}>
<span style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Total</span>
<span style={css("font-family:Georgia,serif;font-style:italic;font-size:32px;line-height:1")}>{V.ckTotal}</span>
</div>
</Card>

<Card className="min-w-0 flex-[2_1_360px] gap-4 p-4 sm:p-5">
{(V.ckReview) && (<>
<div style={css("font-size:15px;font-weight:500")}>Revisa la orden</div>
<div style={css("font-size:13.5px;color:#6b6a63;line-height:1.6")}>{V.ckItemCount} artículos · {V.ckTypeLabel}.<br />Verifica productos y cantidades antes de continuar. Puedes volver para editar la orden.</div>
<Button type="button" size="lg" className="self-start" onClick={V.ckNext}>Continuar al pago</Button>
</>)}
{(V.ckPay) && (<>
<div>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500;margin-bottom:8px")}>Propina</div>
<div style={css("display:flex;gap:6px;flex-wrap:wrap;align-items:center")}>
{(V.tipBtns).map((t, tI) => (<Button key={tI} type="button" size="sm" variant={t.active ? 'default' : 'outline'} aria-pressed={t.active} onClick={t.pick}>{t.label}</Button>))}
{(V.showTipCustom) && (<div className="flex flex-wrap items-center gap-2"><Label className="sr-only" htmlFor="checkout-tip">Monto de propina en pesos</Label><Input id="checkout-tip" value={V.tipCustom} onChange={V.setTipCustom} placeholder="Monto MXN" inputMode="decimal" className="w-32" />{V.tipEquivalent && <span className="text-xs text-muted-foreground" aria-live="polite">{V.tipEquivalent}</span>}</div>)}
</div>
</div>
{(V.hasManualExternalPayment) && (<div role="status" className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">{V.manualExternalPaymentNote}</div>)}
<div style={css("display:flex;flex-direction:column;gap:10px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Pago</div>
{(V.pays).map((p, pI) => (<React.Fragment key={pI}>
<div style={css("display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px solid #e2e0d6;border-radius:10px;padding:10px 12px;background:#f0eee6")}>
<div style={css("display:flex;gap:5px")}>
{(p.methods).map((m, mI) => (<Button key={mI} type="button" size="sm" variant={m.active ? 'default' : 'outline'} aria-pressed={m.active} onClick={m.pick}>{m.label}</Button>))}
</div>
<Label className="sr-only" htmlFor={`checkout-amount-${pI}`}>{p.amountLabel}</Label>
<Input id={`checkout-amount-${pI}`} value={p.amount} onChange={p.setAmount} inputMode="decimal" className="ml-auto w-28 text-right" />
<Button type="button" variant="ghost" size="sm" onClick={p.fillRest}>Restante</Button>
{(p.canRemove) && (<Button type="button" variant="ghost" size="icon" aria-label={`Quitar pago ${pI + 1}`} onClick={p.remove}>×</Button>)}
</div>
</React.Fragment>))}
<Button type="button" variant="link" className="self-start px-0" onClick={V.addPay}>+ Dividir en otro método</Button>
</div>
<div style={css("display:flex;gap:18px;font-size:13px;color:#6b6a63;flex-wrap:wrap")}>
<span>Recibido <span style={css("color:#141413;font-weight:500")}>{V.paid}</span></span>
<span>Restante <span style={css("color:#141413;font-weight:500")}>{V.remaining}</span></span>
{(V.hasChange) && (<><span>Cambio <span style={css("color:#836953;font-weight:500")}>{V.change}</span></span></>)}
</div>
{(V.hasPayMsg) && (<><div style={css("font-size:12.5px;color:#836953;background:#f6e5df;border-radius:8px;padding:8px 12px")}>{V.payMsg}</div></>)}
<div style={css("display:flex;gap:8px")}>
<Button type="button" variant="outline" onClick={V.ckBack}>Atrás</Button>
<Button type="button" aria-disabled={!V.payValid} className={!V.payValid ? 'opacity-50' : ''} onClick={V.ckNext}>Continuar</Button>
</div>
</>)}
{(V.ckConfirm) && (<>
<div style={css("font-size:15px;font-weight:500")}>Confirmación final</div>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
{(V.confirmPays).map((cp, cpI) => (<React.Fragment key={cpI}>
<div style={css("display:flex;justify-content:space-between;font-size:13.5px;border-bottom:1px solid #e2e0d6;padding:7px 0")}><span>{cp.method} · neto</span><span style={css("font-weight:500")}>{cp.amount}</span></div>
{(cp.hasCashChange) && (<div style={css("display:flex;justify-content:space-between;font-size:12px;color:#6b6a63;margin-top:-5px")}><span>Recibido {cp.tendered} · cambio {cp.change}</span><span></span></div>)}
</React.Fragment>))}
<div style={css("display:flex;justify-content:space-between;font-size:13px;color:#6b6a63;padding:6px 0")}><span>Propina</span><span>{V.ckTip}</span></div>
{(V.hasChange) && (<><div style={css("display:flex;justify-content:space-between;font-size:13px;color:#836953;padding:2px 0")}><span>Cambio a entregar</span><span>{V.change}</span></div></>)}
</div>
<div style={css("font-size:12.5px;color:#6b6a63")}>Al confirmar se registrará el pago y la cuenta se cerrará. Esta acción queda en el historial de auditoría.</div>
{(V.hasManualExternalPayment) && (<div role="status" className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">{V.manualExternalPaymentNote}</div>)}
<div style={css("display:flex;gap:8px")}>
<Button type="button" variant="outline" onClick={V.ckBack}>Atrás</Button>
<Button type="button" size="lg" onClick={V.ckRegister}>Registrar pago {V.ckTotal}</Button>
</div>
</>)}
{(V.ckProcessing) && (<>
<div style={css("display:flex;flex-direction:column;align-items:center;gap:14px;padding:36px 0")}>
<div style={css("width:26px;height:26px;border:2px solid #e2e0d6;border-top-color:#836953;border-radius:50%;animation:spin .8s linear infinite")}></div>
<div style={css("font-size:13.5px;color:#6b6a63")}>Procesando pago…</div>
</div>
</>)}
{(V.ckResult) && (<>
{(V.ckOk) && (<>
<div style={css("display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 0;text-align:center")}>
<span style={css("width:52px;height:52px;border-radius:50%;background:#836953;color:#faf9f5;display:inline-flex;align-items:center;justify-content:center;font-size:24px")}>✓</span>
<div style={css("font-size:17px;font-weight:500")}>Pago registrado</div>
<div style={css("font-family:Georgia,serif;font-style:italic;font-size:30px;line-height:1")}>{V.ckTotal}</div>
{(V.hasManualExternalPayment) && (<div role="status" className="max-w-sm text-xs text-muted-foreground">{V.manualExternalPaymentNote}</div>)}
{(V.hasResultChange) && (<><div style={css("font-size:13.5px;color:#836953")}>Entrega {V.resultChange} de cambio</div></>)}
<div style={css("font-size:12.5px;color:#6b6a63")}>{V.resultSyncNote}</div>
<div style={css("display:flex;gap:8px;margin-top:6px")}>
<Button type="button" variant="outline" onClick={V.ckPrint}>Imprimir ticket</Button>
<Button type="button" onClick={V.ckNew}>Nueva venta</Button>
</div>
</div>
</>)}
{(V.ckFail) && (<>
<div style={css("display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 0;text-align:center")}>
<span style={css("width:52px;height:52px;border-radius:50%;border:1px solid #836953;color:#836953;display:inline-flex;align-items:center;justify-content:center;font-size:24px")}>!</span>
<div style={css("font-size:17px;font-weight:500")}>No se pudo procesar el pago</div>
<div style={css("font-size:13px;color:#6b6a63;max-width:360px")}>{V.ckError}</div>
<div style={css("display:flex;gap:8px;margin-top:6px")}>
<Button type="button" variant="outline" onClick={V.ckChangeMethod}>Cambiar método</Button>
<Button type="button" onClick={V.ckRetry}>Reintentar</Button>
</div>
</div>
</>)}
</>)}
</Card>
</div>
</div>
</>)}

{(V.mMenu) && (<>
<div className="pos-module" style={css("padding:var(--pos-module-padding,22px 24px 40px);display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap")}>
<Card className="min-w-0 gap-2 p-3 sm:w-[230px] sm:shrink-0">
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500;padding:4px 10px 10px")}>Categorías</div>
{(V.admCats).map((c, cI) => (<React.Fragment key={cI}>
<Button type="button" variant={c.active ? 'secondary' : 'ghost'} className="w-full justify-between text-left" aria-pressed={c.active} onClick={c.pick}><span>{c.label}</span><Badge variant="outline">{c.count}</Badge></Button>
</React.Fragment>))}
<Button type="button" variant="link" className="justify-start px-3" onClick={V.admNewCat}>+ Nueva categoría</Button>
</Card>
<div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:12px")}>
<div className="pos-menu-search" style={css("display:flex;gap:10px")}>
<Label className="sr-only" htmlFor="menu-search">Buscar en el menú</Label>
<Input id="menu-search" value={V.admSearch} onChange={V.setAdmSearch} placeholder="Buscar en el menú…" className="flex-1" />
<Button type="button" onClick={V.admNew}>+ Nuevo producto</Button>
</div>
<Card className="gap-0 overflow-hidden p-0">
<div className="hidden grid-cols-[minmax(0,1fr)_minmax(6rem,0.8fr)_auto_auto] gap-3 border-b px-4 py-3 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground sm:grid"><span>Producto</span><span>Categoría</span><span>Precio</span><span>Estado</span></div>
{(V.admProds).map((p, pI) => (<React.Fragment key={pI}>
<Button type="button" variant="ghost" aria-pressed={p.active} className={`grid h-auto min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] justify-stretch gap-x-3 gap-y-1 rounded-none border-b px-4 py-2 text-left last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(6rem,0.8fr)_auto_auto] ${p.active ? 'bg-secondary' : ''}`} onClick={p.pick}><span className="min-w-0 whitespace-normal font-medium">{p.name}</span><span className="col-start-1 row-start-2 truncate text-xs text-muted-foreground sm:col-auto sm:row-auto">{p.catLabel}</span><span className="col-start-2 row-start-1 whitespace-nowrap text-right sm:col-auto sm:row-auto">{p.price}</span><Badge className="col-start-2 row-start-2 justify-self-end sm:col-auto sm:row-auto" variant={p.availVariant}>{p.availLabel}</Badge></Button>
</React.Fragment>))}
</Card>
</div>
{(V.hasAdmSel) && (<>
<Card className="min-w-0 w-full max-w-[340px] gap-4 p-4 sm:sticky sm:top-5 sm:shrink-0">
<div style={css("display:flex;align-items:center")}><span style={css("font-size:15px;font-weight:500;flex:1")}>Editar producto</span><Button type="button" variant="ghost" size="icon" aria-label="Cerrar editor de producto" onClick={V.admClose}>×</Button></div>
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Datos generales</div>
<Label htmlFor="product-name">Nombre del producto</Label>
<Input id="product-name" value={V.fName} onChange={V.setFName} placeholder="Nombre" />
<Label htmlFor="product-category">Categoría</Label>
<Select value={V.fCat} onValueChange={V.setFCat}>
<SelectTrigger id="product-category" aria-label="Categoría"><SelectValue placeholder="Seleccionar categoría" /></SelectTrigger>
<SelectContent>
{(V.catOptions).map(o => (<SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>))}
</SelectContent>
</Select>
</div>
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Precio</div>
<Label htmlFor="product-price">Precio en MXN</Label>
<Input id="product-price" value={V.fPrice} onChange={V.setFPrice} inputMode="decimal" placeholder="0.00" className="max-w-[130px]" />
</div>
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Disponibilidad</div>
<Button type="button" variant="outline" aria-pressed={V.fAvailLabel === 'Disponible en el POS'} onClick={V.fToggleAvail}>{V.fAvailLabel}</Button>
</div>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Modificadores</div>
{(V.fMods).map((m, mI) => (<React.Fragment key={mI}>
<div style={css("display:flex;justify-content:space-between;font-size:13px;border:1px solid #e2e0d6;border-radius:8px;padding:8px 12px")}><span style={css("font-weight:500")}>{m.label}</span><span style={css("color:#6b6a63")}>{m.meta}</span></div>
</React.Fragment>))}
<Button type="button" variant="link" className="justify-start px-0" onClick={V.admNewCat}>+ Agregar grupo de modificadores</Button>
</div>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Inventario asociado</div>
{(V.fInv).map((i, iI) => (<React.Fragment key={iI}>
<div style={css("display:flex;justify-content:space-between;font-size:13px;padding:4px 0")}><span>{i.name}</span><span style={css("color:#6b6a63")}>{i.use}</span></div>
</React.Fragment>))}
</div>
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Previsualización en POS</div>
<div style={css("border:1px solid #e2e0d6;border-radius:10px;padding:12px;background:#f0eee6;display:flex;flex-direction:column;gap:6px;width:160px")}>
<span style={css("font-size:13.5px;font-weight:500")}>{V.pvName}</span>
<span style={css("font-size:13px;color:#6b6a63")}>{V.pvPrice}</span>
</div>
</div>
<Button type="button" size="lg" onClick={V.admSave}>Guardar cambios</Button>
</Card>
</>)}
</div>
</>)}

{(V.mInv) && (<>
<div className="pos-module" style={css("padding:var(--pos-module-padding,22px 24px 40px);display:flex;flex-direction:column;gap:16px")}>
<div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
<h1 style={css("font-size:19px;font-weight:500;margin:0")}>Inventario</h1>
<div style={css("display:flex;gap:6px;margin-left:8px;flex-wrap:wrap")}>
{(V.invTabs).map((t, tI) => (<Button key={tI} type="button" size="sm" variant={t.active ? 'default' : 'outline'} aria-pressed={t.active} onClick={t.pick}>{t.label}</Button>))}
</div>
<div style={css("margin-left:auto;display:flex;gap:8px")}>
<Button type="button" onClick={V.regEntrada}>+ Entrada</Button>
<Button type="button" variant="outline" onClick={V.regMerma}>Registrar merma</Button>
<Button type="button" variant="outline" onClick={V.regAjuste}>Ajuste manual</Button>
</div>
</div>
{(V.tStock) && (<>
<div style={css("display:flex;gap:10px")}>
<Label className="sr-only" htmlFor="inventory-search">Buscar insumo o ingrediente</Label>
<Input id="inventory-search" value={V.invSearch} onChange={V.setInvSearch} placeholder="Buscar insumo o ingrediente…" className="max-w-[340px]" />
<Button type="button" variant={V.lowToggleActive ? 'secondary' : 'outline'} aria-pressed={V.lowToggleActive} onClick={V.toggleLow}>Solo stock bajo</Button>
</div>
<div className="text-xs text-muted-foreground lg:hidden">Desliza para ver existencias y estado →</div>
<Card className="gap-0 overflow-hidden p-0"><Table containerProps={{ 'aria-label': 'Existencias y estado del inventario', tabIndex: 0 }} className="min-w-[650px]">
<TableHeader><TableRow><TableHead>Artículo</TableHead><TableHead>Tipo</TableHead><TableHead>Existencia</TableHead><TableHead>Mínimo</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
<TableBody>
{(V.stockEmpty) && (<TableRow><TableCell colSpan={5} className="h-20 text-center text-muted-foreground">Sin artículos que coincidan.</TableCell></TableRow>)}
{(V.stock).map((s, sI) => (<TableRow key={sI}>
<TableCell className="font-medium">{s.name}</TableCell><TableCell className="text-muted-foreground">{s.kind}</TableCell><TableCell>{s.qty}</TableCell><TableCell className="text-muted-foreground">{s.min}</TableCell><TableCell><Badge variant={s.tagVariant}>{s.tagLabel}</Badge></TableCell>
</TableRow>))}
</TableBody></Table></Card>
</>)}
{(V.tMov) && (<>
<div className="text-xs text-muted-foreground lg:hidden">Desliza para ver cantidad, usuario y motivo →</div>
<Card className="gap-0 overflow-hidden p-0"><Table containerProps={{ 'aria-label': 'Movimientos de inventario', tabIndex: 0 }} className="min-w-[900px]">
<TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Artículo</TableHead><TableHead>Cantidad</TableHead><TableHead>Usuario</TableHead><TableHead>Fecha</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
<TableBody>{(V.movs).map((m, mI) => (<TableRow key={mI}>
<TableCell><Badge variant={m.tagVariant}>{m.tipoLabel}</Badge></TableCell><TableCell className="font-medium">{m.item}</TableCell><TableCell>{m.qty}</TableCell><TableCell className="text-muted-foreground">{m.user}</TableCell><TableCell className="text-muted-foreground">{m.date}</TableCell><TableCell className="text-muted-foreground">{m.motivo}</TableCell>
</TableRow>))}</TableBody></Table></Card>
</>)}
{(V.tRec) && (<>
<div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px")}>
{(V.recs).map((r, rI) => (<React.Fragment key={rI}>
<Card className="gap-2 p-4">
<div style={css("font-size:14px;font-weight:500")}>{r.product}</div>
{(r.items).map((i, iI) => (<React.Fragment key={iI}>
<div style={css("display:flex;justify-content:space-between;font-size:12.5px;border-bottom:1px solid #e2e0d6;padding:6px 0")}><span>{i.name}</span><span style={css("color:#6b6a63")}>{i.use} · {i.conv}</span></div>
</React.Fragment>))}
<div style={css("font-size:11.5px;color:#6b6a63")}>Descuento por unidad vendida</div>
</Card>
</React.Fragment>))}
</div>
</>)}
</div>
</>)}

{(V.mRep) && (<>
<div className="pos-module" style={css("padding:var(--pos-module-padding,22px 24px 48px);display:flex;flex-direction:column;gap:16px")}>
<div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
<h1 style={css("font-size:19px;font-weight:500;margin:0")}>Reportes</h1>
<div style={css("display:flex;gap:6px;margin-left:8px;flex-wrap:wrap")}>
{(V.ranges).map((r, rI) => (<Button key={rI} type="button" size="sm" variant={r.active ? 'default' : 'outline'} aria-pressed={r.active} onClick={r.pick}>{r.label}</Button>))}
</div>
<Button type="button" variant="outline" className="ml-auto" onClick={V.exportar}>Exportar a Excel</Button>
</div>
<div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px")}>
<Card className="gap-2 p-4"><div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Ventas</div><div style={css("font-family:Georgia,serif;font-style:italic;font-size:30px;margin-top:8px")}>{V.repVentas}</div></Card>
<Card className="gap-2 p-4"><div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Tickets</div><div style={css("font-size:26px;font-weight:500;margin-top:8px")}>{V.repTickets}</div></Card>
<Card className="gap-2 p-4"><div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Propinas</div><div style={css("font-size:26px;font-weight:500;margin-top:8px")}>{V.repProps}</div></Card>
<Card className="gap-2 p-4"><div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Cancelaciones de cuentas</div><div style={css("font-size:26px;font-weight:500;margin-top:8px")}>{V.repCanc}</div></Card>
</div>
<div className="grid gap-3 sm:grid-cols-3" aria-label="Devoluciones y neto">
<Card className="gap-2 p-4"><div>Reembolsos y anulaciones</div><strong>{V.repRefunds}</strong><span className="text-xs text-muted-foreground">{V.repRefundCount} reembolsos · {V.repVoids} anulaciones</span></Card>
<Card className="gap-2 p-4"><div>Neto tras devoluciones</div><strong>{V.repNet}</strong></Card>
<Card className="gap-2 p-4"><div className="text-xs text-muted-foreground">Los pagos originales se conservan. Las devoluciones manuales no confirman liquidación bancaria ni compensación de inventario.</div></Card>
</div>
<div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px")}>
<Card className="gap-3 p-4">
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Cobros originales por forma de pago</div>
{(V.methods).map((m, mI) => (<React.Fragment key={mI}>
<div style={css("display:flex;flex-direction:column;gap:4px")}>
<div style={css("display:flex;justify-content:space-between;font-size:13px")}><span>{m.label}</span><span style={css("font-weight:500")}>{m.amount}</span></div>
<div style={css("height:5px;background:#f0eee6;border-radius:999px")}><div style={m.barStyle}></div></div>
</div>
</React.Fragment>))}
</Card>
<Card className="gap-2 p-4">
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Productos vendidos</div>
{(V.topProds).map((t, tI) => (<React.Fragment key={tI}>
<div style={css("display:flex;justify-content:space-between;font-size:13px;border-bottom:1px solid #e2e0d6;padding:6px 0")}><span>{t.name} <span style={css("color:#6b6a63")}>×{t.qty}</span></span><span style={css("font-weight:500")}>{t.amount}</span></div>
</React.Fragment>))}
</Card>
<Card className="gap-2 p-4">
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Ventas por usuario</div>
{(V.byUser).map((u, uI) => (<React.Fragment key={uI}>
<div style={css("display:flex;justify-content:space-between;font-size:13px;border-bottom:1px solid #e2e0d6;padding:6px 0")}><span>{u.name} <span style={css("color:#6b6a63")}>{u.meta}</span></span><span style={css("font-weight:500")}>{u.amount}</span></div>
</React.Fragment>))}
</Card>
</div>
<div className="text-xs text-muted-foreground lg:hidden">Desliza para ver total, estado y sincronización →</div>
<Card className="gap-0 overflow-hidden p-0"><Table containerProps={{ 'aria-label': 'Ventas del reporte', tabIndex: 0 }} className="min-w-[1000px]">
<TableHeader><TableRow><TableHead>Folio</TableHead><TableHead>Fecha</TableHead><TableHead>Tipo</TableHead><TableHead>Usuario</TableHead><TableHead>Total</TableHead><TableHead>Estado</TableHead><TableHead>Sincronización</TableHead></TableRow></TableHeader>
<TableBody>{(V.repSales).map((s, sI) => (<TableRow key={sI}>
<TableCell><Button type="button" variant="link" size="sm" className="h-11 justify-start px-0" aria-label={`Abrir detalle de venta ${s.folio}`} onClick={s.open}>{s.folio}</Button></TableCell><TableCell className="text-muted-foreground">{s.fecha}</TableCell><TableCell>{s.tipo}</TableCell><TableCell className="text-muted-foreground">{s.user}</TableCell><TableCell className="font-medium">{s.total}</TableCell><TableCell><Badge variant={s.statusVariant}>{s.statusLabel}</Badge></TableCell><TableCell><Badge variant={s.syncVariant}>{s.syncLabel}</Badge></TableCell>
</TableRow>))}</TableBody></Table></Card>
</div>
</>)}

{(V.mCfg) && (<>
<div className="pos-module" style={css("padding:var(--pos-module-padding,22px 24px 48px);display:flex;flex-direction:column;gap:16px")}>
<div style={css("display:flex;align-items:center;gap:12px")}>
<h1 style={css("font-size:19px;font-weight:500;margin:0")}>Usuarios y configuración</h1>
<div style={css("display:flex;gap:6px;margin-left:8px")}>
{(V.cfgTabs).map((t, tI) => (<Button key={tI} type="button" size="sm" variant={t.active ? 'default' : 'outline'} aria-pressed={t.active} onClick={t.pick}>{t.label}</Button>))}
</div>
</div>
{(V.cUsers) && (<>
<div style={css("display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap")}>
<div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:10px")}>
{this.isSecureMode() ? <div style={css("display:flex;gap:8px;flex-wrap:wrap")}><Button type="button" className="self-start" onClick={() => V.newUser('existing')}>+ Vincular cuenta Auth existente</Button><Button type="button" variant="outline" className="self-start" onClick={() => V.newUser('create')}>+ Crear cuenta Auth individual</Button></div> : <Button type="button" className="self-start" onClick={V.newUser}>+ Nuevo usuario</Button>}
{V.createdCredential && <Card role="alert" className="w-full max-w-[520px] gap-3 border-amber-500/50 p-4"><div className="font-medium">Cuenta Auth creada · entrega única</div><p className="text-sm text-muted-foreground">Comparte esta contraseña inicial directamente con la persona. No se envió correo. Esta vista no se guarda en el navegador y desaparece al cerrarla.</p><div className="text-sm"><div>Correo: <strong>{V.createdCredential.email}</strong></div><div>Contraseña inicial: <code className="select-all break-all rounded bg-muted px-1.5 py-1">{V.createdCredential.temporaryPassword}</code></div></div><Button type="button" variant="outline" className="self-start" onClick={V.dismissCreatedCredential}>Listo, cerrar credencial</Button></Card>}
<Card className="gap-0 overflow-x-auto p-0"><div className="min-w-[620px]">
<div className="grid grid-cols-[minmax(0,1fr)_160px_80px_110px_90px] gap-2 border-b px-4 py-3 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground"><span>Nombre</span><span>Rol</span><span>{V.userCredentialHeading}</span><span>Acceso</span><span></span></div>
{(V.usersRows).map((u, uI) => (<React.Fragment key={uI}>
<div className={`grid min-h-14 grid-cols-[minmax(0,1fr)_160px_80px_110px_90px] items-center gap-2 border-b px-4 py-1 last:border-b-0 ${u.selected ? 'bg-secondary' : ''}`}>
<Button type="button" variant="link" className="justify-start px-0 text-left" aria-pressed={u.selected} onClick={u.pick}>{u.name}</Button>
<span style={css("color:#6b6a63;font-size:13px")}>{u.roleLabel}</span>
<span style={css("color:#6b6a63;font-size:13px")} title={this.isSecureMode() ? u.credentialLabel : undefined}>{u.credentialLabel}</span>
<Badge variant={u.activeVariant}>{u.activeLabel}</Badge>
<Button type="button" variant="ghost" size="sm" onClick={u.toggleActive}>{u.toggleLabel}</Button>
</div>
</React.Fragment>))}
</div></Card>
</div>
{(V.hasSelUser) && (<>
<Card className="min-w-0 w-full max-w-[340px] gap-4 p-4 sm:sticky sm:top-5 sm:shrink-0">
<div style={css("display:flex;align-items:center")}><span style={css("font-size:15px;font-weight:500;flex:1")}>Editar usuario</span><Button type="button" variant="ghost" size="icon" aria-label="Cerrar editor de usuario" onClick={V.suClose}>×</Button></div>
<Label htmlFor="user-name">Nombre completo</Label>
<Input id="user-name" value={V.suName} onChange={V.setSuName} placeholder="Nombre completo" />
{(this.isSecureMode()) && <>
{(s.selUser === 'new' && s.suForm?.accountMethod === 'create') ? <>
<Label htmlFor="user-auth-email">Correo para crear la cuenta Auth</Label>
<Input id="user-auth-email" type="email" value={V.suEmail} onChange={V.setSuEmail} placeholder="persona@ejemplo.com" autoComplete="off" maxLength={254} />
<p className="text-xs text-muted-foreground">Se crea una cuenta individual sin invitación ni correo. La contraseña inicial aparece una sola vez para entregarla directamente.</p>
</> : <>
<Label htmlFor="user-auth-id">UUID de una cuenta Auth existente</Label>
<Input id="user-auth-id" value={V.suUserId} onChange={V.setSuUserId} placeholder="UUID de Supabase Auth" autoComplete="off" />
<p className="text-xs text-muted-foreground">Este formulario vincula una cuenta ya creada. No crea contraseñas, envía invitaciones ni correo.</p>
</>}</>}
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Rol</div>
<div style={css("display:flex;flex-wrap:wrap;gap:6px")}>
{(V.suRoles).map((r, rI) => (<Button key={rI} type="button" size="sm" variant={r.active ? 'default' : 'outline'} aria-pressed={r.active} onClick={r.pick}>{r.label}</Button>))}
</div>
</div>
{(!this.isSecureMode()) && <div style={css("display:flex;flex-direction:column;gap:6px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Permisos</div>
{(V.suPerms).map((p, pI) => (<Button key={pI} type="button" variant={p.active ? 'secondary' : 'outline'} className="w-full justify-between text-left" aria-pressed={p.active} onClick={p.toggle}><span>{p.label}</span><span aria-hidden="true">{p.active ? '✓' : '—'}</span></Button>))}
</div>}
<div style={css("display:flex;flex-direction:column;gap:6px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Acciones auditables</div>
{(V.suAudit).map((a, aI) => (<React.Fragment key={aI}>
<div style={css("display:flex;gap:10px;font-size:12.5px;padding:5px 0;border-bottom:1px solid #e2e0d6")}><span style={css("color:#6b6a63;flex:none;width:92px")}>{a.t}</span><span>{a.e}</span></div>
</React.Fragment>))}
</div>
<Button type="button" size="lg" onClick={V.suSave}>{this.isSecureMode() ? 'Guardar acceso en Supabase' : 'Guardar usuario'}</Button>
</Card>
</>)}
</div>
</>)}
{(V.cCfg) && (<>
<Card className="max-w-2xl gap-3 p-4">
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Mesas</div>
<div className="flex flex-wrap items-end gap-3">
<div className="flex min-w-40 flex-col gap-2">
<Label htmlFor="available-table-count">Mesas disponibles</Label>
<Input id="available-table-count" type="number" inputMode="numeric" min="1" max="50" step="1" value={V.tableCountDraft} onChange={V.setTableCountDraft} disabled={!V.canConfigureTables} />
</div>
<Button type="button" onClick={V.saveTableCount} disabled={!V.canConfigureTables}>Guardar mesas</Button>
</div>
<p className="m-0 text-xs text-muted-foreground">La selección de mesa es opcional. Reducir el número disponible conserva las mesas ya guardadas en cuentas abiertas. Solo Dueña o Encargado puede cambiar este ajuste.</p>
</Card>
<div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px")}>
{(V.cfgCards).map((c, cI) => (<React.Fragment key={cI}>
<Card className="gap-3 p-4">
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>{c.title}</div>
{(c.rows).map((r, rI) => (<React.Fragment key={rI}>
<div style={css("display:flex;justify-content:space-between;align-items:center;font-size:13px;border-bottom:1px solid #e2e0d6;padding:7px 0;gap:12px")}>
{(r.hasToggle) && (<Label htmlFor={r.toggleId} className="min-h-11 flex-1">{r.label}</Label>)}
{(r.hasValue) && (<span>{r.label}</span>)}
{(r.hasToggle) && (<>
<Switch id={r.toggleId} checked={r.enabled} onCheckedChange={r.toggle} aria-label={r.label} />
</>)}
{(r.hasValue) && (<><span style={css("color:#6b6a63;text-align:right")}>{r.value}</span></>)}
</div>
</React.Fragment>))}
{(c.hasAction) && (<>
<Button type="button" variant="secondary" className="self-start" onClick={c.action}>{c.actionLabel}</Button>
</>)}
</Card>
</React.Fragment>))}
</div>
</>)}
</div>
</>)}
</main>
</SidebarProvider>

<Dialog open={V.ed} onOpenChange={open => { if (!open) V.edCancel(); }}>
{(V.ed) && (<DialogContent
  className="max-h-[calc(100dvh-2rem)] w-[560px] max-w-[calc(100vw-2rem)] overflow-y-auto p-5"
  onOpenAutoFocus={() => { this._dialogReturnFocus = document.activeElement; }}
  onCloseAutoFocus={event => {
    const opener = this._dialogReturnFocus;
    this._dialogReturnFocus = null;
    if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
      event.preventDefault();
      opener.focus({ preventScroll: true });
    }
  }}
>
<DialogHeader className="pr-8 text-left">
<DialogTitle className="flex items-baseline justify-between gap-3">{V.edName}<span className="text-sm font-normal text-muted-foreground">{V.edPrice}</span></DialogTitle>
<DialogDescription>Actualiza cantidad, modificadores y notas de preparación antes de guardar la orden.</DialogDescription>
</DialogHeader>
<div role="group" aria-label={`Cantidad de ${V.edName}`} style={css("display:flex;align-items:center;gap:12px")}>
<span style={css("font-size:13px;font-weight:500")}>Cantidad</span>
<div style={css("display:flex;align-items:center;gap:4px")}>
<Button type="button" variant="outline" size="icon" aria-label={`Disminuir cantidad de ${V.edName}`} onClick={V.edDec}>−</Button>
<span style={css("min-width:32px;text-align:center;font-size:15px;font-weight:500")}>{V.edQty}</span>
<Button type="button" variant="outline" size="icon" aria-label={`Aumentar cantidad de ${V.edName}`} onClick={V.edInc}>+</Button>
</div>
</div>
{(V.edGroups).map((g, gI) => (<React.Fragment key={gI}>
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("display:flex;gap:8px;align-items:baseline")}><span style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>{g.label}</span><span style={css("font-size:11.5px;color:#a8a69c")}>{g.hint}</span></div>
<div style={css("display:flex;flex-wrap:wrap;gap:6px")}>
{(g.options).map((o, oI) => (<Button key={oI} type="button" size="sm" variant={o.active ? 'secondary' : 'outline'} disabled={o.disabled} aria-pressed={o.active} onClick={o.toggle}>{o.text}</Button>))}
</div>
</div>
</React.Fragment>))}
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<Label htmlFor="prep-notes">Notas de preparación</Label>
<Textarea id="prep-notes" value={V.edNotes} onChange={V.edSetNotes} placeholder="P. ej. sin azúcar, extra caliente…" rows={V.two} />
</div>
<div style={css("display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #e2e0d6;padding-top:14px")}>
<Button type="button" variant="outline" onClick={V.edCancel}>Cancelar</Button>
<Button type="button" onClick={V.edConfirm}>{V.edConfirmLabel}</Button>
</div>
</DialogContent>)}
</Dialog>

<Dialog open={V.hasRepSel} onOpenChange={open => { if (!open) V.closeDetail(); }}>
<DialogContent
  className="max-h-[calc(100dvh-2rem)] w-[520px] max-w-[calc(100vw-2rem)] overflow-y-auto p-5"
  onOpenAutoFocus={() => { this._dialogReturnFocus = document.activeElement; }}
  onCloseAutoFocus={event => {
    const opener = this._dialogReturnFocus;
    this._dialogReturnFocus = null;
    if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
      event.preventDefault();
      opener.focus({ preventScroll: true });
    }
  }}
>
<DialogHeader className="pr-8 text-left">
<DialogTitle className="flex items-center gap-2">{V.dFolio}<Badge variant={V.dStatusVariant}>{V.dStatusLabel}</Badge></DialogTitle>
<DialogDescription className="leading-relaxed">{V.dMeta}</DialogDescription>
</DialogHeader>
{V.canRefundSale && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={V.refundSale}>Registrar reembolso</Button>{V.canVoidSale && <Button type="button" variant="outline" onClick={V.voidSale}>Anular venta</Button>}</div>}
{V.dCompensations.map(event => <Card key={event.id} className="gap-1 p-3"><strong>{event.kind} · {event.amount}</strong><span>{event.actor} · {event.date}</span><span>{event.reason}</span>{event.allocations.map((payment, index) => <span key={index}>{payment.label} · {payment.amount}</span>)}<span className="text-xs text-muted-foreground">Registro manual · compensación de inventario pendiente</span></Card>)}
{(V.dHasMotivo) && (<><div style={css("font-size:12.5px;color:#836953;background:#f6e5df;border-radius:8px;padding:8px 12px")}>Motivo: {V.dMotivo}</div></>)}
{(V.dPaymentVerificationMessage) && (<div role="status" className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">{V.dPaymentVerificationMessage}</div>)}
<div style={css("display:flex;flex-direction:column")}>
{(V.dItems).map((i, iI) => (<React.Fragment key={iI}>
<div style={css("display:flex;gap:8px;padding:8px 0;border-bottom:1px solid #e2e0d6;font-size:13px")}>
<span style={css("color:#6b6a63;flex:none")}>{i.qty}×</span>
<span style={css("flex:1")}><span style={css("font-weight:500")}>{i.name}</span>{(i.hasMods) && (<><span style={css("color:#6b6a63")}> · {i.mods}</span></>)}</span>
<span>{i.total}</span>
</div>
</React.Fragment>))}
</div>
<div style={css("display:flex;flex-direction:column;gap:4px")}>
{(V.dPays).map((p, pI) => (<React.Fragment key={pI}>
<div style={css("display:flex;justify-content:space-between;font-size:13px")}><span style={css("color:#6b6a63")}>{p.method} · neto</span><span>{p.amount}</span></div>
{(p.hasCashChange) && (<div style={css("display:flex;justify-content:space-between;font-size:12px;color:#6b6a63")}><span>Recibido {p.tendered} · cambio {p.change}</span><span></span></div>)}
</React.Fragment>))}
<div style={css("display:flex;justify-content:space-between;font-size:13px")}><span style={css("color:#6b6a63")}>Propina</span><span>{V.dTip}</span></div>
<div style={css("display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #e2e0d6;padding-top:8px;margin-top:4px")}><span style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Total</span><span style={css("font-family:Georgia,serif;font-style:italic;font-size:26px")}>{V.dTotal}</span></div>
</div>
<div style={css("display:flex;flex-direction:column;gap:2px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500;margin-bottom:6px")}>Historial de auditoría</div>
{(V.dAudit).map((a, aI) => (<React.Fragment key={aI}>
<div style={css("display:flex;gap:12px;font-size:12.5px;padding:5px 0;border-bottom:1px solid #e2e0d6")}><span style={css("color:#6b6a63;flex:none;width:44px")}>{a.t}</span><span style={css("flex:1")}>{a.e}</span><span style={css("color:#a8a69c")}>{a.u}</span></div>
</React.Fragment>))}
</div>
</DialogContent>
</Dialog>

<Dialog open={V.dlg} onOpenChange={open => { if (!open) V.dlgClose(); }}>
<DialogContent
  className="max-h-[calc(100dvh-2rem)] w-[420px] max-w-[calc(100vw-2rem)] overflow-y-auto p-5"
  onOpenAutoFocus={() => { this._dialogReturnFocus = document.activeElement; }}
  onCloseAutoFocus={event => {
    const opener = this._dialogReturnFocus;
    this._dialogReturnFocus = null;
    if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
      event.preventDefault();
      opener.focus({ preventScroll: true });
    }
  }}
>
<DialogHeader>
<DialogTitle>{V.dlgTitle}</DialogTitle>
<DialogDescription>{V.dlgBody}</DialogDescription>
</DialogHeader>
{V.dlgRefundPayments.length > 1 && <div className="flex flex-col gap-2"><Label htmlFor="refund-payment">Pago devuelto</Label><Select value={V.dlgRefundPayment} onValueChange={V.setDlgRefundPayment}><SelectTrigger id="refund-payment"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all__">Devolución completa de todos los pagos</SelectItem>{V.dlgRefundPayments.map((payment, index) => <SelectItem key={payment.id} value={'payment:' + payment.id}>{payment.label} · pago {index + 1}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Para un reembolso parcial, selecciona el pago que ya devolviste.</p></div>}
{(V.dlgFields).map((f, fI) => (<React.Fragment key={fI}>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
<Label htmlFor={`dialog-field-${fI}`}>{f.label}</Label>
<Input id={`dialog-field-${fI}`} inputMode={f.inputMode} value={f.value} onChange={f.set} placeholder={f.ph} aria-invalid={V.hasDlgErr || undefined} aria-describedby={V.hasDlgErr ? 'dialog-error' : undefined} />
</div>
</React.Fragment>))}
{(V.dlgNeedReason) && (<>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
<Label htmlFor="dialog-reason">Motivo (obligatorio)</Label>
<Textarea id="dialog-reason" value={V.dlgReason} onChange={V.setDlgReason} placeholder="Describe el motivo…" aria-invalid={V.hasDlgErr || undefined} aria-describedby={V.hasDlgErr ? 'dialog-error' : undefined} />
</div>
</>)}
{(V.hasDlgErr) && (<><div id="dialog-error" role="alert" style={css("font-size:12.5px;color:#141413")}>{V.dlgErr}</div></>)}
<DialogFooter>
<Button variant="outline" onClick={V.dlgClose}>{V.dlgCloseLabel}</Button>
{(V.dlgHasConfirm) && (<>
<Button variant={V.dlgConfirmVariant} onClick={V.dlgConfirm}>{V.dlgConfirmLabel}</Button>
</>)}
</DialogFooter>
</DialogContent>
</Dialog>

<div role="region" aria-label="Notificaciones" style={css("position:fixed;right:20px;bottom:20px;z-index:400;display:flex;flex-direction:column;gap:8px;align-items:flex-end;max-width:calc(100vw - 32px)")}>
{(V.toasts).map((t, tI) => (<React.Fragment key={tI}>
<Card role="status" aria-live="polite" aria-atomic="true" className="min-h-11 w-fit max-w-full flex-row items-center gap-3 border-foreground bg-foreground px-4 py-2 text-background shadow-md">
<Badge variant={t.kind === 'warn' ? 'pending' : 'success'}>{t.kind === 'warn' ? 'Aviso' : 'Listo'}</Badge><span className="min-w-0 whitespace-normal break-words text-sm">{t.msg}</span>
</Card>
</React.Fragment>))}
</div>
</>)}
      </>
    );
  }
}
