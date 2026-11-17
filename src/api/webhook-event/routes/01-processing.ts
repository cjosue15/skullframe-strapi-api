export default {
  routes: [
    {
      method: 'POST',
      path: '/webhook-events/claim',
      handler: 'webhook-event.claim',
      config: { auth: { strategies: ['content-api-token'], scope: ['api::webhook-event.webhook-event.claim'] } },
    },
    {
      method: 'POST',
      path: '/webhook-events/settle',
      handler: 'webhook-event.settle',
      config: { auth: { strategies: ['content-api-token'], scope: ['api::webhook-event.webhook-event.settle'] } },
    },
  ],
};
