import { factories } from '@strapi/strapi';
import { PersistenceConflict, reconcileOrder, type OrderReconciliation } from '../../../utils/checkout-persistence';

export interface EventSettlement {
  documentId: string;
  processingToken: string;
  processingStatus: 'PENDING' | 'PROCESSED' | 'FAILED' | 'DISCARDED';
  nextRetryAt?: string;
  reasonCode?: string;
  externalReference?: string;
  orderDocumentId?: string;
  auditDetails?: { field: string; expected: string | null; received: string | null }[];
  orderUpdate?: OrderReconciliation;
}

export default factories.createCoreService('api::webhook-event.webhook-event', ({ strapi }) => ({
  async claim(processingToken: string, maxAttempts: number) {
    const now = new Date();
    const eligible = {
      $or: [
        { processingStatus: 'PENDING', $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }] },
        { processingStatus: 'PROCESSING', lockedUntil: { $lte: now } },
      ],
    };
    const candidates = await strapi.db.query('api::webhook-event.webhook-event').findMany({
      where: eligible, orderBy: { createdAt: 'asc' }, limit: 10,
    });
    for (const event of candidates) {
      // An expired final attempt is claimed only to close it, without another provider call.
      const exhausted = event.attempts >= maxAttempts;
      const attempts = exhausted ? event.attempts : event.attempts + 1;
      const { count } = await strapi.db.query('api::webhook-event.webhook-event').updateMany({
        where: { $and: [eligible, { id: event.id, attempts: event.attempts }] },
        data: {
          processingStatus: 'PROCESSING', processingToken,
          lockedUntil: new Date(now.getTime() + 180_000), attempts,
          nextRetryAt: null, updatedAt: now,
        },
      });
      if (count !== 1) continue;
      return { documentId: event.documentId, providerOrderId: event.providerOrderId, attempts, exhausted };
    }
    return null;
  },

  async settle(input: EventSettlement) {
    return strapi.db.transaction(async () => {
      const now = new Date();
      // This conditional UPDATE acquires the event row lock for the whole transaction.
      const { count } = await strapi.db.query('api::webhook-event.webhook-event').updateMany({
        where: {
          documentId: input.documentId, processingStatus: 'PROCESSING',
          processingToken: input.processingToken, lockedUntil: { $gt: now },
        },
        data: {
          processingStatus: input.processingStatus,
          processingToken: null, lockedUntil: null,
          nextRetryAt: input.processingStatus === 'PENDING' ? input.nextRetryAt : null,
          processedAt: input.processingStatus === 'PROCESSED' ? now : null,
          reasonCode: input.reasonCode ?? null,
          auditDetails: input.auditDetails ?? null,
          ...(input.externalReference ? { externalReference: input.externalReference } : {}),
          updatedAt: now,
        },
      });
      if (count !== 1) throw new PersistenceConflict('lease_lost');
      let orderId: number | undefined;
      if (input.orderUpdate) orderId = await reconcileOrder(strapi, input.orderUpdate);
      else if (input.orderDocumentId) {
        const order = await strapi.db.query('api::order.order').findOne({
          where: { documentId: input.orderDocumentId }, select: ['id'],
        });
        if (!order) throw new PersistenceConflict('order_changed');
        orderId = order.id;
      }
      if (orderId !== undefined) {
        await strapi.db.query('api::webhook-event.webhook-event').update({
          where: { documentId: input.documentId }, data: { order: orderId },
        });
      }
      return { documentId: input.documentId, processingStatus: input.processingStatus };
    });
  },
}));
