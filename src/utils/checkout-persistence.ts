import type { Core } from '@strapi/strapi';
import orderSchema from '../api/order/content-types/order/schema.json';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 255;

export const isDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export class PersistenceConflict extends Error {}

export interface OrderReconciliation {
  documentId: string;
  expected: {
    updatedAt: string;
    paymentStatus: string;
    orderStatus: string;
    providerOrderId: string | null;
  };
  data: {
    providerOrderId: string;
    providerStatus: string;
    providerStatusDetail: string | null;
    checkoutUrl?: string;
    paymentStatus?: string;
    orderStatus?: string;
  };
}

export const isOrderReconciliation = (value: unknown): value is OrderReconciliation => {
  if (!isRecord(value) || !isText(value.documentId)
    || !isRecord(value.expected) || !isRecord(value.data)) return false;
  const { expected, data } = value;
  const payments = orderSchema.attributes.paymentStatus.enum;
  const orders = orderSchema.attributes.orderStatus.enum;
  return isDate(expected.updatedAt)
    && typeof expected.paymentStatus === 'string' && payments.includes(expected.paymentStatus)
    && typeof expected.orderStatus === 'string' && orders.includes(expected.orderStatus)
    && (expected.providerOrderId === null || typeof expected.providerOrderId === 'string')
    && isText(data.providerOrderId) && isText(data.providerStatus)
    && (data.providerStatusDetail === null || isText(data.providerStatusDetail))
    && (data.checkoutUrl === undefined || isText(data.checkoutUrl))
    && (data.paymentStatus === undefined || (typeof data.paymentStatus === 'string' && payments.includes(data.paymentStatus)))
    && (data.orderStatus === undefined || (typeof data.orderStatus === 'string' && orders.includes(data.orderStatus)));
};

/** Storage-only compare-and-swap. The caller in Next.js decides the payment transition. */
export const reconcileOrder = async (strapi: Core.Strapi, input: OrderReconciliation): Promise<number> => {
  const { expected, data } = input;
  const { count } = await strapi.db.query('api::order.order').updateMany({
    where: {
      documentId: input.documentId,
      updatedAt: expected.updatedAt,
      paymentStatus: expected.paymentStatus,
      orderStatus: expected.orderStatus,
      providerOrderId: expected.providerOrderId,
    },
    data: {
      providerOrderId: data.providerOrderId,
      providerStatus: data.providerStatus,
      providerStatusDetail: data.providerStatusDetail,
      ...(data.checkoutUrl ? { checkoutUrl: data.checkoutUrl } : {}),
      ...(data.paymentStatus ? { paymentStatus: data.paymentStatus } : {}),
      ...(data.orderStatus ? { orderStatus: data.orderStatus } : {}),
      updatedAt: new Date(),
    },
  });
  if (count !== 1) throw new PersistenceConflict('order_changed');
  const order = await strapi.db.query('api::order.order').findOne({
    where: { documentId: input.documentId }, select: ['id'],
  });
  if (!order) throw new PersistenceConflict('order_changed');
  return order.id;
};
