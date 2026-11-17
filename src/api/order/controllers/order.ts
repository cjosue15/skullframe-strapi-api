/**
 * order controller
 */

import { factories } from '@strapi/strapi';
import { isOrderReconciliation, PersistenceConflict, reconcileOrder } from '../../../utils/checkout-persistence';

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async reconcile(ctx) {
    const input: unknown = ctx.request.body;
    if (!isOrderReconciliation(input) || input.documentId !== ctx.params.documentId) {
      return ctx.badRequest('invalid_request');
    }
    try {
      await strapi.db.transaction(async () => { await reconcileOrder(strapi, input); });
      ctx.body = { data: { documentId: input.documentId } };
    } catch (error) {
      if (error instanceof PersistenceConflict) return ctx.conflict('order_changed');
      strapi.log.error('Checkout persistence failed');
      return ctx.serviceUnavailable('persistence_failed');
    }
  },
}));
