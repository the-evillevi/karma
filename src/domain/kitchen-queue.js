import { canTransitionPreparation, PREPARATION_STATUS } from './order-domain.js';

const domainByLegacyStatus = Object.freeze({
  'en-cola': PREPARATION_STATUS.QUEUED,
  preparando: PREPARATION_STATUS.PREPARING,
  listo: PREPARATION_STATUS.READY,
  entregado: PREPARATION_STATUS.SERVED,
  cancelada: PREPARATION_STATUS.CANCELLED,
});

const legacyByDomainStatus = Object.freeze(Object.fromEntries(
  Object.entries(domainByLegacyStatus).map(([legacy, domain]) => [domain, legacy]),
));

const nextDomainStatus = Object.freeze({
  [PREPARATION_STATUS.QUEUED]: PREPARATION_STATUS.PREPARING,
  [PREPARATION_STATUS.PREPARING]: PREPARATION_STATUS.READY,
  [PREPARATION_STATUS.READY]: PREPARATION_STATUS.SERVED,
});

/** Create or refresh the kitchen projection without resetting its lifecycle or origin. */
export function upsertKitchenTicket(tickets, candidate) {
  if (!Array.isArray(tickets)) throw new TypeError('kitchen tickets must be an array');
  if (!candidate || typeof candidate.folio !== 'string' || !candidate.folio.trim()) throw new TypeError('ticket folio is required');
  const existing = tickets.find((ticket) => ticket.folio === candidate.folio);
  const ticket = existing
    ? {
      ...existing,
      ...candidate,
      prep: existing.prep || candidate.prep || 'en-cola',
      time: existing.time || candidate.time,
      user: existing.user || candidate.user,
      ...(existing.cancelledAt ? { cancelledAt: existing.cancelledAt, cancelledBy: existing.cancelledBy } : {}),
    }
    : { ...candidate, prep: candidate.prep || 'en-cola' };
  return [ticket, ...tickets.filter((item) => item.folio !== candidate.folio)];
}

/** Advance one ticket only from the status the rendered action was based on. */
export function advanceKitchenTicket(tickets, folio, expectedLegacyStatus) {
  if (!Array.isArray(tickets)) throw new TypeError('kitchen tickets must be an array');
  const current = tickets.find((ticket) => ticket.folio === folio);
  if (!current || current.prep !== expectedLegacyStatus) return tickets.slice();
  const domainStatus = domainByLegacyStatus[current.prep];
  const next = nextDomainStatus[domainStatus];
  if (!next || !canTransitionPreparation(domainStatus, next)) return tickets.slice();
  const nextLegacyStatus = legacyByDomainStatus[next];
  return tickets.map((ticket) => ticket.folio === folio ? { ...ticket, prep: nextLegacyStatus } : ticket);
}

/** Mark an active kitchen ticket cancelled after the POS authorization/reason flow succeeds. */
export function cancelKitchenTicket(tickets, folio, actor, occurredAt, reason) {
  if (!Array.isArray(tickets)) throw new TypeError('kitchen tickets must be an array');
  if (typeof actor !== 'string' || !actor.trim()) throw new TypeError('cancellation actor is required');
  if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) throw new TypeError('cancellation time must be valid');
  if (typeof reason !== 'string' || !reason.trim()) throw new TypeError('cancellation reason is required');
  return tickets.map((ticket) => ticket.folio === folio && !['entregado', 'cancelada'].includes(ticket.prep)
    ? {
      ...ticket,
      prep: 'cancelada',
      cancellationReason: reason.trim(),
      cancelledBy: actor.trim(),
      cancelledAt: occurredAt,
      audit: [...(Array.isArray(ticket.audit) ? ticket.audit : []), [occurredAt, `Cancelada · ${reason.trim()}`, actor.trim()]],
    }
    : ticket);
}

export function activeKitchenTickets(tickets) {
  return (Array.isArray(tickets) ? tickets : []).filter((ticket) => !['entregado', 'cancelada'].includes(ticket.prep));
}
