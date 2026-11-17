export default {
  routes: [{
    method: 'POST',
    path: '/orders/:documentId/reconcile',
    handler: 'order.reconcile',
    config: {
      auth: { strategies: ['content-api-token'], scope: ['api::order.order.reconcile'] },
    },
  }],
};
