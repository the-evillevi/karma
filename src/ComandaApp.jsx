import React from 'react';
import { css } from './css.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { activeKitchenTickets, advanceKitchenTicket } from './domain/kitchen-queue.js';

// Ported verbatim from design/Comanda.dc.html. The original `class Component
// extends DCLogic` becomes a real React.Component (identical setState /
// lifecycle / props semantics); renderVals() is unchanged and render() binds
// its output to JSX converted from the <x-dc> template.
export default class ComandaApp extends React.Component {
  constructor(props) {
    super(props);
    this.state = { tickets: this.load(), tab: 'todas', online: true };
  }
  load() {
    try {
      const v = JSON.parse(localStorage.getItem('karma-pos-v1')) || {};
      this._online = v.online !== false;
      if (Array.isArray(v.kitchenTickets)) return v.kitchenTickets;
      if (Array.isArray(v.open)) return v.open;
    } catch (e) {}
    this._online = true;
    return (window.KARMA ? window.KARMA.seedOrders : []).map(o => ({ ...o }));
  }
  save(tickets) {
    try {
      const v = JSON.parse(localStorage.getItem('karma-pos-v1')) || {};
      v.kitchenTickets = tickets;
      localStorage.setItem('karma-pos-v1', JSON.stringify(v));
    } catch (e) {}
  }
  componentDidMount() {
    this._l = e => { if (e.key === 'karma-pos-v1') this.setState({ tickets: this.load(), online: this._online }); };
    window.addEventListener('storage', this._l);
    this._p = setInterval(() => this.setState({ tickets: this.load(), online: this._online }), 4000);
    this.setState({ online: this._online });
  }
  componentWillUnmount() { window.removeEventListener('storage', this._l); clearInterval(this._p); }
  renderVals() {
    const s = this.state;
    const acc = '#836953', tint = '#f6e5df', paper = '#faf9f5', ink = '#141413';
    const tag = (b, c) => ({ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 999, background: b, color: c, whiteSpace: 'nowrap' });
    const prepTags = { 'en-cola': ['En cola', 'outline'], preparando: ['Preparando', 'pending'], listo: ['Listo', 'success'], entregado: ['Entregado', 'outline'] };
    const typeLabel = t => ({ local: 'En local', mesa: 'Mesa', llevar: 'Para llevar', domicilio: 'Domicilio', recoger: 'Recoger' })[t] || t;
    const next = { 'en-cola': ['preparando', 'Empezar preparación'], preparando: ['listo', 'Marcar listo'], listo: ['entregado', 'Marcar entregado'] };
    const order = { 'en-cola': 0, preparando: 1, listo: 2, entregado: 3 };
    const visible = activeKitchenTickets(s.tickets);
    const counts = { todas: visible.length, 'en-cola': 0, preparando: 0, listo: 0 };
    visible.forEach(o => { if (counts[o.prep] != null) counts[o.prep] += 1; });
    const list = (s.tab === 'todas' ? visible : visible.filter(o => o.prep === s.tab)).slice().sort((a, b) => (order[a.prep] || 0) - (order[b.prep] || 0));
    return {
      connLabel: s.online ? 'En línea' : 'Sin conexión',
      connStyle: { marginLeft: 'auto', ...tag(s.online ? tint : ink, s.online ? acc : paper) },
      tabs: [['todas', 'Todas'], ['en-cola', 'En cola'], ['preparando', 'Preparando'], ['listo', 'Listas']].map(([id, label]) => ({
        label, hasCount: counts[id] > 0, count: counts[id],
        active: s.tab === id,
        pick: () => this.setState({ tab: id })
      })),
      empty: list.length === 0,
      cards: list.map(o => {
        const pt = prepTags[o.prep] || prepTags['en-cola'];
        const nx = next[o.prep];
        return {
          folio: o.folio, time: o.time,
          prepLabel: pt[0], prepVariant: pt[1],
          meta: typeLabel(o.type) + ' · ' + o.ref + ' · ' + o.user,
          items: o.items.map(i => ({ qty: i.qty, name: i.name, mods: i.modsText, hasMods: !!i.modsText, notes: i.notes, hasNotes: !!i.notes })),
          hasAction: !!nx,
          actionLabel: nx ? nx[1] : '',
          actionVariant: o.prep === 'preparando' ? 'default' : 'outline',
          advance: () => {
            const tickets = advanceKitchenTicket(this.state.tickets, o.folio, o.prep);
            this.setState({ tickets });
            this.save(tickets);
          }
        };
      }),
      footNote: visible.length + ' comandas activas — se actualiza sola desde la caja'
    };
  }
  render() {
    const V = this.renderVals();
    return (
      <div style={css('min-height:var(--karma-viewport-height,100vh);display:flex;justify-content:center;padding:24px 12px')}>
        <div style={css('width:390px;max-width:100%;background:#f0eee6;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;min-height:760px')}>
          <div style={css('background:#faf9f5;border-bottom:1px solid #e2e0d6;padding:18px 18px 14px;display:flex;flex-direction:column;gap:12px;position:sticky;top:0;z-index:10')}>
            <div style={css('display:flex;align-items:baseline;gap:10px')}>
              <span style={css('font-family:Georgia,serif;font-style:italic;font-size:23px;line-height:1;color:#141413')}>Karma</span>
              <span style={css('font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6b6a63;font-weight:500')}>Comanda · Cocina y barra</span>
              <span style={V.connStyle}>{V.connLabel}</span>
            </div>
            <div style={css('display:flex;gap:6px')}>
              {V.tabs.map((t, i) => (
                <Button key={i} size="sm" variant={t.active ? 'default' : 'outline'} className="rounded-[var(--radius-pill)]" aria-pressed={t.active} onClick={t.pick}>{t.label}{t.hasCount && <> · {t.count}</>}</Button>
              ))}
            </div>
          </div>
          <div style={css('flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px')}>
            {V.empty && (
              <div style={css('padding:56px 20px;text-align:center;color:#6b6a63;font-size:13.5px;border:1px dashed #e2e0d6;border-radius:14px')}>Sin comandas en este estado.<br/>Las órdenes nuevas del punto de venta aparecerán aquí.</div>
            )}
            {V.cards.map((c, i) => (
              <Card key={i} className="gap-3 rounded-[var(--radius-card-large)] p-4" style={{ animation: 'rise .25s ease' }}>
                <div style={css('display:flex;align-items:center;gap:8px')}>
                  <span style={css('font-size:15px;font-weight:500;color:#141413')}>{c.folio}</span>
                  <Badge variant={c.prepVariant}>{c.prepLabel}</Badge>
                  <span style={css('margin-left:auto;font-size:12px;color:#6b6a63')}>{c.time}</span>
                </div>
                <div style={css('font-size:12px;color:#6b6a63')}>{c.meta}</div>
                <div style={css('display:flex;flex-direction:column')}>
                  {c.items.map((it, j) => (
                    <div key={j} style={css('display:flex;gap:10px;padding:9px 0;border-bottom:1px solid #e2e0d6;align-items:flex-start')}>
                      <span style={css('font-size:15px;font-weight:500;color:#141413;flex:none;min-width:28px')}>{it.qty}×</span>
                      <div style={css('flex:1;min-width:0')}>
                        <div style={css('font-size:14.5px;font-weight:500;color:#141413;line-height:1.3')}>{it.name}</div>
                        {it.hasMods && <div style={css('font-size:12.5px;color:#6b6a63;margin-top:2px')}>{it.mods}</div>}
                        {it.hasNotes && <div style={css('font-size:12.5px;color:#836953;margin-top:2px;font-weight:500')}>“{it.notes}”</div>}
                      </div>
                    </div>
                  ))}
                </div>
                {c.hasAction && (
                  <Button className="w-full" variant={c.actionVariant} onClick={c.advance}>{c.actionLabel}</Button>
                )}
              </Card>
            ))}
          </div>
          <div style={css('background:#faf9f5;border-top:1px solid #e2e0d6;padding:12px 18px;display:flex;align-items:center;gap:10px')}>
            <span style={css('font-size:12px;color:#6b6a63;flex:1')}>{V.footNote}</span>
            <a href={import.meta.env.BASE_URL} style={css('font-size:12.5px;font-weight:500')}>Ir a la caja →</a>
          </div>
        </div>
      </div>
    );
  }
}
