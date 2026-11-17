import { factories } from '@strapi/strapi';
import { isDate, isOrderReconciliation, isRecord, isText, PersistenceConflict } from '../../../utils/checkout-persistence';
import type { EventSettlement } from '../services/webhook-event';

const isToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

const isSettlement = (value: unknown): value is EventSettlement => {
  if (!isRecord(value) || !isText(value.documentId) || !isToken(value.processingToken)
    || !['PENDING', 'PROCESSED', 'FAILED', 'DISCARDED'].includes(String(value.processingStatus))) return false;
  if (value.processingStatus === 'PENDING' && (!isDate(value.nextRetryAt) || Date.parse(value.nextRetryAt) <= Date.now())) return false;
  if (value.reasonCode !== undefined && (typeof value.reasonCode !== 'string' || !/^[a-z_]{1,64}$/.test(value.reasonCode))) return false;
  if (value.externalReference !== undefined && !isText(value.externalReference)) return false;
  if (value.orderDocumentId !== undefined && !isText(value.orderDocumentId)) return false;
  if (value.orderUpdate !== undefined && !isOrderReconciliation(value.orderUpdate)) return false;
  if (value.processingStatus === 'PROCESSED' && !value.orderUpdate) return false;
  if (value.processingStatus === 'DISCARDED' && value.orderUpdate !== undefined) return false;
  if (value.auditDetails !== undefined && (!Array.isArray(value.auditDetails) || value.auditDetails.length > 6
    || !value.auditDetails.every((entry: unknown) => isRecord(entry)
      && ['providerOrderId', 'externalReference', 'totalAmount', 'currency', 'type', 'processingMode'].includes(String(entry.field))
      && (entry.expected === null || (typeof entry.expected === 'string' && entry.expected.length <= 255))
      && (entry.received === null || (typeof entry.received === 'string' && entry.received.length <= 255))))) return false;
  return true;
};

export default factories.createCoreController('api::webhook-event.webhook-event', ({ strapi }) => ({
  async claim(ctx) {
    const input: unknown = ctx.request.body;
    if (!isRecord(input) || !isToken(input.processingToken)
      || typeof input.maxAttempts !== 'number' || !Number.isInteger(input.maxAttempts)
      || input.maxAttempts < 1 || input.maxAttempts > 20) return ctx.badRequest('invalid_request');
    try {
      ctx.body = { data: await strapi.service('api::webhook-event.webhook-event').claim(input.processingToken, input.maxAttempts) };
    } catch {
      strapi.log.error('Webhook event claim failed');
      return ctx.serviceUnavailable('persistence_failed');
    }
  },

  async settle(ctx) {
    const input: unknown = ctx.request.body;
    if (!isSettlement(input)) return ctx.badRequest('invalid_request');
    try {
      ctx.body = { data: await strapi.service('api::webhook-event.webhook-event').settle(input) };
    } catch (error) {
      if (error instanceof PersistenceConflict) return ctx.conflict(error.message);
      strapi.log.error('Webhook event settlement failed');
      return ctx.serviceUnavailable('persistence_failed');
    }
  },
}));
