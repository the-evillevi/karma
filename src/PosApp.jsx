import React from 'react';
import { css } from './css.js';
import SalesStation from './SalesStation.jsx';
import { captureProductLine } from './catalog/catalog-domain.mjs';
import { normalizeCatalog } from '../scripts/catalog/catalog-normalizer.mjs';
import { saveMenuProduct } from './catalog/menu-products.mjs';
import { toggleModifierSelection } from './catalog/sales-selection.mjs';

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

// Ported verbatim from design/Karma POS.dc.html. The original
// `class Component extends DCLogic` becomes a real React.Component (identical
// setState / lifecycle / props semantics). All ~30 helper methods and
// renderVals() are unchanged; render() binds V (renderVals output) to JSX
// converted mechanically from the original <x-dc> template.
export default class PosApp extends React.Component {
  constructor(props) {
    super(props);
    const D = window.KARMA;
    let sv = {}; try { sv = JSON.parse(localStorage.getItem('karma-pos-v1')) || {}; } catch (e) {}
    this._folio = sv.folioSeq || 1051;
    this.state = {
      loading: true,
      session: sv.session || null,
      pick: sv.pick || 'u3', pin: '', pinErr: '',
      module: 'pos',
      online: sv.online !== false,
      syncing: false,
      pending: sv.pending || ['Venta A-1047', 'Orden A-1049'],
      toasts: [],
      order: sv.order || this.blank(),
      open: sv.open || D.seedOrders.map(o => ({ ...o })),
      sales: sv.sales || D.sales.map(s => ({ ...s })),
      prods: sv.prods || D.products.map(p => ({ ...p })),
      usersX: sv.usersX || D.users.map(u => ({ ...u })),
      movs: D.movements.slice(),
      ed: null, dlg: null, ck: null,
      cat: 'concafe', search: '',
      admCat: 'all', admSearch: '', admSel: null, admForm: null,
      invTab: 'stock', invSearch: '', invLow: false,
      range: 'hoy', repSel: null,
      cfgTab: 'usuarios', selUser: null, suForm: null,
      flags: sv.flags || { autoprint: true, fpEfectivo: true, fpTarjeta: true, fpTransfer: true, propCustom: true, cancelMotivo: true, cancelAut: true }
    };
  }
  blank() { return { folio: null, type: 'local', mesa: '', name: '', items: [], discount: 0, discountReason: '' }; }
  componentDidMount() {
    this._t = setTimeout(() => this.setState({ loading: false }), 650);
    this._sl = e => {
      if (e.key === 'karma-pos-v1' && e.newValue) {
        try { const v = JSON.parse(e.newValue); if (v.open) this.setState({ open: v.open }); } catch (_) {}
      }
    };
    window.addEventListener('storage', this._sl);
  }
  componentWillUnmount() { clearTimeout(this._t); window.removeEventListener('storage', this._sl); }
  persist() {
    const s = this.state;
    try {
      localStorage.setItem('karma-pos-v1', JSON.stringify({
        session: s.session, pick: s.pick, online: s.online, pending: s.pending, order: s.order,
        open: s.open, sales: s.sales, prods: s.prods, usersX: s.usersX, flags: s.flags, folioSeq: this._folio
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
  user() { return this.state.usersX.find(u => u.id === this.state.session) || null; }
  role() { const u = this.user(); return u ? u.role : 'cajero'; }
  can(act) {
    const r = this.role();
    const P = { cancelar: ['dueno', 'encargado'], descuento: ['dueno', 'encargado'], ajuste: ['dueno', 'encargado'] };
    return (P[act] || []).includes(r);
  }
  navAllowed(m) {
    const r = this.role();
    const L = {
      pos: ['dueno', 'encargado', 'cajero'], ordenes: ['dueno', 'encargado', 'cajero', 'cocina'],
      menu: ['dueno', 'encargado'], inventario: ['dueno', 'encargado', 'cajero'],
      reportes: ['dueno', 'encargado'], config: ['dueno', 'encargado']
    };
    return (L[m] || []).includes(r);
  }
  notAllowed(what) {
    const D = window.KARMA;
    this.setState({ dlg: { title: 'Acción no permitida', body: 'Tu rol (' + (D.roleLabels[this.role()] || '') + ') no tiene permiso para ' + what + '. Solicita apoyo a un encargado o a la dueña.', closeLabel: 'Entendido', onConfirm: null } });
  }
  lineUnit(l) {
    const D = window.KARMA;
    const p = this.state.prods.find(x => x.id === l.prodId);
    if (!p) return l.unit || 0;
    let t = p.price;
    Object.keys(l.mods || {}).forEach(g => {
      const G = D.modGroups[g]; if (!G) return;
      (l.mods[g] || []).forEach(oid => { const o = G.options.find(x => x.id === oid); if (o) t += o.price; });
    });
    return t;
  }
  modsText(l) {
    const D = window.KARMA; const parts = [];
    Object.keys(l.mods || {}).forEach(g => {
      const G = D.modGroups[g]; if (!G) return;
      (l.mods[g] || []).forEach(oid => { const o = G.options.find(x => x.id === oid); if (o) parts.push(o.label + (o.price ? ' +$' + o.price : '')); });
    });
    return parts.join(' · ');
  }
  orderTotals(o) {
    const sub = o.items.reduce((a, l) => a + this.lineUnit(l) * l.qty, 0);
    const disc = Math.min(o.discount || 0, sub);
    return { sub, disc, total: sub - disc };
  }
  typeLabel(t) { return ({ local: 'En local', mesa: 'Mesa', llevar: 'Para llevar', domicilio: 'Domicilio', recoger: 'Recoger' })[t] || t; }
  refOf(o) { return o.type === 'mesa' ? ('Mesa ' + (o.mesa || '—')) : (o.name || this.typeLabel(o.type)); }
  needItems() { if (!this.state.order.items.length) { this.toast('Agrega productos a la orden primero', 'warn'); return false; } return true; }
  openEntry(o) {
    return {
      folio: o.folio, type: o.type, ref: this.refOf(o), time: this.now(),
      user: this.user().name, prep: 'en-cola', sync: this.state.online ? 'sincronizada' : 'pendiente',
      items: o.items.map(l => ({ prodId: l.prodId, name: (this.state.prods.find(p => p.id === l.prodId) || {}).name || l.name, qty: l.qty, mods: l.mods, modsText: this.modsText(l), notes: l.notes, unit: this.lineUnit(l) })),
      name: o.name, discount: o.discount || 0
    };
  }
  saveOpen(keepStation) {
    if (!this.needItems()) return;
    const s = this.state; const o = { ...s.order };
    if (!o.folio) o.folio = this.nf();
    const entry = this.openEntry(o);
    const prev = s.open.find(x => x.folio === o.folio);
    if (prev) { entry.prep = prev.prep; entry.time = prev.time; }
    const open = [entry, ...s.open.filter(x => x.folio !== o.folio)];
    const pending = s.online ? s.pending : [...s.pending, 'Orden ' + o.folio];
    if (keepStation) this.up({ open, pending, order: o });
    else this.up({ open, pending, order: this.blank() });
    return o.folio;
  }
  startCheckout(folio, lines, discount, type, fromStation) {
    const sub = lines.reduce((a, l) => a + (l.unit != null ? l.unit : this.lineUnit(l)) * l.qty, 0);
    const disc = Math.min(discount || 0, sub);
    const base = sub - disc;
    const tipSel = String(this.props.propinaInicial ?? '0');
    const tipAmt = base * (parseInt(tipSel, 10) || 0) / 100;
    this.up({
      module: 'checkout',
      ck: {
        folio, fromStation, type, step: 'review', ok: null, error: '', change: 0,
        lines: lines.map(l => ({ name: l.name || (this.state.prods.find(p => p.id === l.prodId) || {}).name, qty: l.qty, modsText: l.modsText != null ? l.modsText : this.modsText(l), unit: l.unit != null ? l.unit : this.lineUnit(l) })),
        sub, disc, tipSel, tipCustom: '',
        pays: [{ id: 1, method: 'efectivo', amount: (base + tipAmt).toFixed(2) }]
      }
    });
  }
  ckMath(ck) {
    const base = ck.sub - ck.disc;
    const tip = ck.tipSel === 'otro' ? (parseFloat(ck.tipCustom) || 0) : base * (parseInt(ck.tipSel, 10) || 0) / 100;
    const total = base + tip;
    const paid = ck.pays.reduce((a, p) => a + (parseFloat(p.amount) || 0), 0);
    const remaining = Math.max(0, total - paid);
    const over = paid - total;
    const hasCash = ck.pays.some(p => p.method === 'efectivo' && (parseFloat(p.amount) || 0) > 0);
    const change = over > 0.001 && hasCash ? over : 0;
    const valid = paid >= total - 0.001 && total > 0 && (over <= 0.001 || hasCash);
    return { base, tip, total, paid, remaining, over, hasCash, change, valid };
  }
  setCk(patch) { this.setState(s => ({ ck: { ...s.ck, ...patch } })); }
  register() {
    const s = this.state; const ck = s.ck; const m = this.ckMath(ck);
    this.setCk({ step: 'processing' });
    setTimeout(() => {
      const usesCard = ck.pays.some(p => p.method === 'tarjeta' && (parseFloat(p.amount) || 0) > 0);
      if (!this.state.online && usesCard) {
        this.setCk({ step: 'result', ok: false, error: 'La terminal bancaria no responde sin conexión. Reintenta cuando vuelva la señal, o cambia a efectivo o transferencia.' });
        return;
      }
      const st = this.state; const folio = ck.folio || this.nf();
      const ml = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };
      const sale = {
        folio, day: 0, fecha: 'Hoy · ' + this.now(), creo: this.user().name, cobro: this.user().name,
        tipo: ck.type, items: ck.lines.map(l => ({ name: l.name, qty: l.qty, mods: l.modsText, total: l.unit * l.qty })),
        payments: ck.pays.filter(p => (parseFloat(p.amount) || 0) > 0).map(p => ({ method: ml[p.method], amount: parseFloat(p.amount) })),
        tip: m.tip, total: m.total, status: 'completada', sync: st.online ? 'sincronizada' : 'pendiente',
        audit: [[this.now(), 'Orden creada', this.user().name], [this.now(), 'Pago registrado (' + ck.pays.filter(p => parseFloat(p.amount) > 0).map(p => ml[p.method]).join(' + ') + ')', this.user().name]]
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
  cancelOpen(folio) {
    if (!this.can('cancelar')) { this.notAllowed('cancelar cuentas abiertas'); return; }
    this.setState({
      dlg: {
        title: 'Cancelar ' + folio, body: 'La cuenta se cerrará sin cobro y quedará registrada como cancelada en los reportes.', needReason: true, danger: true, confirmLabel: 'Cancelar cuenta',
        onConfirm: d => {
          const s = this.state; const o = s.open.find(x => x.folio === folio); if (!o) return;
          const sale = { folio, day: 0, fecha: 'Hoy · ' + this.now(), creo: o.user, cobro: '—', tipo: o.ref, items: o.items.map(l => ({ name: l.name, qty: l.qty, mods: l.modsText, total: l.unit * l.qty })), payments: [], tip: 0, total: o.items.reduce((a, l) => a + l.unit * l.qty, 0), status: 'cancelada', sync: s.online ? 'sincronizada' : 'pendiente', motivo: d.reason, audit: [[this.now(), 'Cancelada · ' + d.reason, this.user().name]] };
          this.up({ open: s.open.filter(x => x.folio !== folio), sales: [sale, ...s.sales], order: s.order.folio === folio ? this.blank() : s.order });
          this.toast(folio + ' cancelada');
        }
      }
    });
  }
  invDialog(tipo, label, needsPerm) {
    if (needsPerm && !this.can('ajuste')) { this.notAllowed('registrar ajustes de inventario'); return; }
    this.setState({
      dlg: {
        title: label, body: 'La operación quedará registrada en movimientos con tu usuario y fecha.', needReason: true, confirmLabel: 'Registrar',
        fields: [{ key: 'item', label: 'Artículo', ph: 'P. ej. Leche entera', value: '' }, { key: 'qty', label: 'Cantidad y unidad', ph: 'P. ej. −2 L', value: '' }],
        onConfirm: d => {
          const f = {}; (d.fields || []).forEach(x => f[x.key] = x.value);
          if (!f.item || !f.qty) { this.toast('Captura artículo y cantidad', 'warn'); return 'keep'; }
          this.setState(s => ({ movs: [{ id: 'm' + Date.now(), tipo, item: f.item, qty: f.qty, user: this.user().name, date: 'Hoy · ' + this.now(), motivo: d.reason }, ...s.movs] }));
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
    const stop = e => e.stopPropagation();
    const V = { loading: s.loading, stop, two: 2 };

    // ---- login
    const pu = s.usersX.find(u => u.id === s.pick) || s.usersX[0];
    V.isLogin = !s.loading && !s.session;
    V.loginUsers = s.usersX.map(u => ({
      name: u.name.split(' ')[0], roleLabel: D.roleLabels[u.role],
      style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: '1px solid ' + (u.id === s.pick ? acc : line), background: u.id === s.pick ? tint : paper, color: ink, opacity: u.active ? 1 : 0.45 },
      subStyle: { fontSize: 11.5, color: u.id === s.pick ? acc : mut },
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
    V.isApp = !s.loading && !!s.session;
    V.userName = me ? me.name : ''; V.userRoleLabel = me ? D.roleLabels[me.role] : '';
    V.userInitials = me ? me.name.split(' ').map(x => x[0]).slice(0, 2).join('') : '';
    V.switchUser = () => this.up({ session: null, pin: '', pinErr: '' });
    V.goPos = () => this.navAllowed('pos') ? this.up({ module: 'pos', ck: null }) : this.notAllowed('usar la estación de venta');
    const mods = [['pos', 'Punto de venta'], ['ordenes', 'Órdenes abiertas'], ['menu', 'Menú'], ['inventario', 'Inventario'], ['reportes', 'Reportes'], ['config', 'Usuarios y configuración']];
    V.navItems = mods.map(([id, label]) => {
      const active = s.module === id; const allowed = this.navAllowed(id);
      return {
        label, hasBadge: id === 'ordenes' && s.open.length > 0, badge: s.open.length,
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: active ? 500 : 400, background: active ? tint : 'transparent', color: allowed ? (active ? acc : ink) : '#a8a69c' },
        go: () => allowed ? this.up({ module: id, ck: null, repSel: null }) : this.notAllowed('abrir «' + label + '»')
      };
    });
    V.online = s.online; V.offline = !s.online && !!s.session && !s.loading;
    V.connDotStyle = { width: 9, height: 9, borderRadius: '50%', flex: 'none', background: s.online ? acc : 'transparent', border: '1px solid ' + acc };
    V.connLabel = s.online ? 'Conectado' : 'Sin conexión';
    V.connSub = s.syncing ? 'Sincronizando…' : (s.pending.length ? s.pending.length + ' operaciones pendientes' : 'Todo sincronizado');
    V.connToggleLabel = s.online ? 'Simular pérdida de conexión' : 'Restablecer conexión';
    V.toggleOnline = () => {
      const on = !s.online;
      this.up({ online: on }, () => {
        if (!on) this.toast('Modo sin conexión — el flujo de venta sigue disponible', 'warn');
        else if (this.state.pending.length) this.doSync();
      });
    };
    V.showSyncBtn = s.online && s.pending.length > 0 && !s.syncing;
    V.pendingCount = s.pending.length; V.syncNow = () => this.doSync(); V.syncing = s.syncing;
    V.toasts = s.toasts.map(t => ({ msg: t.msg, dotStyle: { width: 8, height: 8, borderRadius: '50%', flex: 'none', background: t.kind === 'warn' ? tint : acc } }));

    // ---- module flags
    V.mPos = s.module === 'pos'; V.mOrders = s.module === 'ordenes'; V.mMenu = s.module === 'menu';
    V.mInv = s.module === 'inventario'; V.mRep = s.module === 'reportes'; V.mCfg = s.module === 'config';
    V.mCheckout = s.module === 'checkout' && !!s.ck;

    // ---- POS catalog
    const vista = this.props.vistaCatalogo ?? 'cuadricula';
    const showAgotados = this.props.mostrarAgotados ?? true;
    V.search = s.search; V.setSearch = e => this.setState({ search: e.target.value });
    V.cats = D.categories.map(c => ({ label: c.label, style: chip(s.cat === c.id && !s.search), pick: () => this.setState({ cat: c.id, search: '' }) }));
    let plist = s.prods.filter(p => s.search ? p.name.toLowerCase().includes(s.search.toLowerCase()) : p.cat === s.cat);
    if (!showAgotados) plist = plist.filter(p => p.available);
    V.prodsEmpty = plist.length === 0;
    V.gridStyle = vista === 'lista' ? { display: 'flex', flexDirection: 'column', gap: 8 } : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 };
    V.prods = plist.map(p => ({
      id: p.id, name: p.name, price: this.fmt(p.price), unavailable: !p.available,
      style: { display: 'flex', flexDirection: vista === 'lista' ? 'row' : 'column', justifyContent: 'space-between', gap: 8, alignItems: vista === 'lista' ? 'center' : 'stretch', textAlign: 'left', padding: '13px 14px', background: paper, border: '1px solid ' + line, borderRadius: 10, cursor: p.available ? 'pointer' : 'default', opacity: p.available ? 1 : 0.55, minHeight: vista === 'lista' ? 0 : 76 },
      open: () => {
        if (!p.available) { this.toast(p.name + ' está agotado hoy', 'warn'); return; }
        const m = {}; p.mods.forEach(g => { const G = D.modGroups[g]; const first = G && G.options.find(op => op.active !== false); if (G && G.min > 0 && first) m[g] = [first.id]; });
        this.setState({ ed: { prodId: p.id, qty: 1, mods: m, notes: '', lineId: null } });
      }
    }));

    // ---- current order
    const o = s.order; const ot = this.orderTotals(o);
    V.hasFolio = !!o.folio; V.orderFolio = o.folio || '';
    V.typeBtns = [['local', 'En local'], ['mesa', 'Mesa'], ['llevar', 'Llevar'], ['domicilio', 'Domicilio'], ['recoger', 'Recoger']].map(([id, label]) => ({ label, style: chipSm(o.type === id), pick: () => this.up({ order: { ...o, type: id } }) }));
    V.showMesa = o.type === 'mesa';
    V.mesa = o.mesa; V.setMesa = e => this.up({ order: { ...this.state.order, mesa: e.target.value } });
    V.orderName = o.name; V.setOrderName = e => this.up({ order: { ...this.state.order, name: e.target.value } });
    V.linesEmpty = o.items.length === 0;
    V.lines = o.items.map(l => ({
      lineId: l.lineId,
      qty: l.qty, name: (s.prods.find(p => p.id === l.prodId) || {}).name || '—',
      modsText: this.modsText(l), hasMods: !!this.modsText(l), notes: l.notes, hasNotes: !!l.notes,
      total: this.fmt(this.lineUnit(l) * l.qty),
      inc: () => this.up({ order: { ...this.state.order, items: this.state.order.items.map(x => x.lineId === l.lineId ? { ...x, qty: x.qty + 1 } : x) } }),
      dec: () => this.up({ order: { ...this.state.order, items: this.state.order.items.map(x => x.lineId === l.lineId ? { ...x, qty: Math.max(1, x.qty - 1) } : x) } }),
      remove: () => this.up({ order: { ...this.state.order, items: this.state.order.items.filter(x => x.lineId !== l.lineId) } }, () => this.toast('Producto eliminado de la orden')),
      edit: () => this.setState({ ed: { prodId: l.prodId, qty: l.qty, mods: JSON.parse(JSON.stringify(l.mods || {})), notes: l.notes || '', lineId: l.lineId } })
    }));
    V.itemCount = o.items.reduce((a, l) => a + l.qty, 0);
    V.subtotal = this.fmt(ot.sub); V.hasDiscount = ot.disc > 0; V.discount = this.fmt(ot.disc); V.total = this.fmt(ot.total);
    V.addDiscount = () => {
      if (!this.can('descuento')) { this.notAllowed('aplicar descuentos'); return; }
      this.setState({ dlg: { title: 'Aplicar descuento', body: 'El descuento se resta del subtotal y queda auditado con tu usuario.', needReason: true, confirmLabel: 'Aplicar', fields: [{ key: 'monto', label: 'Monto (MXN)', ph: '0.00', value: '' }], onConfirm: d => { const f = (d.fields || []).find(x => x.key === 'monto'); const v = parseFloat(f && f.value) || 0; if (v <= 0) { this.toast('Captura un monto válido', 'warn'); return 'keep'; } this.up({ order: { ...this.state.order, discount: v, discountReason: d.reason } }); this.toast('Descuento de ' + this.fmt(v) + ' aplicado'); } } });
    };
    V.chargeStyle = { padding: '14px 12px', background: o.items.length ? acc : line, color: o.items.length ? paper : mut, border: 'none', borderRadius: 9, fontSize: 15, fontWeight: 500, cursor: o.items.length ? 'pointer' : 'default', gridColumn: 'span 2' };
    V.saveOpen = () => { const f = this.saveOpen(); if (f) this.toast('Cuenta ' + f + ' guardada como abierta'); };
    V.sendComanda = () => {
      if (!this.needItems()) return;
      const f = this.saveOpen(true);
      this.toast('Comanda ' + f + ' enviada a cocina y barra' + (s.flags.autoprint ? ' · impresa' : ''));
    };
    V.goCharge = () => { if (!this.needItems()) return; const oo = this.state.order; this.startCheckout(oo.folio, oo.items, oo.discount, this.typeLabel(oo.type) + (oo.type === 'mesa' && oo.mesa ? ' ' + oo.mesa : ''), true); };
    V.cancelOrder = () => {
      if (!o.items.length && !o.folio) { this.toast('No hay orden que cancelar', 'warn'); return; }
      this.setState({ dlg: { title: 'Cancelar orden actual', body: 'Se vaciará la estación de venta. Si la cuenta ya estaba guardada, quedará registrada como cancelada.', needReason: true, danger: true, confirmLabel: 'Cancelar orden', onConfirm: d => { const st = this.state; this.up({ order: this.blank(), open: st.open.filter(x => x.folio !== st.order.folio) }); this.toast('Orden cancelada · ' + d.reason); } } });
    };

    // ---- editor
    const ed = s.ed;
    V.ed = !!ed;
    if (ed) {
      const p = s.prods.find(x => x.id === ed.prodId) || { name: '', price: 0, mods: [] };
      const unit = this.lineUnit(ed);
      V.edName = p.name; V.edPrice = this.fmt(p.price); V.edQty = ed.qty;
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
              text: op.label + (op.price ? ' +$' + op.price : ''), style: chipSm(on),
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
      V.edConfirmLabel = (ed.lineId ? 'Guardar' : 'Agregar') + ' · ' + this.fmt(unit * ed.qty);
      V.edCancel = () => this.setState({ ed: null });
      V.edConfirm = () => {
        const st = this.state; const e2 = st.ed;
        let normalizedMods;
        let currentCatalog;
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
          captureProductLine(currentCatalog, { productId: e2.prodId, quantity: e2.qty, selections, notes: e2.notes });
          normalizedMods = Object.fromEntries(Object.entries(selections).map(([groupId, selection]) => [groupId, selection.optionIds]));
        } catch (error) {
          this.toast(error.message || 'Revisa las opciones obligatorias', 'warn');
          return;
        }
        const linePatch = { prodId: e2.prodId, qty: e2.qty, mods: normalizedMods, notes: e2.notes };
        let items;
        if (e2.lineId) items = st.order.items.map(x => x.lineId === e2.lineId ? { ...x, ...linePatch } : x);
        else items = [...st.order.items, { lineId: 'l' + Date.now(), ...linePatch }];
        this.up({ order: { ...st.order, items }, ed: null }, () => this.toast(p.name + (e2.lineId ? ' actualizado' : ' agregado a la orden')));
      };
    } else { V.edName = ''; V.edPrice = ''; V.edQty = 1; V.edGroups = []; V.edNotes = ''; V.edSetNotes = () => {}; V.edInc = V.edDec = V.edCancel = V.edConfirm = () => {}; V.edConfirmLabel = ''; }

    // ---- open orders
    V.ordersCount = s.open.length; V.ordersEmpty = s.open.length === 0;
    V.orders = s.open.map(oo => {
      const total = oo.items.reduce((a, l) => a + (l.unit || 0) * l.qty, 0) - (oo.discount || 0);
      const pt = prepTags[oo.prep] || prepTags['en-cola']; const st2 = syncTags[oo.sync] || syncTags.sincronizada;
      return {
        folio: oo.folio, total: this.fmt(total),
        prepLabel: pt[0], prepStyle: tag(pt[1], pt[2]),
        syncLabel: st2[0], syncStyle: tag(st2[1], st2[2]),
        meta: this.typeLabel(oo.type) + ' · ' + oo.ref + ' · ' + oo.time + ' · ' + oo.user,
        itemsText: oo.items.map(l => l.qty + '× ' + l.name).join(' · '),
        conflict: oo.sync === 'conflicto',
        resolve: () => this.setState({ dlg: { title: 'Conflicto de sincronización', body: oo.folio + ' fue modificada también en otro dispositivo. Conserva la versión de esta caja para continuar; la otra versión quedará en el historial de auditoría.', confirmLabel: 'Conservar esta versión', onConfirm: () => { this.up({ open: this.state.open.map(x => x.folio === oo.folio ? { ...x, sync: 'sincronizada' } : x) }); this.toast('Conflicto resuelto — versión local conservada'); } } }),
        resume: () => {
          const items = oo.items.map((l, i) => ({ lineId: 'l' + Date.now() + i, prodId: l.prodId, qty: l.qty, mods: l.mods || {}, notes: l.notes || '' }));
          this.up({ order: { folio: oo.folio, type: oo.type, mesa: oo.type === 'mesa' ? oo.ref.replace(/\D/g, '') : '', name: oo.name || '', items, discount: oo.discount || 0 }, open: this.state.open.filter(x => x.folio !== oo.folio), module: 'pos' }, () => this.toast(oo.folio + ' abierta en la estación'));
        },
        charge: () => this.startCheckout(oo.folio, oo.items, oo.discount, this.typeLabel(oo.type) + ' · ' + oo.ref, false),
        reprint: () => this.toast('Comanda de ' + oo.folio + ' reimpresa en cocina'),
        move: () => this.setState({ dlg: { title: 'Mover ' + oo.folio, body: 'Cambia la mesa o referencia de la cuenta.', confirmLabel: 'Mover', fields: [{ key: 'ref', label: 'Nueva mesa o referencia', ph: 'P. ej. Mesa 7', value: '' }], onConfirm: d => { const f = (d.fields || [])[0]; if (!f || !f.value) { this.toast('Captura la nueva referencia', 'warn'); return 'keep'; } this.up({ open: this.state.open.map(x => x.folio === oo.folio ? { ...x, ref: f.value, type: /mesa/i.test(f.value) ? 'mesa' : x.type } : x) }); this.toast(oo.folio + ' movida a ' + f.value); } } }),
        split: () => {
          if (oo.items.length < 2) { this.toast('La cuenta necesita al menos 2 productos para dividirse', 'warn'); return; }
          this.setState({ dlg: { title: 'Dividir ' + oo.folio, body: 'Se creará un folio nuevo con la mitad de los productos. Después podrás cobrar cada cuenta por separado.', confirmLabel: 'Dividir cuenta', onConfirm: () => { const st = this.state; const src = st.open.find(x => x.folio === oo.folio); const half = Math.ceil(src.items.length / 2); const nfo = this.nf(); const b = { ...src, folio: nfo, items: src.items.slice(half), time: this.now(), ref: src.ref + ' (2)' }; const a = { ...src, items: src.items.slice(0, half) }; this.up({ open: [b, ...st.open.map(x => x.folio === oo.folio ? a : x)] }); this.toast(oo.folio + ' dividida — nueva cuenta ' + nfo); } } });
        },
        merge: () => this.setState({ dlg: { title: 'Unir con ' + oo.folio, body: 'Los productos de la otra cuenta pasarán a esta y el folio origen se cerrará.', confirmLabel: 'Unir cuentas', fields: [{ key: 'src', label: 'Folio a unir', ph: 'P. ej. A-1049', value: '' }], onConfirm: d => { const f = (d.fields || [])[0]; const st = this.state; const src = st.open.find(x => x.folio === (f && f.value.trim().toUpperCase())); if (!src || src.folio === oo.folio) { this.toast('No se encontró esa cuenta abierta', 'warn'); return 'keep'; } this.up({ open: st.open.filter(x => x.folio !== src.folio).map(x => x.folio === oo.folio ? { ...x, items: [...x.items, ...src.items] } : x) }); this.toast(src.folio + ' unida con ' + oo.folio); } } }),
        cancel: () => this.cancelOpen(oo.folio)
      };
    });

    // ---- checkout
    const ck = s.ck;
    if (ck) {
      const m = this.ckMath(ck);
      V.ckFolio = ck.folio || 'Nueva venta'; V.ckTypeLabel = ck.type;
      const stepIdx = { review: 0, pay: 1, confirm: 2, processing: 2, result: 2 }[ck.step] || 0;
      V.ckSteps = ['Resumen', 'Pago', 'Confirmación'].map((l, i) => ({ label: l, style: { fontSize: 11.5, fontWeight: 500, padding: '5px 11px', borderRadius: 999, background: i === stepIdx ? acc : (i < stepIdx ? tint : 'transparent'), color: i === stepIdx ? paper : (i < stepIdx ? acc : mut), border: i > stepIdx ? '1px solid ' + line : 'none' } }));
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
      V.tipBtns = [['0', 'Sin propina'], ['5', '5%'], ['10', '10%'], ['15', '15%'], ['otro', 'Otra']].map(([id, label]) => ({ label, style: chipSm(ck.tipSel === id), pick: () => retune({ tipSel: id }) }));
      V.showTipCustom = ck.tipSel === 'otro' && (s.flags.propCustom !== false);
      V.tipCustom = ck.tipCustom; V.setTipCustom = e => retune({ tipCustom: e.target.value });
      const methodList = [['efectivo', 'Efectivo', s.flags.fpEfectivo], ['tarjeta', 'Tarjeta', s.flags.fpTarjeta], ['transferencia', 'Transferencia', s.flags.fpTransfer]].filter(x => x[2] !== false);
      V.pays = ck.pays.map(p => ({
        amount: p.amount,
        methods: methodList.map(([id, label]) => ({ label, style: chipSm(p.method === id), pick: () => this.setCk({ pays: ck.pays.map(x => x.id === p.id ? { ...x, method: id } : x) }) })),
        setAmount: e => this.setCk({ pays: this.state.ck.pays.map(x => x.id === p.id ? { ...x, amount: e.target.value } : x) }),
        fillRest: () => { const cur = parseFloat(p.amount) || 0; const m2 = this.ckMath(ck); this.setCk({ pays: ck.pays.map(x => x.id === p.id ? { ...x, amount: (cur + m2.remaining).toFixed(2) } : x) }); },
        canRemove: ck.pays.length > 1,
        remove: () => this.setCk({ pays: ck.pays.filter(x => x.id !== p.id) })
      }));
      V.addPay = () => this.setCk({ pays: [...ck.pays, { id: Date.now(), method: 'tarjeta', amount: m.remaining.toFixed(2) }] });
      V.paid = this.fmt(m.paid); V.remaining = this.fmt(m.remaining);
      V.hasChange = m.change > 0; V.change = this.fmt(m.change);
      V.hasPayMsg = !m.valid && m.paid > 0;
      V.payMsg = m.over > 0.001 && !m.hasCash ? 'El monto capturado excede el total y no hay efectivo para dar cambio.' : 'El monto cubierto aún no coincide con el total de la orden.';
      V.payNextStyle = { padding: '11px 22px', background: m.valid ? acc : line, color: m.valid ? paper : mut, border: 'none', borderRadius: 9, fontSize: 13.5, fontWeight: 500, cursor: m.valid ? 'pointer' : 'default' };
      V.confirmPays = ck.pays.filter(p => (parseFloat(p.amount) || 0) > 0).map(p => ({ method: ({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' })[p.method], amount: this.fmt(parseFloat(p.amount)) }));
      V.ckNext = () => { if (ck.step === 'review') this.setCk({ step: 'pay' }); else if (ck.step === 'pay' && m.valid) this.setCk({ step: 'confirm' }); };
      V.ckBack = () => this.setCk({ step: ck.step === 'confirm' ? 'pay' : 'review' });
      V.ckExit = () => this.up({ ck: null, module: ck.fromStation ? 'pos' : 'ordenes' });
      V.ckRegister = () => this.register();
      V.ckRetry = () => this.register();
      V.ckChangeMethod = () => this.setCk({ step: 'pay', ok: null });
      V.hasResultChange = ck.change > 0; V.resultChange = this.fmt(ck.change);
      V.resultSyncNote = s.online ? 'Venta ' + (ck.folio || '') + ' sincronizada con el respaldo.' : 'Venta guardada localmente — se sincronizará al reconectar.';
      V.ckPrint = () => this.toast('Ticket enviado a la impresora de caja');
      V.ckNew = () => this.up({ ck: null, module: 'pos' });
    } else {
      Object.assign(V, { ckFolio: '', ckTypeLabel: '', ckSteps: [], ckLines: [], ckItemCount: 0, ckSubtotal: '', ckHasDiscount: false, ckDiscount: '', ckTip: '', ckTotal: '', ckReview: false, ckPay: false, ckConfirm: false, ckProcessing: false, ckResult: false, ckOk: false, ckFail: false, ckError: '', tipBtns: [], showTipCustom: false, tipCustom: '', setTipCustom: () => {}, pays: [], addPay: () => {}, paid: '', remaining: '', hasChange: false, change: '', hasPayMsg: false, payMsg: '', payNextStyle: {}, confirmPays: [], ckNext: () => {}, ckBack: () => {}, ckExit: () => {}, ckRegister: () => {}, ckRetry: () => {}, ckChangeMethod: () => {}, hasResultChange: false, resultChange: '', resultSyncNote: '', ckPrint: () => {}, ckNew: () => {} });
    }

    // ---- menu admin
    const counts = {}; s.prods.forEach(p => counts[p.cat] = (counts[p.cat] || 0) + 1);
    V.admCats = [{ id: 'all', label: 'Todo el menú' }, ...D.categories].map(c => ({
      label: c.label, count: c.id === 'all' ? s.prods.length : (counts[c.id] || 0),
      style: { display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: s.admCat === c.id ? 500 : 400, background: s.admCat === c.id ? tint : 'transparent', color: s.admCat === c.id ? acc : ink },
      pick: () => this.setState({ admCat: c.id })
    }));
    V.admNewCat = () => this.toast('Editor de categorías y grupos — próximamente en esta etapa', 'warn');
    V.admSearch = s.admSearch; V.setAdmSearch = e => this.setState({ admSearch: e.target.value });
    const aplist = s.prods.filter(p => (s.admCat === 'all' || p.cat === s.admCat) && (!s.admSearch || p.name.toLowerCase().includes(s.admSearch.toLowerCase())));
    const catLabel = id => (D.categories.find(c => c.id === id) || {}).label || id;
    V.admProds = aplist.map(p => ({
      name: p.name, catLabel: catLabel(p.cat), price: this.fmt(p.price),
      availLabel: p.available ? 'Activo' : 'Inactivo', availStyle: tag(p.available ? tint : bg, p.available ? acc : mut),
      style: { display: 'grid', gridTemplateColumns: '1fr 130px 90px 110px', gap: 10, padding: '11px 16px', border: 'none', borderBottom: '1px solid ' + line, fontSize: 13, alignItems: 'center', background: s.admSel === p.id ? tint : 'transparent', cursor: 'pointer', width: '100%', textAlign: 'left', color: ink },
      pick: () => this.setState({ admSel: p.id, admForm: { name: p.name, price: String(p.price), cat: p.cat, available: p.available } })
    }));
    V.admNew = () => this.setState({ admSel: 'new', admForm: { name: '', price: '', cat: s.admCat === 'all' ? 'concafe' : s.admCat, available: true } });
    const af = s.admForm;
    V.hasAdmSel = !!s.admSel && !!af;
    V.catOptions = D.categories.map(c => ({ id: c.id, label: c.label }));
    if (af) {
      const selP = s.prods.find(p => p.id === s.admSel);
      V.fName = af.name; V.setFName = e => this.setState({ admForm: { ...af, name: e.target.value } });
      V.fPrice = af.price; V.setFPrice = e => this.setState({ admForm: { ...af, price: e.target.value } });
      V.fCat = af.cat; V.setFCat = e => this.setState({ admForm: { ...af, cat: e.target.value } });
      V.fAvailLabel = af.available ? 'Disponible en el POS' : 'No disponible (agotado)';
      V.fAvailStyle = chipSm(af.available);
      V.fToggleAvail = () => this.setState({ admForm: { ...af, available: !af.available } });
      V.fMods = (selP ? selP.mods : []).map(g => ({ label: D.modGroups[g].label, meta: D.modGroups[g].options.length + ' opciones' + (D.modGroups[g].min ? ' · obligatorio' : '') }));
      const rec = D.recipes.find(r => selP && r.product === selP.name);
      V.fInv = rec ? rec.items.map(([n, use]) => ({ name: n, use: use + ' por unidad' })) : [{ name: 'Sin receta asociada', use: '' }];
      V.pvName = af.name || 'Nuevo producto'; V.pvPrice = this.fmt(parseFloat(af.price) || 0);
      V.admClose = () => this.setState({ admSel: null, admForm: null });
      V.admSave = () => {
        const st = this.state; const f = st.admForm;
        let prods;
        try {
          prods = saveMenuProduct(st.prods, st.admSel, f, 'x' + Date.now());
        } catch (error) {
          this.toast(error.message || 'Revisa nombre, categoría y precio del producto', 'warn');
          return;
        }
        this.up({ prods, admSel: null, admForm: null }, () => this.toast('«' + f.name + '» guardado en el menú'));
      };
    } else { Object.assign(V, { fName: '', setFName: () => {}, fPrice: '', setFPrice: () => {}, fCat: '', setFCat: () => {}, fAvailLabel: '', fAvailStyle: {}, fToggleAvail: () => {}, fMods: [], fInv: [], pvName: '', pvPrice: '', admClose: () => {}, admSave: () => {} }); }

    // ---- inventory
    V.invTabs = [['stock', 'Existencias'], ['mov', 'Movimientos'], ['rec', 'Recetas']].map(([id, label]) => ({ label, style: chipSm(s.invTab === id), pick: () => this.setState({ invTab: id }) }));
    V.tStock = s.invTab === 'stock'; V.tMov = s.invTab === 'mov'; V.tRec = s.invTab === 'rec';
    V.invSearch = s.invSearch; V.setInvSearch = e => this.setState({ invSearch: e.target.value });
    V.toggleLow = () => this.setState({ invLow: !s.invLow });
    V.lowToggleStyle = chipSm(s.invLow);
    let inv = D.inventory.filter(i => !s.invSearch || i.name.toLowerCase().includes(s.invSearch.toLowerCase()));
    if (s.invLow) inv = inv.filter(i => i.qty <= i.min);
    V.stockEmpty = inv.length === 0;
    V.stock = inv.map(i => {
      const low = i.qty <= i.min;
      return { name: i.name, kind: i.kind, qty: i.qty + ' ' + i.unit, min: i.min + ' ' + i.unit, tagLabel: low ? 'Stock bajo' : 'OK', tagStyle: tag(low ? acc : bg, low ? paper : mut) };
    });
    const movTags = { entrada: ['Entrada', tint, acc], merma: ['Merma', ink, paper], ajuste: ['Ajuste', bg, mut], venta: ['Venta', 'transparent', '#a8a69c'] };
    V.movs = s.movs.map(mv => { const t = movTags[mv.tipo]; return { tipoLabel: t[0], tagStyle: tag(t[1], t[2]), item: mv.item, qty: mv.qty, user: mv.user, date: mv.date, motivo: mv.motivo }; });
    V.recs = D.recipes.map(r => ({ product: r.product, items: r.items.map(([name, use, conv]) => ({ name, use, conv })) }));
    V.regEntrada = () => this.invDialog('entrada', 'Registrar entrada', false);
    V.regMerma = () => this.invDialog('merma', 'Registrar merma', false);
    V.regAjuste = () => this.invDialog('ajuste', 'Ajuste manual de inventario', true);

    // ---- reports
    V.ranges = [['hoy', 'Hoy'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días']].map(([id, label]) => ({ label, style: chipSm(s.range === id), pick: () => this.setState({ range: id }) }));
    const lim = s.range === 'hoy' ? 0 : s.range === '7d' ? 6 : 30;
    const rs = s.sales.filter(x => (x.day || 0) <= lim);
    const done = rs.filter(x => x.status === 'completada');
    V.repVentas = this.fmt(done.reduce((a, x) => a + x.total, 0));
    V.repTickets = done.length;
    V.repProps = this.fmt(done.reduce((a, x) => a + x.tip, 0));
    V.repCanc = rs.length - done.length;
    const mm = {}; done.forEach(x => x.payments.forEach(p => mm[p.method] = (mm[p.method] || 0) + p.amount));
    const mmax = Math.max(1, ...Object.values(mm));
    V.methods = Object.keys(mm).map(k => ({ label: k, amount: this.fmt(mm[k]), barStyle: { height: 5, borderRadius: 999, background: acc, width: (mm[k] / mmax * 100).toFixed(0) + '%' } }));
    const tp = {}; done.forEach(x => x.items.forEach(i => { tp[i.name] = tp[i.name] || { q: 0, a: 0 }; tp[i.name].q += i.qty; tp[i.name].a += i.total; }));
    V.topProds = Object.keys(tp).sort((a, b) => tp[b].a - tp[a].a).slice(0, 6).map(k => ({ name: k, qty: tp[k].q, amount: this.fmt(tp[k].a) }));
    const bu = {}; done.forEach(x => { bu[x.cobro] = bu[x.cobro] || { t: 0, a: 0 }; bu[x.cobro].t += 1; bu[x.cobro].a += x.total; });
    V.byUser = Object.keys(bu).map(k => ({ name: k, meta: bu[k].t + ' tickets', amount: this.fmt(bu[k].a) }));
    const stTags = { completada: ['Completada', tint, acc], cancelada: ['Cancelada', ink, paper], reembolsada: ['Reembolsada', bg, mut] };
    V.repSales = rs.map(x => ({ folio: x.folio, fecha: x.fecha, tipo: x.tipo, user: x.cobro, total: this.fmt(x.total), statusLabel: stTags[x.status][0], statusStyle: tag(stTags[x.status][1], stTags[x.status][2]), syncLabel: x.sync === 'pendiente' ? 'Por sincronizar' : 'Sincronizada', open: () => this.setState({ repSel: x.folio }) }));
    V.exportar = () => this.toast('ventas_abboth_' + s.range + '.xlsx exportado (simulado)');
    const sel = s.sales.find(x => x.folio === s.repSel);
    V.hasRepSel = !!sel;
    if (sel) {
      V.dFolio = sel.folio; V.dStatusLabel = stTags[sel.status][0]; V.dStatusStyle = tag(stTags[sel.status][1], stTags[sel.status][2]);
      V.dMeta = sel.fecha + ' · ' + sel.tipo + ' — creó ' + sel.creo + ' · cobró ' + sel.cobro + ' · ' + (sel.sync === 'pendiente' ? 'por sincronizar' : 'sincronizada');
      V.dHasMotivo = !!sel.motivo; V.dMotivo = sel.motivo || '';
      V.dItems = sel.items.map(i => ({ qty: i.qty, name: i.name, mods: i.mods, hasMods: !!i.mods, total: this.fmt(i.total) }));
      V.dPays = sel.payments.map(p => ({ method: p.method, amount: this.fmt(p.amount) }));
      V.dTip = this.fmt(sel.tip); V.dTotal = this.fmt(sel.total);
      V.dAudit = sel.audit.map(a => ({ t: a[0], e: a[1], u: a[2] }));
      V.closeDetail = () => this.setState({ repSel: null });
    } else { Object.assign(V, { dFolio: '', dStatusLabel: '', dStatusStyle: {}, dMeta: '', dHasMotivo: false, dMotivo: '', dItems: [], dPays: [], dTip: '', dTotal: '', dAudit: [], closeDetail: () => {} }); }

    // ---- users & config
    V.cfgTabs = [['usuarios', 'Usuarios'], ['config', 'Configuración']].map(([id, label]) => ({ label, style: chipSm(s.cfgTab === id), pick: () => this.setState({ cfgTab: id }) }));
    V.cUsers = s.cfgTab === 'usuarios'; V.cCfg = s.cfgTab === 'config';
    V.newUser = () => this.setState({ selUser: 'new', suForm: { name: '', role: 'cajero', active: true, perms: null } });
    V.usersRows = s.usersX.map(u => ({
      name: u.name, roleLabel: D.roleLabels[u.role],
      activeLabel: u.active ? 'Activo' : 'Inactivo', activeStyle: tag(u.active ? tint : bg, u.active ? acc : mut),
      toggleLabel: u.active ? 'Desactivar' : 'Activar',
      style: { display: 'grid', gridTemplateColumns: '1fr 160px 80px 110px 90px', gap: 10, padding: '11px 16px', borderBottom: '1px solid ' + line, alignItems: 'center', background: s.selUser === u.id ? tint : 'transparent' },
      pick: () => this.setState({ selUser: u.id, suForm: { name: u.name, role: u.role, active: u.active, perms: null } }),
      toggleActive: () => this.up({ usersX: s.usersX.map(x => x.id === u.id ? { ...x, active: !x.active } : x) }, () => this.toast(u.name + (u.active ? ' desactivado' : ' activado')))
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
      V.suRoles = Object.keys(D.roleLabels).map(r => ({ label: D.roleLabels[r], style: chipSm(su.role === r), pick: () => this.setState({ suForm: { ...su, role: r, perms: null } }) }));
      V.suPerms = ['Cobrar órdenes', 'Cancelar con motivo', 'Aplicar descuentos', 'Editar menú', 'Ajustar inventario', 'Ver reportes', 'Administrar usuarios'].map(p => {
        const on = perms.includes(p);
        return { label: p, mark: on ? '✓' : '—', style: { display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, border: '1px solid ' + (on ? acc : line), background: on ? tint : paper, color: on ? acc : mut }, toggle: () => this.setState({ suForm: { ...su, perms: on ? perms.filter(x => x !== p) : [...perms, p] } }) };
      });
      const audits = s.sales.flatMap(x => (x.audit || []).filter(a => a[2] === su.name).map(a => ({ t: x.fecha.split(' · ')[0] + ' ' + a[0], e: a[1] + ' · ' + x.folio }))).slice(0, 6);
      V.suAudit = audits.length ? audits : [{ t: '—', e: 'Sin acciones registradas todavía' }];
      V.suClose = () => this.setState({ selUser: null, suForm: null });
      V.suSave = () => {
        const st = this.state; const f = st.suForm;
        if (!f.name) { this.toast('El usuario necesita nombre', 'warn'); return; }
        let usersX;
        if (st.selUser === 'new') usersX = [...st.usersX, { id: 'u' + Date.now(), name: f.name, role: f.role, pin: '0000', active: f.active }];
        else usersX = st.usersX.map(u => u.id === st.selUser ? { ...u, name: f.name, role: f.role, active: f.active } : u);
        this.up({ usersX, selUser: null, suForm: null }, () => this.toast('Usuario «' + f.name + '» guardado' + (st.selUser === 'new' ? ' · PIN temporal 0000' : '')));
      };
    } else { Object.assign(V, { suName: '', setSuName: () => {}, suRoles: [], suPerms: [], suAudit: [], suClose: () => {}, suSave: () => {} }); }
    const togg = key => {
      const on = s.flags[key] !== false;
      return {
        hasToggle: true, hasValue: false,
        toggStyle: { width: 38, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer', background: on ? acc : line, position: 'relative', padding: 0, flex: 'none' },
        knobStyle: { position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: paper, transition: 'left .15s ease' },
        toggle: () => this.up({ flags: { ...this.state.flags, [key]: !on } })
      };
    };
    const row = (label, value) => ({ label, value, hasValue: true, hasToggle: false, toggle: () => {}, toggStyle: {}, knobStyle: {} });
    V.cfgCards = [
      { title: 'Datos del negocio', rows: [row('Nombre', 'Abboth'), row('Sucursal', 'Centro · única'), row('Moneda', 'MXN — pesos mexicanos'), row('Redes', '@Abboth.mx')], hasAction: false, action: () => {}, actionLabel: '' },
      { title: 'Impresión', rows: [row('Tickets', 'EPSON TM-T20 · Caja'), row('Comandas', 'Estrella SP700 · Cocina'), { label: 'Imprimir comanda automáticamente', ...togg('autoprint') }], hasAction: false, action: () => {}, actionLabel: '' },
      { title: 'Formas de pago', rows: [{ label: 'Efectivo', ...togg('fpEfectivo') }, { label: 'Tarjeta (terminal)', ...togg('fpTarjeta') }, { label: 'Transferencia', ...togg('fpTransfer') }], hasAction: false, action: () => {}, actionLabel: '' },
      { title: 'Propinas', rows: [row('Sugerencias', '5% · 10% · 15%'), { label: 'Permitir propina personalizada', ...togg('propCustom') }], hasAction: false, action: () => {}, actionLabel: '' },
      { title: 'Reglas de cancelación', rows: [{ label: 'Requerir motivo', ...togg('cancelMotivo') }, { label: 'Autorización de encargado', ...togg('cancelAut') }], hasAction: false, action: () => {}, actionLabel: '' },
      { title: 'Respaldo y recuperación', rows: [row('Último respaldo', 'Hoy · 03:00'), row('Copias locales', '7 días retenidos')], hasAction: true, actionLabel: 'Respaldar ahora', action: () => this.toast('Respaldo local creado — Hoy · ' + this.now()) },
      { title: 'Sincronización', rows: [row('Estado', s.online ? 'Conectado' : 'Sin conexión'), row('Operaciones pendientes', String(s.pending.length)), row('Último contacto', s.online ? 'Hace unos segundos' : 'Hoy · 12:26')], hasAction: true, actionLabel: 'Forzar sincronización', action: () => this.doSync() }
    ];

    // ---- dialog
    const dg = s.dlg;
    V.dlg = !!dg;
    if (dg) {
      V.dlgTitle = dg.title; V.dlgBody = dg.body;
      V.dlgFields = (dg.fields || []).map(f => ({ label: f.label, value: f.value, ph: f.ph || '', set: e => this.setState({ dlg: { ...this.state.dlg, fields: this.state.dlg.fields.map(x => x.key === f.key ? { ...x, value: e.target.value } : x) } }) }));
      V.dlgNeedReason = !!dg.needReason && s.flags.cancelMotivo !== false || !!dg.needReason;
      V.dlgReason = dg.reason || ''; V.setDlgReason = e => this.setState({ dlg: { ...this.state.dlg, reason: e.target.value } });
      V.hasDlgErr = !!dg.err; V.dlgErr = dg.err || '';
      V.dlgHasConfirm = !!dg.onConfirm;
      V.dlgCloseLabel = dg.onConfirm ? 'Volver' : (dg.closeLabel || 'Entendido');
      V.dlgConfirmLabel = dg.confirmLabel || 'Confirmar';
      V.dlgConfirmStyle = { padding: '10px 18px', background: dg.danger ? ink : acc, color: paper, border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: 'pointer' };
      V.dlgClose = () => this.setState({ dlg: null });
      V.dlgConfirm = () => {
        const d = this.state.dlg;
        if (d.needReason && !(d.reason || '').trim()) { this.setState({ dlg: { ...d, err: 'El motivo es obligatorio para esta operación.' } }); return; }
        const r = d.onConfirm && d.onConfirm(d);
        if (r !== 'keep') this.setState({ dlg: null });
      };
    } else { Object.assign(V, { dlgTitle: '', dlgBody: '', dlgFields: [], dlgNeedReason: false, dlgReason: '', setDlgReason: () => {}, hasDlgErr: false, dlgErr: '', dlgHasConfirm: false, dlgCloseLabel: '', dlgConfirmLabel: '', dlgConfirmStyle: {}, dlgClose: () => {}, dlgConfirm: () => {} }); }

    return V;
  }

  render() {
    const V = this.renderVals();
    return (
      <>

{(V.loading) && (<>
<div style={css("height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px")}>
<div style={css("font-family:Georgia,serif;font-style:italic;font-size:36px")}>Karma</div>
<div style={css("width:22px;height:22px;border:2px solid #e2e0d6;border-top-color:#836953;border-radius:50%;animation:spin .8s linear infinite")}></div>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Cargando estación</div>
</div>
</>)}

{(V.isLogin) && (<>
<div style={css("min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px")}>
<div style={css("width:420px;max-width:100%;display:flex;flex-direction:column;gap:24px;animation:rise .35s ease")}>
<div style={css("text-align:center")}>
<div style={css("font-family:Georgia,serif;font-style:italic;font-size:42px;line-height:1")}>Karma</div>
<div style={css("margin-top:8px;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Punto de venta · Abboth</div>
</div>
<div>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500;margin-bottom:10px")}>¿Quién abre la estación?</div>
<div style={css("display:flex;flex-wrap:wrap;gap:8px")}>
{(V.loginUsers).map((u, uI) => (<React.Fragment key={uI}>
<button style={u.style} onClick={u.pick}><span style={css("font-weight:500;font-size:13.5px")}>{u.name}</span><span style={u.subStyle}>{u.roleLabel}</span></button>
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
<div style={css("display:flex;height:100vh;overflow:hidden")}>
<aside style={css("width:236px;flex:none;background:#faf9f5;border-right:1px solid #e2e0d6;display:flex;flex-direction:column;padding:20px 14px 16px;gap:4px;overflow-y:auto")}>
<div style={css("padding:2px 10px 14px")}>
<div style={css("font-family:Georgia,serif;font-style:italic;font-size:27px;line-height:1")}>Karma</div>
<div style={css("margin-top:6px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Abboth · Centro</div>
</div>
<button onClick={V.goPos} style={css("margin:0 4px 12px;padding:11px 14px;background:#836953;color:#faf9f5;border:none;border-radius:9px;font-size:13.5px;font-weight:500;cursor:pointer;text-align:left")}>+ Nueva venta</button>
{(V.navItems).map((n, nI) => (<React.Fragment key={nI}>
<button style={n.style} onClick={n.go}><span>{n.label}</span>{(n.hasBadge) && (<><span style={css("background:#f6e5df;color:#836953;font-size:11px;font-weight:500;padding:2px 8px;border-radius:999px")}>{n.badge}</span></>)}</button>
</React.Fragment>))}
<div style={css("margin-top:auto;border-top:1px solid #e2e0d6;padding:14px 10px 0;display:flex;flex-direction:column;gap:12px")}>
<div style={css("display:flex;align-items:center;gap:9px")}>
<span style={V.connDotStyle}></span>
<div style={css("flex:1;min-width:0")}><div style={css("font-size:13px;font-weight:500")}>{V.connLabel}</div><div style={css("font-size:11.5px;color:#6b6a63")}>{V.connSub}</div></div>
</div>
{(V.showSyncBtn) && (<>
<button onClick={V.syncNow} style={css("padding:8px 12px;background:#f6e5df;color:#836953;border:none;border-radius:8px;font-size:12.5px;font-weight:500;cursor:pointer;text-align:left")}>Sincronizar ahora ({V.pendingCount})</button>
</>)}
<button onClick={V.toggleOnline} style={css("padding:8px 12px;background:transparent;border:1px solid #e2e0d6;border-radius:8px;font-size:12px;color:#6b6a63;cursor:pointer;text-align:left")}>{V.connToggleLabel}</button>
<a href="/comanda.html" style={css("font-size:12.5px;padding:0 2px")}>Ver comanda de cocina →</a>
<div style={css("display:flex;align-items:center;gap:9px;border-top:1px solid #e2e0d6;padding-top:12px")}>
<span style={css("width:32px;height:32px;border-radius:50%;background:#f6e5df;color:#836953;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;flex:none")}>{V.userInitials}</span>
<div style={css("flex:1;min-width:0")}><div style={css("font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{V.userName}</div><div style={css("font-size:11.5px;color:#6b6a63")}>{V.userRoleLabel}</div></div>
<button onClick={V.switchUser} style={css("border:none;background:transparent;color:#836953;font-size:12px;cursor:pointer;padding:2px")}>Salir</button>
</div>
</div>
</aside>

<main style={css("flex:1;overflow-y:auto;position:relative")}>
{(V.offline) && (<>
<div style={css("background:#f6e5df;color:#836953;font-size:12.5px;font-weight:500;padding:8px 24px;position:sticky;top:0;z-index:50")}>Sin conexión — puedes seguir vendiendo; las operaciones se guardan localmente y se sincronizarán al reconectar.</div>
</>)}

{(V.mPos) && (<SalesStation V={V} />)}

{(V.mOrders) && (<>
<div style={css("padding:22px 24px 40px;display:flex;flex-direction:column;gap:16px")}>
<div style={css("display:flex;align-items:baseline;gap:12px")}>
<h1 style={css("font-size:19px;font-weight:500;margin:0")}>Órdenes abiertas</h1>
<span style={css("font-size:12.5px;color:#6b6a63")}>{V.ordersCount} cuentas pendientes</span>
</div>
{(V.ordersEmpty) && (<>
<div style={css("padding:60px 20px;text-align:center;color:#6b6a63;font-size:13.5px;border:1px dashed #e2e0d6;border-radius:12px")}>No hay cuentas abiertas.<br />Guarda una orden desde el punto de venta para verla aquí.</div>
</>)}
<div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px")}>
{(V.orders).map((o, oI) => (<React.Fragment key={oI}>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px")}>
<div style={css("display:flex;align-items:center;gap:8px")}>
<span style={css("font-size:14px;font-weight:500")}>{o.folio}</span>
<span style={o.prepStyle}>{o.prepLabel}</span>
<span style={o.syncStyle}>{o.syncLabel}</span>
<span style={css("margin-left:auto;font-size:15px;font-weight:500")}>{o.total}</span>
</div>
<div style={css("font-size:12.5px;color:#6b6a63")}>{o.meta}</div>
<div style={css("font-size:12.5px;color:#141413;line-height:1.5")}>{o.itemsText}</div>
{(o.conflict) && (<>
<div style={css("background:#f6e5df;border-radius:8px;padding:9px 12px;display:flex;align-items:center;gap:10px")}>
<span style={css("font-size:12px;color:#836953;flex:1")}>Conflicto de sincronización: esta cuenta cambió en otro dispositivo.</span>
<button onClick={o.resolve} style={css("border:none;background:#836953;color:#faf9f5;border-radius:6px;font-size:11.5px;font-weight:500;padding:6px 10px;cursor:pointer")}>Resolver</button>
</div>
</>)}
<div style={css("display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid #e2e0d6;padding-top:10px")}>
<button onClick={o.resume} style={css("padding:7px 11px;background:#836953;color:#faf9f5;border:none;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer")}>Abrir</button>
<button onClick={o.charge} style={css("padding:7px 11px;background:#f6e5df;color:#836953;border:none;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer")}>Cobrar</button>
<button onClick={o.reprint} style={css("padding:7px 11px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:7px;font-size:12px;cursor:pointer;color:#141413")}>Comanda</button>
<button onClick={o.move} style={css("padding:7px 11px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:7px;font-size:12px;cursor:pointer;color:#141413")}>Mover</button>
<button onClick={o.split} style={css("padding:7px 11px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:7px;font-size:12px;cursor:pointer;color:#141413")}>Dividir</button>
<button onClick={o.merge} style={css("padding:7px 11px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:7px;font-size:12px;cursor:pointer;color:#141413")}>Unir</button>
<button onClick={o.cancel} style={css("padding:7px 11px;background:transparent;border:none;font-size:12px;cursor:pointer;color:#6b6a63;margin-left:auto")}>Cancelar</button>
</div>
</div>
</React.Fragment>))}
</div>
</div>
</>)}

{(V.mCheckout) && (<>
<div style={css("max-width:960px;margin:0 auto;padding:22px 24px 48px;display:flex;flex-direction:column;gap:18px")}>
<div style={css("display:flex;align-items:center;gap:14px")}>
<button onClick={V.ckExit} style={css("border:1px solid #e2e0d6;background:#faf9f5;border-radius:8px;padding:8px 12px;font-size:12.5px;cursor:pointer;color:#141413")}>← Volver</button>
<h1 style={css("font-size:19px;font-weight:500;margin:0")}>Cobro · {V.ckFolio}</h1>
<div style={css("margin-left:auto;display:flex;gap:6px")}>
{(V.ckSteps).map((s, sI) => (<React.Fragment key={sI}><span style={s.style}>{s.label}</span></React.Fragment>))}
</div>
</div>
<div style={css("display:flex;gap:18px;align-items:flex-start")}>
<div style={css("width:340px;flex:none;background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:10px")}>
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
</div>

<div style={css("flex:1;min-width:0;background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:16px")}>
{(V.ckReview) && (<>
<div style={css("font-size:15px;font-weight:500")}>Revisa la orden</div>
<div style={css("font-size:13.5px;color:#6b6a63;line-height:1.6")}>{V.ckItemCount} artículos · {V.ckTypeLabel}.<br />Verifica productos y cantidades antes de continuar. Puedes volver para editar la orden.</div>
<button onClick={V.ckNext} style={css("align-self:flex-start;padding:12px 22px;background:#836953;color:#faf9f5;border:none;border-radius:9px;font-size:14px;font-weight:500;cursor:pointer")}>Continuar al pago</button>
</>)}
{(V.ckPay) && (<>
<div>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500;margin-bottom:8px")}>Propina</div>
<div style={css("display:flex;gap:6px;flex-wrap:wrap;align-items:center")}>
{(V.tipBtns).map((t, tI) => (<React.Fragment key={tI}><button style={t.style} onClick={t.pick}>{t.label}</button></React.Fragment>))}
{(V.showTipCustom) && (<><input value={V.tipCustom} onChange={V.setTipCustom} placeholder="Monto MXN" inputMode="decimal" style={css("width:110px;padding:8px 10px;border:1px solid #e2e0d6;border-radius:8px;background:#f0eee6;font-size:13px;outline:none")} /></>)}
</div>
</div>
<div style={css("display:flex;flex-direction:column;gap:10px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Pago</div>
{(V.pays).map((p, pI) => (<React.Fragment key={pI}>
<div style={css("display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px solid #e2e0d6;border-radius:10px;padding:10px 12px;background:#f0eee6")}>
<div style={css("display:flex;gap:5px")}>
{(p.methods).map((m, mI) => (<React.Fragment key={mI}><button style={m.style} onClick={m.pick}>{m.label}</button></React.Fragment>))}
</div>
<input value={p.amount} onChange={p.setAmount} inputMode="decimal" style={css("width:100px;padding:8px 10px;border:1px solid #e2e0d6;border-radius:8px;background:#faf9f5;font-size:13.5px;outline:none;margin-left:auto;text-align:right")} />
<button onClick={p.fillRest} style={css("border:none;background:transparent;color:#836953;font-size:12px;cursor:pointer")}>restante</button>
{(p.canRemove) && (<><button onClick={p.remove} style={css("border:none;background:transparent;color:#6b6a63;font-size:15px;cursor:pointer;line-height:1")}>×</button></>)}
</div>
</React.Fragment>))}
<button onClick={V.addPay} style={css("border:none;background:transparent;color:#836953;font-size:12.5px;cursor:pointer;text-align:left;padding:0")}>+ Dividir en otro método</button>
</div>
<div style={css("display:flex;gap:18px;font-size:13px;color:#6b6a63;flex-wrap:wrap")}>
<span>Pagado <span style={css("color:#141413;font-weight:500")}>{V.paid}</span></span>
<span>Restante <span style={css("color:#141413;font-weight:500")}>{V.remaining}</span></span>
{(V.hasChange) && (<><span>Cambio <span style={css("color:#836953;font-weight:500")}>{V.change}</span></span></>)}
</div>
{(V.hasPayMsg) && (<><div style={css("font-size:12.5px;color:#836953;background:#f6e5df;border-radius:8px;padding:8px 12px")}>{V.payMsg}</div></>)}
<div style={css("display:flex;gap:8px")}>
<button onClick={V.ckBack} style={css("padding:11px 18px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:9px;font-size:13.5px;cursor:pointer;color:#141413")}>Atrás</button>
<button onClick={V.ckNext} style={V.payNextStyle}>Continuar</button>
</div>
</>)}
{(V.ckConfirm) && (<>
<div style={css("font-size:15px;font-weight:500")}>Confirmación final</div>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
{(V.confirmPays).map((cp, cpI) => (<React.Fragment key={cpI}>
<div style={css("display:flex;justify-content:space-between;font-size:13.5px;border-bottom:1px solid #e2e0d6;padding:7px 0")}><span>{cp.method}</span><span style={css("font-weight:500")}>{cp.amount}</span></div>
</React.Fragment>))}
<div style={css("display:flex;justify-content:space-between;font-size:13px;color:#6b6a63;padding:6px 0")}><span>Propina</span><span>{V.ckTip}</span></div>
{(V.hasChange) && (<><div style={css("display:flex;justify-content:space-between;font-size:13px;color:#836953;padding:2px 0")}><span>Cambio a entregar</span><span>{V.change}</span></div></>)}
</div>
<div style={css("font-size:12.5px;color:#6b6a63")}>Al confirmar se registrará el pago y la cuenta se cerrará. Esta acción queda en el historial de auditoría.</div>
<div style={css("display:flex;gap:8px")}>
<button onClick={V.ckBack} style={css("padding:11px 18px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:9px;font-size:13.5px;cursor:pointer;color:#141413")}>Atrás</button>
<button onClick={V.ckRegister} style={css("padding:12px 22px;background:#836953;color:#faf9f5;border:none;border-radius:9px;font-size:14px;font-weight:500;cursor:pointer")}>Registrar pago {V.ckTotal}</button>
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
{(V.hasResultChange) && (<><div style={css("font-size:13.5px;color:#836953")}>Entrega {V.resultChange} de cambio</div></>)}
<div style={css("font-size:12.5px;color:#6b6a63")}>{V.resultSyncNote}</div>
<div style={css("display:flex;gap:8px;margin-top:6px")}>
<button onClick={V.ckPrint} style={css("padding:11px 18px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:9px;font-size:13.5px;cursor:pointer;color:#141413")}>Imprimir ticket</button>
<button onClick={V.ckNew} style={css("padding:11px 20px;background:#836953;color:#faf9f5;border:none;border-radius:9px;font-size:13.5px;font-weight:500;cursor:pointer")}>Nueva venta</button>
</div>
</div>
</>)}
{(V.ckFail) && (<>
<div style={css("display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 0;text-align:center")}>
<span style={css("width:52px;height:52px;border-radius:50%;border:1px solid #836953;color:#836953;display:inline-flex;align-items:center;justify-content:center;font-size:24px")}>!</span>
<div style={css("font-size:17px;font-weight:500")}>No se pudo procesar el pago</div>
<div style={css("font-size:13px;color:#6b6a63;max-width:360px")}>{V.ckError}</div>
<div style={css("display:flex;gap:8px;margin-top:6px")}>
<button onClick={V.ckChangeMethod} style={css("padding:11px 18px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:9px;font-size:13.5px;cursor:pointer;color:#141413")}>Cambiar método</button>
<button onClick={V.ckRetry} style={css("padding:11px 20px;background:#836953;color:#faf9f5;border:none;border-radius:9px;font-size:13.5px;font-weight:500;cursor:pointer")}>Reintentar</button>
</div>
</div>
</>)}
</>)}
</div>
</div>
</div>
</>)}

{(V.mMenu) && (<>
<div style={css("padding:22px 24px 40px;display:flex;gap:18px;align-items:flex-start")}>
<div style={css("width:230px;flex:none;background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:2px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500;padding:4px 10px 10px")}>Categorías</div>
{(V.admCats).map((c, cI) => (<React.Fragment key={cI}>
<button style={c.style} onClick={c.pick}><span>{c.label}</span><span style={css("color:#6b6a63;font-size:12px")}>{c.count}</span></button>
</React.Fragment>))}
<button onClick={V.admNewCat} style={css("border:none;background:transparent;color:#836953;font-size:12.5px;cursor:pointer;text-align:left;padding:10px 10px 4px")}>+ Nueva categoría</button>
</div>
<div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:12px")}>
<div style={css("display:flex;gap:10px")}>
<input value={V.admSearch} onChange={V.setAdmSearch} placeholder="Buscar en el menú…" style={css("flex:1;padding:10px 14px;border:1px solid #e2e0d6;border-radius:9px;background:#faf9f5;font-size:13.5px;outline:none")} />
<button onClick={V.admNew} style={css("padding:10px 16px;background:#836953;color:#faf9f5;border:none;border-radius:9px;font-size:13px;font-weight:500;cursor:pointer")}>+ Nuevo producto</button>
</div>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;overflow:hidden")}>
<div style={css("display:grid;grid-template-columns:1fr 130px 90px 110px;gap:10px;padding:10px 16px;border-bottom:1px solid #e2e0d6;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#6b6a63;font-weight:500")}><span>Producto</span><span>Categoría</span><span>Precio</span><span>Estado</span></div>
{(V.admProds).map((p, pI) => (<React.Fragment key={pI}>
<button style={p.style} onClick={p.pick}><span style={css("font-weight:500;text-align:left")}>{p.name}</span><span style={css("color:#6b6a63")}>{p.catLabel}</span><span>{p.price}</span><span style={p.availStyle}>{p.availLabel}</span></button>
</React.Fragment>))}
</div>
</div>
{(V.hasAdmSel) && (<>
<div style={css("width:340px;flex:none;background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:16px;position:sticky;top:22px")}>
<div style={css("display:flex;align-items:center")}><span style={css("font-size:15px;font-weight:500;flex:1")}>Editar producto</span><button onClick={V.admClose} style={css("border:none;background:transparent;color:#6b6a63;font-size:17px;cursor:pointer;line-height:1")}>×</button></div>
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Datos generales</div>
<input value={V.fName} onChange={V.setFName} placeholder="Nombre" style={css("width:100%;padding:9px 12px;border:1px solid #e2e0d6;border-radius:8px;background:#f0eee6;font-size:13px;outline:none")} />
<select value={V.fCat} onChange={V.setFCat} style={css("width:100%;padding:9px 12px;border:1px solid #e2e0d6;border-radius:8px;background:#f0eee6;font-size:13px;outline:none")}>
{(V.catOptions).map((o, oI) => (<React.Fragment key={oI}><option value={o.id}>{o.label}</option></React.Fragment>))}
</select>
</div>
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Precio</div>
<input value={V.fPrice} onChange={V.setFPrice} inputMode="decimal" placeholder="0.00" style={css("width:130px;padding:9px 12px;border:1px solid #e2e0d6;border-radius:8px;background:#f0eee6;font-size:13px;outline:none")} />
</div>
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Disponibilidad</div>
<button onClick={V.fToggleAvail} style={V.fAvailStyle}>{V.fAvailLabel}</button>
</div>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Modificadores</div>
{(V.fMods).map((m, mI) => (<React.Fragment key={mI}>
<div style={css("display:flex;justify-content:space-between;font-size:13px;border:1px solid #e2e0d6;border-radius:8px;padding:8px 12px")}><span style={css("font-weight:500")}>{m.label}</span><span style={css("color:#6b6a63")}>{m.meta}</span></div>
</React.Fragment>))}
<button style={css("border:none;background:transparent;color:#836953;font-size:12.5px;cursor:pointer;text-align:left;padding:0")} onClick={V.admNewCat}>+ Agregar grupo de modificadores</button>
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
<button onClick={V.admSave} style={css("padding:12px;background:#836953;color:#faf9f5;border:none;border-radius:9px;font-size:13.5px;font-weight:500;cursor:pointer")}>Guardar cambios</button>
</div>
</>)}
</div>
</>)}

{(V.mInv) && (<>
<div style={css("padding:22px 24px 40px;display:flex;flex-direction:column;gap:16px")}>
<div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
<h1 style={css("font-size:19px;font-weight:500;margin:0")}>Inventario</h1>
<div style={css("display:flex;gap:6px;margin-left:8px")}>
{(V.invTabs).map((t, tI) => (<React.Fragment key={tI}><button style={t.style} onClick={t.pick}>{t.label}</button></React.Fragment>))}
</div>
<div style={css("margin-left:auto;display:flex;gap:8px")}>
<button onClick={V.regEntrada} style={css("padding:9px 14px;background:#836953;color:#faf9f5;border:none;border-radius:8px;font-size:12.5px;font-weight:500;cursor:pointer")}>+ Entrada</button>
<button onClick={V.regMerma} style={css("padding:9px 14px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:8px;font-size:12.5px;cursor:pointer;color:#141413")}>Registrar merma</button>
<button onClick={V.regAjuste} style={css("padding:9px 14px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:8px;font-size:12.5px;cursor:pointer;color:#141413")}>Ajuste manual</button>
</div>
</div>
{(V.tStock) && (<>
<div style={css("display:flex;gap:10px")}>
<input value={V.invSearch} onChange={V.setInvSearch} placeholder="Buscar insumo o ingrediente…" style={css("flex:1;max-width:340px;padding:10px 14px;border:1px solid #e2e0d6;border-radius:9px;background:#faf9f5;font-size:13.5px;outline:none")} />
<button onClick={V.toggleLow} style={V.lowToggleStyle}>Solo stock bajo</button>
</div>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;overflow:hidden")}>
<div style={css("display:grid;grid-template-columns:1fr 150px 120px 110px 120px;gap:10px;padding:10px 16px;border-bottom:1px solid #e2e0d6;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#6b6a63;font-weight:500")}><span>Artículo</span><span>Tipo</span><span>Existencia</span><span>Mínimo</span><span>Estado</span></div>
{(V.stockEmpty) && (<><div style={css("padding:32px;text-align:center;color:#6b6a63;font-size:13px")}>Sin artículos que coincidan.</div></>)}
{(V.stock).map((s, sI) => (<React.Fragment key={sI}>
<div style={css("display:grid;grid-template-columns:1fr 150px 120px 110px 120px;gap:10px;padding:11px 16px;border-bottom:1px solid #e2e0d6;font-size:13px;align-items:center")}>
<span style={css("font-weight:500")}>{s.name}</span><span style={css("color:#6b6a63")}>{s.kind}</span><span>{s.qty}</span><span style={css("color:#6b6a63")}>{s.min}</span><span style={s.tagStyle}>{s.tagLabel}</span>
</div>
</React.Fragment>))}
</div>
</>)}
{(V.tMov) && (<>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;overflow:hidden")}>
<div style={css("display:grid;grid-template-columns:110px 1fr 90px 150px 130px 1fr;gap:10px;padding:10px 16px;border-bottom:1px solid #e2e0d6;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#6b6a63;font-weight:500")}><span>Tipo</span><span>Artículo</span><span>Cantidad</span><span>Usuario</span><span>Fecha</span><span>Motivo</span></div>
{(V.movs).map((m, mI) => (<React.Fragment key={mI}>
<div style={css("display:grid;grid-template-columns:110px 1fr 90px 150px 130px 1fr;gap:10px;padding:11px 16px;border-bottom:1px solid #e2e0d6;font-size:13px;align-items:center")}>
<span style={m.tagStyle}>{m.tipoLabel}</span><span style={css("font-weight:500")}>{m.item}</span><span>{m.qty}</span><span style={css("color:#6b6a63")}>{m.user}</span><span style={css("color:#6b6a63")}>{m.date}</span><span style={css("color:#6b6a63")}>{m.motivo}</span>
</div>
</React.Fragment>))}
</div>
</>)}
{(V.tRec) && (<>
<div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px")}>
{(V.recs).map((r, rI) => (<React.Fragment key={rI}>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:14px;font-weight:500")}>{r.product}</div>
{(r.items).map((i, iI) => (<React.Fragment key={iI}>
<div style={css("display:flex;justify-content:space-between;font-size:12.5px;border-bottom:1px solid #e2e0d6;padding:6px 0")}><span>{i.name}</span><span style={css("color:#6b6a63")}>{i.use} · {i.conv}</span></div>
</React.Fragment>))}
<div style={css("font-size:11.5px;color:#6b6a63")}>Descuento por unidad vendida</div>
</div>
</React.Fragment>))}
</div>
</>)}
</div>
</>)}

{(V.mRep) && (<>
<div style={css("padding:22px 24px 48px;display:flex;flex-direction:column;gap:16px")}>
<div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
<h1 style={css("font-size:19px;font-weight:500;margin:0")}>Reportes</h1>
<div style={css("display:flex;gap:6px;margin-left:8px")}>
{(V.ranges).map((r, rI) => (<React.Fragment key={rI}><button style={r.style} onClick={r.pick}>{r.label}</button></React.Fragment>))}
</div>
<button onClick={V.exportar} style={css("margin-left:auto;padding:9px 14px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:8px;font-size:12.5px;cursor:pointer;color:#141413")}>Exportar a Excel</button>
</div>
<div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px")}>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:16px")}><div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Ventas</div><div style={css("font-family:Georgia,serif;font-style:italic;font-size:30px;margin-top:8px")}>{V.repVentas}</div></div>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:16px")}><div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Tickets</div><div style={css("font-size:26px;font-weight:500;margin-top:8px")}>{V.repTickets}</div></div>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:16px")}><div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Propinas</div><div style={css("font-size:26px;font-weight:500;margin-top:8px")}>{V.repProps}</div></div>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:16px")}><div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Cancelaciones</div><div style={css("font-size:26px;font-weight:500;margin-top:8px")}>{V.repCanc}</div></div>
</div>
<div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px")}>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Por forma de pago</div>
{(V.methods).map((m, mI) => (<React.Fragment key={mI}>
<div style={css("display:flex;flex-direction:column;gap:4px")}>
<div style={css("display:flex;justify-content:space-between;font-size:13px")}><span>{m.label}</span><span style={css("font-weight:500")}>{m.amount}</span></div>
<div style={css("height:5px;background:#f0eee6;border-radius:999px")}><div style={m.barStyle}></div></div>
</div>
</React.Fragment>))}
</div>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Productos vendidos</div>
{(V.topProds).map((t, tI) => (<React.Fragment key={tI}>
<div style={css("display:flex;justify-content:space-between;font-size:13px;border-bottom:1px solid #e2e0d6;padding:6px 0")}><span>{t.name} <span style={css("color:#6b6a63")}>×{t.qty}</span></span><span style={css("font-weight:500")}>{t.amount}</span></div>
</React.Fragment>))}
</div>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Ventas por usuario</div>
{(V.byUser).map((u, uI) => (<React.Fragment key={uI}>
<div style={css("display:flex;justify-content:space-between;font-size:13px;border-bottom:1px solid #e2e0d6;padding:6px 0")}><span>{u.name} <span style={css("color:#6b6a63")}>{u.meta}</span></span><span style={css("font-weight:500")}>{u.amount}</span></div>
</React.Fragment>))}
</div>
</div>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;overflow:hidden")}>
<div style={css("display:grid;grid-template-columns:90px 130px 110px 150px 100px 120px 130px;gap:10px;padding:10px 16px;border-bottom:1px solid #e2e0d6;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#6b6a63;font-weight:500")}><span>Folio</span><span>Fecha</span><span>Tipo</span><span>Usuario</span><span>Total</span><span>Estado</span><span>Sincronización</span></div>
{(V.repSales).map((s, sI) => (<React.Fragment key={sI}>
<Hover tag="button" onClick={s.open} base={css("display:grid;grid-template-columns:90px 130px 110px 150px 100px 120px 130px;gap:10px;padding:11px 16px;border:none;border-bottom:1px solid #e2e0d6;font-size:13px;align-items:center;background:transparent;cursor:pointer;width:100%;text-align:left;color:#141413")} hover={css("background:#f0eee6")}>
<span style={css("color:#836953;font-weight:500")}>{s.folio}</span><span style={css("color:#6b6a63")}>{s.fecha}</span><span>{s.tipo}</span><span style={css("color:#6b6a63")}>{s.user}</span><span style={css("font-weight:500")}>{s.total}</span><span style={s.statusStyle}>{s.statusLabel}</span><span style={css("color:#6b6a63")}>{s.syncLabel}</span>
</Hover>
</React.Fragment>))}
</div>
</div>
</>)}

{(V.mCfg) && (<>
<div style={css("padding:22px 24px 48px;display:flex;flex-direction:column;gap:16px")}>
<div style={css("display:flex;align-items:center;gap:12px")}>
<h1 style={css("font-size:19px;font-weight:500;margin:0")}>Usuarios y configuración</h1>
<div style={css("display:flex;gap:6px;margin-left:8px")}>
{(V.cfgTabs).map((t, tI) => (<React.Fragment key={tI}><button style={t.style} onClick={t.pick}>{t.label}</button></React.Fragment>))}
</div>
</div>
{(V.cUsers) && (<>
<div style={css("display:flex;gap:18px;align-items:flex-start")}>
<div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:10px")}>
<button onClick={V.newUser} style={css("align-self:flex-start;padding:9px 14px;background:#836953;color:#faf9f5;border:none;border-radius:8px;font-size:12.5px;font-weight:500;cursor:pointer")}>+ Nuevo usuario</button>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;overflow:hidden")}>
<div style={css("display:grid;grid-template-columns:1fr 160px 80px 110px 90px;gap:10px;padding:10px 16px;border-bottom:1px solid #e2e0d6;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#6b6a63;font-weight:500")}><span>Nombre</span><span>Rol</span><span>PIN</span><span>Acceso</span><span></span></div>
{(V.usersRows).map((u, uI) => (<React.Fragment key={uI}>
<div style={u.style}>
<button onClick={u.pick} style={css("border:none;background:transparent;font-size:13px;font-weight:500;cursor:pointer;text-align:left;color:#141413;padding:0")}>{u.name}</button>
<span style={css("color:#6b6a63;font-size:13px")}>{u.roleLabel}</span>
<span style={css("color:#6b6a63;font-size:13px")}>••••</span>
<span style={u.activeStyle}>{u.activeLabel}</span>
<button onClick={u.toggleActive} style={css("border:none;background:transparent;color:#836953;font-size:12px;cursor:pointer;text-align:right;padding:0")}>{u.toggleLabel}</button>
</div>
</React.Fragment>))}
</div>
</div>
{(V.hasSelUser) && (<>
<div style={css("width:340px;flex:none;background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:16px;position:sticky;top:22px")}>
<div style={css("display:flex;align-items:center")}><span style={css("font-size:15px;font-weight:500;flex:1")}>Editar usuario</span><button onClick={V.suClose} style={css("border:none;background:transparent;color:#6b6a63;font-size:17px;cursor:pointer;line-height:1")}>×</button></div>
<input value={V.suName} onChange={V.setSuName} placeholder="Nombre completo" style={css("width:100%;padding:9px 12px;border:1px solid #e2e0d6;border-radius:8px;background:#f0eee6;font-size:13px;outline:none")} />
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Rol</div>
<div style={css("display:flex;flex-wrap:wrap;gap:6px")}>
{(V.suRoles).map((r, rI) => (<React.Fragment key={rI}><button style={r.style} onClick={r.pick}>{r.label}</button></React.Fragment>))}
</div>
</div>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Permisos</div>
{(V.suPerms).map((p, pI) => (<React.Fragment key={pI}>
<button onClick={p.toggle} style={p.style}><span>{p.label}</span><span style={css("font-weight:500")}>{p.mark}</span></button>
</React.Fragment>))}
</div>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Acciones auditables</div>
{(V.suAudit).map((a, aI) => (<React.Fragment key={aI}>
<div style={css("display:flex;gap:10px;font-size:12.5px;padding:5px 0;border-bottom:1px solid #e2e0d6")}><span style={css("color:#6b6a63;flex:none;width:92px")}>{a.t}</span><span>{a.e}</span></div>
</React.Fragment>))}
</div>
<button onClick={V.suSave} style={css("padding:12px;background:#836953;color:#faf9f5;border:none;border-radius:9px;font-size:13.5px;font-weight:500;cursor:pointer")}>Guardar usuario</button>
</div>
</>)}
</div>
</>)}
{(V.cCfg) && (<>
<div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px")}>
{(V.cfgCards).map((c, cI) => (<React.Fragment key={cI}>
<div style={css("background:#faf9f5;border:1px solid #e2e0d6;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px")}>
<div style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>{c.title}</div>
{(c.rows).map((r, rI) => (<React.Fragment key={rI}>
<div style={css("display:flex;justify-content:space-between;align-items:center;font-size:13px;border-bottom:1px solid #e2e0d6;padding:7px 0;gap:12px")}>
<span>{r.label}</span>
{(r.hasToggle) && (<>
<button onClick={r.toggle} style={r.toggStyle}><span style={r.knobStyle}></span></button>
</>)}
{(r.hasValue) && (<><span style={css("color:#6b6a63;text-align:right")}>{r.value}</span></>)}
</div>
</React.Fragment>))}
{(c.hasAction) && (<>
<button onClick={c.action} style={css("align-self:flex-start;padding:8px 13px;background:#f6e5df;color:#836953;border:none;border-radius:8px;font-size:12.5px;font-weight:500;cursor:pointer")}>{c.actionLabel}</button>
</>)}
</div>
</React.Fragment>))}
</div>
</>)}
</div>
</>)}
</main>
</div>

{(V.ed) && (<>
<div style={css("position:fixed;inset:0;background:rgba(20,20,19,.38);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px")} onClick={V.edCancel}>
<div style={css("width:560px;max-width:100%;max-height:84vh;overflow-y:auto;background:#faf9f5;border-radius:14px;padding:22px;display:flex;flex-direction:column;gap:16px;animation:rise .25s ease")} onClick={V.stop}>
<div style={css("display:flex;align-items:baseline;gap:10px")}>
<span style={css("font-size:17px;font-weight:500;flex:1")}>{V.edName}</span>
<span style={css("font-size:14px;color:#6b6a63")}>{V.edPrice}</span>
</div>
<div style={css("display:flex;align-items:center;gap:12px")}>
<span style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Cantidad</span>
<div style={css("display:flex;align-items:center;gap:4px")}>
<button onClick={V.edDec} style={css("width:32px;height:32px;border:1px solid #e2e0d6;background:#faf9f5;border-radius:8px;cursor:pointer;font-size:15px;color:#141413")}>−</button>
<span style={css("min-width:32px;text-align:center;font-size:15px;font-weight:500")}>{V.edQty}</span>
<button onClick={V.edInc} style={css("width:32px;height:32px;border:1px solid #e2e0d6;background:#faf9f5;border-radius:8px;cursor:pointer;font-size:15px;color:#141413")}>+</button>
</div>
</div>
{(V.edGroups).map((g, gI) => (<React.Fragment key={gI}>
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<div style={css("display:flex;gap:8px;align-items:baseline")}><span style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>{g.label}</span><span style={css("font-size:11.5px;color:#a8a69c")}>{g.hint}</span></div>
<div style={css("display:flex;flex-wrap:wrap;gap:6px")}>
{(g.options).map((o, oI) => (<React.Fragment key={oI}>
          <button style={o.style} disabled={o.disabled} onClick={o.toggle}>{o.text}</button>
</React.Fragment>))}
</div>
</div>
</React.Fragment>))}
<div style={css("display:flex;flex-direction:column;gap:8px")}>
<span style={css("font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6a63;font-weight:500")}>Notas de preparación</span>
<textarea value={V.edNotes} onChange={V.edSetNotes} placeholder="P. ej. sin azúcar, extra caliente…" rows={V.two} style={css("width:100%;padding:10px 12px;border:1px solid #e2e0d6;border-radius:8px;background:#f0eee6;font-size:13px;outline:none;resize:vertical;min-height:56px")}></textarea>
</div>
<div style={css("display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #e2e0d6;padding-top:14px")}>
<button onClick={V.edCancel} style={css("padding:11px 18px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:9px;font-size:13.5px;cursor:pointer;color:#141413")}>Cancelar</button>
<button onClick={V.edConfirm} style={css("padding:11px 22px;background:#836953;color:#faf9f5;border:none;border-radius:9px;font-size:13.5px;font-weight:500;cursor:pointer")}>{V.edConfirmLabel}</button>
</div>
</div>
</div>
</>)}

{(V.hasRepSel) && (<>
<div style={css("position:fixed;inset:0;background:rgba(20,20,19,.38);z-index:210;display:flex;align-items:center;justify-content:center;padding:24px")} onClick={V.closeDetail}>
<div style={css("width:520px;max-width:100%;max-height:84vh;overflow-y:auto;background:#faf9f5;border-radius:14px;padding:22px;display:flex;flex-direction:column;gap:14px;animation:rise .25s ease")} onClick={V.stop}>
<div style={css("display:flex;align-items:center;gap:10px")}>
<span style={css("font-size:17px;font-weight:500")}>{V.dFolio}</span>
<span style={V.dStatusStyle}>{V.dStatusLabel}</span>
<button onClick={V.closeDetail} style={css("margin-left:auto;border:none;background:transparent;color:#6b6a63;font-size:17px;cursor:pointer;line-height:1")}>×</button>
</div>
<div style={css("font-size:12.5px;color:#6b6a63;line-height:1.6")}>{V.dMeta}</div>
{(V.dHasMotivo) && (<><div style={css("font-size:12.5px;color:#836953;background:#f6e5df;border-radius:8px;padding:8px 12px")}>Motivo: {V.dMotivo}</div></>)}
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
<div style={css("display:flex;justify-content:space-between;font-size:13px")}><span style={css("color:#6b6a63")}>{p.method}</span><span>{p.amount}</span></div>
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
</div>
</div>
</>)}

{(V.dlg) && (<>
<div style={css("position:fixed;inset:0;background:rgba(20,20,19,.38);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px")}>
<div style={css("width:420px;max-width:100%;background:#faf9f5;border-radius:14px;padding:22px;display:flex;flex-direction:column;gap:14px;animation:rise .25s ease")}>
<div style={css("font-size:16px;font-weight:500")}>{V.dlgTitle}</div>
<div style={css("font-size:13px;color:#6b6a63;line-height:1.55")}>{V.dlgBody}</div>
{(V.dlgFields).map((f, fI) => (<React.Fragment key={fI}>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
<span style={css("font-size:11px;color:#6b6a63")}>{f.label}</span>
<input value={f.value} onChange={f.set} placeholder={f.ph} style={css("width:100%;padding:9px 12px;border:1px solid #e2e0d6;border-radius:8px;background:#f0eee6;font-size:13px;outline:none")} />
</div>
</React.Fragment>))}
{(V.dlgNeedReason) && (<>
<div style={css("display:flex;flex-direction:column;gap:6px")}>
<span style={css("font-size:11px;color:#6b6a63")}>Motivo (obligatorio)</span>
<textarea value={V.dlgReason} onChange={V.setDlgReason} placeholder="Describe el motivo…" style={css("width:100%;padding:9px 12px;border:1px solid #e2e0d6;border-radius:8px;background:#f0eee6;font-size:13px;outline:none;resize:vertical;min-height:52px")}></textarea>
</div>
</>)}
{(V.hasDlgErr) && (<><div style={css("font-size:12.5px;color:#836953")}>{V.dlgErr}</div></>)}
<div style={css("display:flex;gap:8px;justify-content:flex-end")}>
<button onClick={V.dlgClose} style={css("padding:10px 16px;background:#faf9f5;border:1px solid #e2e0d6;border-radius:9px;font-size:13px;cursor:pointer;color:#141413")}>{V.dlgCloseLabel}</button>
{(V.dlgHasConfirm) && (<>
<button onClick={V.dlgConfirm} style={V.dlgConfirmStyle}>{V.dlgConfirmLabel}</button>
</>)}
</div>
</div>
</div>
</>)}

<div style={css("position:fixed;right:20px;bottom:20px;z-index:400;display:flex;flex-direction:column;gap:8px;align-items:flex-end")}>
{(V.toasts).map((t, tI) => (<React.Fragment key={tI}>
<div style={css("background:#141413;color:#faf9f5;border-radius:10px;padding:11px 16px;font-size:13px;display:flex;align-items:center;gap:9px;animation:rise .25s ease;max-width:380px")}>
<span style={t.dotStyle}></span><span>{t.msg}</span>
</div>
</React.Fragment>))}
</div>
</>)}
      </>
    );
  }
}
