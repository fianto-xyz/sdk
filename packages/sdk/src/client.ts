import { resolveConfig, type ClientOptions } from './core/config.js';
import { Transport } from './core/transport.js';
import { ApplicationResource } from './resources/application.js';
import { CheckoutSessions } from './resources/checkout-sessions.js';
import { Events } from './resources/events.js';
import { Orders } from './resources/orders.js';
import { Payments } from './resources/payments.js';
import { Prices } from './resources/prices.js';
import { Products } from './resources/products.js';
import { Subscriptions } from './resources/subscriptions.js';
import { WebhookEndpoint } from './resources/webhook-endpoint.js';

/** The fianto API client. Server-side only: it holds your app secret. */
export class Fianto {
  readonly application: ApplicationResource;
  readonly checkoutSessions: CheckoutSessions;
  readonly orders: Orders;
  readonly payments: Payments;
  readonly subscriptions: Subscriptions;
  readonly products: Products;
  readonly prices: Prices;
  readonly events: Events;
  readonly webhookEndpoint: WebhookEndpoint;

  constructor(options: ClientOptions = {}) {
    const transport = new Transport(resolveConfig(options));
    this.application = new ApplicationResource(transport);
    this.checkoutSessions = new CheckoutSessions(transport);
    this.orders = new Orders(transport);
    this.payments = new Payments(transport);
    this.subscriptions = new Subscriptions(transport);
    this.products = new Products(transport);
    this.prices = new Prices(transport);
    this.events = new Events(transport);
    this.webhookEndpoint = new WebhookEndpoint(transport);
  }
}
