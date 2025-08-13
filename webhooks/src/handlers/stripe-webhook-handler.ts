import { SQS } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import crypto from 'crypto';
import dbPool from '../../../common/utils/create-db-pool';
import { StripeWebhookPayload, QueuedMessage, SlackMessage, StripeCustomer, StripeSubscription, StripeInvoice, StripePaymentIntent, StripeCheckoutSession, StripeRefund, StripeSetupIntent, StripePaymentMethod } from '../types';

const sqs = new SQS({ region: process.env.AWS_REGION || 'us-east-2' });

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  console.log('=== STRIPE WEBHOOK HANDLER STARTED ===');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const requestId = crypto.randomUUID();
  console.log('Request ID:', requestId);

  try {
    const webhookId = event.pathParameters?.webhookId;
    console.log('Webhook ID:', webhookId);
    
    if (!webhookId) {
      console.log('No webhook ID - returning 400');
      return errorResponse(400, 'Webhook ID required', requestId);
    }

    const webhook = await getWebhook(webhookId);
    console.log('Webhook lookup result:', webhook);
    
    if (!webhook) {
      console.log('Webhook not found - returning 404');
      return errorResponse(404, 'Webhook not found', requestId);
    }

    console.log('Headers:', JSON.stringify(event.headers, null, 2));
    console.log('Body length:', event.body?.length || 0);

    // Stripe uses Stripe-Signature header with timestamp and signature
    if (!verifyStripeSignature(
      event.body || '',
      event.headers['stripe-signature'],
      webhook.signing_secret,
    )) {
      console.log('Stripe signature verification failed - returning 401');
      return errorResponse(401, 'Invalid signature', requestId);
    }

    console.log('Signature verification passed');

    const canProceed = await checkRateLimit(webhookId);
    if (!canProceed) {
      return errorResponse(429, 'Rate limit exceeded', requestId);
    }

    const stripePayload: StripeWebhookPayload = JSON.parse(event.body || '{}');
    console.log('Parsed Stripe payload:', JSON.stringify(stripePayload, null, 2));

    if (!isValidStripeEvent(stripePayload)) {
      console.log('Invalid Stripe event - event ignored:', stripePayload.type);
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const slackFormattedPayload = formatStripeEvent(stripePayload);
    console.log('Formatted Slack payload:', JSON.stringify(slackFormattedPayload, null, 2));
    
    if (!slackFormattedPayload) {
      console.log('No formatted payload - event ignored');
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const queueMessage: QueuedMessage = {
      webhookId,
      workspaceId: webhook.workspace_id,
      channelId: webhook.channel_id,
      payload: slackFormattedPayload,
      requestId,
      authenticatedUser: 'stripe-webhook',
    };

    console.log('Sending SQS message:', JSON.stringify(queueMessage, null, 2));
    console.log('Queue URL:', process.env.WEBHOOK_QUEUE_URL);

    const sqsResult = await sqs.sendMessage({
      QueueUrl: process.env.WEBHOOK_QUEUE_URL!,
      MessageBody: JSON.stringify(queueMessage),
      MessageGroupId: webhookId,
    });

    console.log('SQS send result:', JSON.stringify(sqsResult, null, 2));

    await updateWebhookUsage(
      webhookId,
      event.requestContext.http.sourceIp,
      event.headers['user-agent'],
    );

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success: true, request_id: requestId }),
    };
  } catch (error) {
    console.error('=== STRIPE WEBHOOK HANDLER ERROR ===');
    console.error('Error details:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Request ID:', requestId);
    return errorResponse(500, 'Internal server error', requestId);
  }
};

function isValidStripeEvent(payload: StripeWebhookPayload): boolean {
  if (!payload.type || !payload.data) {
    console.log('Missing type or data in payload');
    return false;
  }

  const supportedEvents = [
    // Customer events
    'customer.created',
    'customer.updated',
    'customer.deleted',
    'customer.discount.created',
    'customer.discount.updated',
    'customer.discount.deleted',
    'customer.source.created',
    'customer.source.updated',
    'customer.source.deleted',
    // Subscription events
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'customer.subscription.trial_will_end',
    'customer.subscription.paused',
    'customer.subscription.resumed',
    'customer.subscription.pending_update_applied',
    'customer.subscription.pending_update_expired',
    // Invoice events
    'invoice.created',
    'invoice.finalized',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
    'invoice.payment_action_required',
    'invoice.sent',
    'invoice.upcoming',
    'invoice.marked_uncollectible',
    'invoice.paid',
    'invoice.voided',
    // Payment events
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.requires_action',
    'payment_intent.created',
    'payment_intent.canceled',
    'payment_intent.processing',
    'payment_intent.amount_capturable_updated',
    // Checkout events
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
    // Charge events
    'charge.succeeded',
    'charge.failed',
    'charge.captured',
    'charge.updated',
    'charge.pending',
    'charge.dispute.created',
    'charge.dispute.updated',
    'charge.dispute.closed',
    'charge.dispute.funds_withdrawn',
    'charge.dispute.funds_reinstated',
    // Refund events
    'charge.refund.updated',
    'refund.created',
    'refund.updated',
    'refund.failed',
    // Setup Intent events
    'setup_intent.created',
    'setup_intent.succeeded',
    'setup_intent.setup_failed',
    'setup_intent.requires_action',
    'setup_intent.canceled',
    // Payment Method events
    'payment_method.attached',
    'payment_method.detached',
    'payment_method.updated',
    // Product and Price events
    'product.created',
    'product.updated',
    'product.deleted',
    'price.created',
    'price.updated',
    'price.deleted',
    // Coupon and Promotion Code events
    'coupon.created',
    'coupon.updated',
    'coupon.deleted',
    'promotion_code.created',
    'promotion_code.updated',
    // Balance and Transfer events
    'balance.available',
    'transfer.created',
    'transfer.updated',
    'transfer.failed',
    'transfer.paid',
    'transfer.reversed',
    // Review events (for fraud detection)
    'review.opened',
    'review.closed',
    // Radar events
    'radar.early_fraud_warning.created',
    'radar.early_fraud_warning.updated',
  ];

  if (!supportedEvents.includes(payload.type)) {
    console.log('Unsupported event type:', payload.type);
    return false;
  }

  return true;
}

function formatStripeEvent(payload: StripeWebhookPayload): SlackMessage | null {
  const { type } = payload;

  switch (true) {
    case type.startsWith('customer.') && !type.startsWith('customer.subscription.'):
      return formatCustomerEvent(payload);
    case type.startsWith('customer.subscription.'):
      return formatSubscriptionEvent(payload);
    case type.startsWith('invoice.'):
      return formatInvoiceEvent(payload);
    case type.startsWith('payment_intent.'):
      return formatPaymentIntentEvent(payload);
    case type.startsWith('checkout.session.'):
      return formatCheckoutSessionEvent(payload);
    case type.startsWith('charge.') && !type.startsWith('charge.refund.'):
      return formatChargeEvent(payload);
    case type.startsWith('refund.') || type.startsWith('charge.refund.'):
      return formatRefundEvent(payload);
    case type.startsWith('setup_intent.'):
      return formatSetupIntentEvent(payload);
    case type.startsWith('payment_method.'):
      return formatPaymentMethodEvent(payload);
    case type.startsWith('product.') || type.startsWith('price.'):
      return formatProductPriceEvent(payload);
    case type.startsWith('coupon.') || type.startsWith('promotion_code.'):
      return formatPromotionEvent(payload);
    case type.startsWith('transfer.'):
      return formatTransferEvent(payload);
    case type.startsWith('review.'):
      return formatReviewEvent(payload);
    case type.startsWith('radar.'):
      return formatRadarEvent(payload);
    default:
      return null;
  }
}

function formatCustomerEvent(payload: StripeWebhookPayload): SlackMessage {
  const customer = payload.data.object as StripeCustomer;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'customer.created':
      action = 'New Customer';
      break;
    case 'customer.updated':
      action = 'Customer Updated';
      break;
    case 'customer.deleted':
      action = 'Customer Deleted';
      break;
    default:
      action = 'Customer Event';
  }

  const customerName = customer.name || customer.email || customer.id;
  const mainText = `*${action}*\n${customerName}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add customer details for created/updated events
  if (type !== 'customer.deleted') {
    const details = [];
    if (customer.email) details.push(`=� ${customer.email}`);
    if (customer.phone) details.push(`=� ${customer.phone}`);
    if (customer.delinquent) details.push(`� Delinquent`);

    if (details.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: details.join('\n'),
        },
      });
    }
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe " ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatSubscriptionEvent(payload: StripeWebhookPayload): SlackMessage {
  const subscription = payload.data.object as StripeSubscription;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'customer.subscription.created':
      action = 'New Subscription';
      break;
    case 'customer.subscription.updated':
      action = 'Subscription Updated';
      break;
    case 'customer.subscription.deleted':
      action = 'Subscription Canceled';
      break;
    case 'customer.subscription.trial_will_end':
      action = 'Trial Ending Soon';
      break;
    case 'customer.subscription.paused':
      action = 'Subscription Paused';
      break;
    case 'customer.subscription.resumed':
      action = 'Subscription Resumed';
      break;
    case 'customer.subscription.pending_update_applied':
      action = 'Subscription Update Applied';
      break;
    case 'customer.subscription.pending_update_expired':
      action = 'Subscription Update Expired';
      break;
    default:
      action = 'Subscription Event';
  }

  const amount = subscription.items.data[0]?.price?.unit_amount || 0;
  const currency = subscription.currency.toUpperCase();
  const interval = subscription.items.data[0]?.price?.recurring?.interval || 'month';
  const formattedAmount = formatCurrency(amount, currency);

  const mainText = `*${action}*\n${formattedAmount}/${interval} (${subscription.status})`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add subscription details
  const details = [];
  details.push(`<� ${subscription.id}`);
  details.push(`=d Customer: ${subscription.customer}`);
  
  if (subscription.current_period_end) {
    const periodEnd = new Date(subscription.current_period_end * 1000);
    details.push(`=� Next billing: ${periodEnd.toLocaleDateString()}`);
  }
  
  if (subscription.trial_end) {
    const trialEnd = new Date(subscription.trial_end * 1000);
    details.push(`<� Trial ends: ${trialEnd.toLocaleDateString()}`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe " ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatInvoiceEvent(payload: StripeWebhookPayload): SlackMessage {
  const invoice = payload.data.object as StripeInvoice;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'invoice.created':
      action = 'Invoice Created';
      break;
    case 'invoice.finalized':
      action = 'Invoice Finalized';
      break;
    case 'invoice.payment_succeeded':
      action = 'Payment Successful';
      break;
    case 'invoice.payment_failed':
      action = 'Payment Failed';
      break;
    case 'invoice.payment_action_required':
      action = 'Payment Action Required';
      break;
    default:
      action = 'Invoice Event';
  }

  const formattedAmount = formatCurrency(invoice.total, invoice.currency);
  const customerName = invoice.customer_name || invoice.customer_email || invoice.customer;

  const mainText = `*${action}*\n${formattedAmount} - ${customerName}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add invoice details
  const details = [];
  details.push(`>� Invoice: ${invoice.number || invoice.id}`);
  
  if (invoice.description) {
    details.push(`=� ${invoice.description}`);
  }
  
  if (invoice.due_date) {
    const dueDate = new Date(invoice.due_date * 1000);
    details.push(`=� Due: ${dueDate.toLocaleDateString()}`);
  }

  if (invoice.hosted_invoice_url) {
    details.push(`= <${invoice.hosted_invoice_url}|View Invoice>`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe " ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatPaymentIntentEvent(payload: StripeWebhookPayload): SlackMessage {
  const paymentIntent = payload.data.object as StripePaymentIntent;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'payment_intent.succeeded':
      action = 'Payment Successful';
      break;
    case 'payment_intent.payment_failed':
      action = 'Payment Failed';
      break;
    case 'payment_intent.requires_action':
      action = 'Payment Requires Action';
      break;
    default:
      action = 'Payment Event';
  }

  const formattedAmount = formatCurrency(paymentIntent.amount, paymentIntent.currency);
  const customerInfo = paymentIntent.customer || 'Guest';

  const mainText = `*${action}*\n${formattedAmount} - ${customerInfo}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add payment details
  const details = [];
  details.push(`=� Payment: ${paymentIntent.id}`);
  details.push(`=� Status: ${paymentIntent.status}`);
  
  if (paymentIntent.description) {
    details.push(`=� ${paymentIntent.description}`);
  }
  
  if (paymentIntent.receipt_email) {
    details.push(`=� Receipt: ${paymentIntent.receipt_email}`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe " ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatChargeEvent(payload: StripeWebhookPayload): SlackMessage {
  const charge = payload.data.object as any; // Charge object
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'charge.succeeded':
      action = 'Charge Successful';
      break;
    case 'charge.failed':
      action = 'Charge Failed';
      break;
    case 'charge.dispute.created':
      action = 'Dispute Created';
      break;
    default:
      action = 'Charge Event';
  }

  const formattedAmount = formatCurrency(charge.amount, charge.currency);
  const customerInfo = charge.customer || 'Guest';

  const mainText = `*${action}*\n${formattedAmount} - ${customerInfo}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add charge details
  const details = [];
  details.push(`=� Charge: ${charge.id}`);
  
  if (charge.description) {
    details.push(`=� ${charge.description}`);
  }
  
  if (charge.receipt_url) {
    details.push(`>� <${charge.receipt_url}|Receipt>`);
  }

  if (charge.failure_message) {
    details.push(`L ${charge.failure_message}`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe " ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatCheckoutSessionEvent(payload: StripeWebhookPayload): SlackMessage {
  const session = payload.data.object as StripeCheckoutSession;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'checkout.session.completed':
      action = 'Checkout Completed';
      break;
    case 'checkout.session.async_payment_succeeded':
      action = 'Async Payment Succeeded';
      break;
    case 'checkout.session.async_payment_failed':
      action = 'Async Payment Failed';
      break;
    case 'checkout.session.expired':
      action = 'Checkout Expired';
      break;
    default:
      action = 'Checkout Event';
  }

  const formattedAmount = session.amount_total ? formatCurrency(session.amount_total, session.currency || 'usd') : 'Unknown amount';
  const customerInfo = session.customer_details?.name || session.customer_details?.email || session.customer || 'Guest';

  const mainText = `*${action}*\n${formattedAmount} - ${customerInfo}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add checkout details
  const details = [];
  details.push(`🛒 Session: ${session.id}`);
  details.push(`📊 Status: ${session.status}`);
  details.push(`💳 Payment: ${session.payment_status}`);
  
  if (session.mode) {
    details.push(`🔄 Mode: ${session.mode}`);
  }
  
  if (session.subscription) {
    details.push(`📋 Subscription: ${session.subscription}`);
  }

  if (session.payment_intent) {
    details.push(`💰 Payment Intent: ${session.payment_intent}`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe • ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatRefundEvent(payload: StripeWebhookPayload): SlackMessage {
  const refund = payload.data.object as StripeRefund;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'refund.created':
    case 'charge.refund.updated':
      action = 'Refund Processed';
      break;
    case 'refund.updated':
      action = 'Refund Updated';
      break;
    case 'refund.failed':
      action = 'Refund Failed';
      break;
    default:
      action = 'Refund Event';
  }

  const formattedAmount = formatCurrency(refund.amount, refund.currency);

  const mainText = `*${action}*\n${formattedAmount}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add refund details
  const details = [];
  details.push(`💸 Refund: ${refund.id}`);
  details.push(`💳 Charge: ${refund.charge}`);
  details.push(`📊 Status: ${refund.status}`);
  
  if (refund.reason) {
    details.push(`📝 Reason: ${refund.reason}`);
  }
  
  if (refund.receipt_number) {
    details.push(`🧾 Receipt: ${refund.receipt_number}`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe • ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatSetupIntentEvent(payload: StripeWebhookPayload): SlackMessage {
  const setupIntent = payload.data.object as StripeSetupIntent;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'setup_intent.created':
      action = 'Setup Intent Created';
      break;
    case 'setup_intent.succeeded':
      action = 'Payment Method Setup Successful';
      break;
    case 'setup_intent.setup_failed':
      action = 'Payment Method Setup Failed';
      break;
    case 'setup_intent.requires_action':
      action = 'Setup Requires Action';
      break;
    case 'setup_intent.canceled':
      action = 'Setup Canceled';
      break;
    default:
      action = 'Setup Intent Event';
  }

  const customerInfo = setupIntent.customer || 'Guest';

  const mainText = `*${action}*\n${customerInfo}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add setup intent details
  const details = [];
  details.push(`🔧 Setup: ${setupIntent.id}`);
  details.push(`📊 Status: ${setupIntent.status}`);
  details.push(`🔄 Usage: ${setupIntent.usage}`);
  
  if (setupIntent.description) {
    details.push(`📝 ${setupIntent.description}`);
  }
  
  if (setupIntent.payment_method) {
    details.push(`💳 Payment Method: ${setupIntent.payment_method}`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe • ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatPaymentMethodEvent(payload: StripeWebhookPayload): SlackMessage {
  const paymentMethod = payload.data.object as StripePaymentMethod;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'payment_method.attached':
      action = 'Payment Method Added';
      break;
    case 'payment_method.detached':
      action = 'Payment Method Removed';
      break;
    case 'payment_method.updated':
      action = 'Payment Method Updated';
      break;
    default:
      action = 'Payment Method Event';
  }

  const cardInfo = paymentMethod.card ? `${paymentMethod.card.brand.toUpperCase()} •••• ${paymentMethod.card.last4}` : paymentMethod.type;
  const customerInfo = paymentMethod.customer || 'Guest';

  const mainText = `*${action}*\n${cardInfo} - ${customerInfo}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add payment method details
  const details = [];
  details.push(`💳 Method: ${paymentMethod.id}`);
  details.push(`🔧 Type: ${paymentMethod.type}`);
  
  if (paymentMethod.card) {
    details.push(`📅 Expires: ${paymentMethod.card.exp_month}/${paymentMethod.card.exp_year}`);
    details.push(`🏦 Funding: ${paymentMethod.card.funding}`);
  }
  
  if (paymentMethod.billing_details.email) {
    details.push(`📧 ${paymentMethod.billing_details.email}`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe • ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatProductPriceEvent(payload: StripeWebhookPayload): SlackMessage {
  const object = payload.data.object as any;
  const { type } = payload;

  let action = '';
  let objectType = '';
  
  if (type.startsWith('product.')) {
    objectType = 'Product';
    switch (type) {
      case 'product.created':
        action = 'Product Created';
        break;
      case 'product.updated':
        action = 'Product Updated';
        break;
      case 'product.deleted':
        action = 'Product Deleted';
        break;
      default:
        action = 'Product Event';
    }
  } else {
    objectType = 'Price';
    switch (type) {
      case 'price.created':
        action = 'Price Created';
        break;
      case 'price.updated':
        action = 'Price Updated';
        break;
      case 'price.deleted':
        action = 'Price Deleted';
        break;
      default:
        action = 'Price Event';
    }
  }

  const name = object.name || object.nickname || object.id;
  const mainText = `*${action}*\n${name}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add object details
  const details = [];
  details.push(`🏷️ ${objectType}: ${object.id}`);
  
  if (objectType === 'Price' && object.unit_amount) {
    details.push(`💰 Amount: ${formatCurrency(object.unit_amount, object.currency)}`);
    if (object.recurring) {
      details.push(`🔄 Recurring: ${object.recurring.interval}`);
    }
  }
  
  if (object.active !== undefined) {
    details.push(`📊 Status: ${object.active ? 'Active' : 'Inactive'}`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe • ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatPromotionEvent(payload: StripeWebhookPayload): SlackMessage {
  const object = payload.data.object as any;
  const { type } = payload;

  let action = '';
  let objectType = '';
  
  if (type.startsWith('coupon.')) {
    objectType = 'Coupon';
    switch (type) {
      case 'coupon.created':
        action = 'Coupon Created';
        break;
      case 'coupon.updated':
        action = 'Coupon Updated';
        break;
      case 'coupon.deleted':
        action = 'Coupon Deleted';
        break;
      default:
        action = 'Coupon Event';
    }
  } else {
    objectType = 'Promotion Code';
    switch (type) {
      case 'promotion_code.created':
        action = 'Promotion Code Created';
        break;
      case 'promotion_code.updated':
        action = 'Promotion Code Updated';
        break;
      default:
        action = 'Promotion Code Event';
    }
  }

  const name = object.name || object.code || object.id;
  const mainText = `*${action}*\n${name}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add promotion details
  const details = [];
  details.push(`🎟️ ${objectType}: ${object.id}`);
  
  if (object.percent_off) {
    details.push(`💯 Discount: ${object.percent_off}% off`);
  } else if (object.amount_off) {
    details.push(`💰 Discount: ${formatCurrency(object.amount_off, object.currency)} off`);
  }
  
  if (object.active !== undefined) {
    details.push(`📊 Status: ${object.active ? 'Active' : 'Inactive'}`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe • ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatTransferEvent(payload: StripeWebhookPayload): SlackMessage {
  const transfer = payload.data.object as any;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'transfer.created':
      action = 'Transfer Created';
      break;
    case 'transfer.updated':
      action = 'Transfer Updated';
      break;
    case 'transfer.failed':
      action = 'Transfer Failed';
      break;
    case 'transfer.paid':
      action = 'Transfer Paid';
      break;
    case 'transfer.reversed':
      action = 'Transfer Reversed';
      break;
    default:
      action = 'Transfer Event';
  }

  const formattedAmount = formatCurrency(transfer.amount, transfer.currency);
  const destination = transfer.destination || 'Unknown destination';

  const mainText = `*${action}*\n${formattedAmount} → ${destination}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add transfer details
  const details = [];
  details.push(`💸 Transfer: ${transfer.id}`);
  details.push(`📊 Status: ${transfer.status || 'pending'}`);
  
  if (transfer.description) {
    details.push(`📝 ${transfer.description}`);
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe • ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatReviewEvent(payload: StripeWebhookPayload): SlackMessage {
  const review = payload.data.object as any;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'review.opened':
      action = 'Review Opened';
      break;
    case 'review.closed':
      action = 'Review Closed';
      break;
    default:
      action = 'Review Event';
  }

  const charge = review.charge || 'Unknown charge';
  const reason = review.reason || 'No reason specified';

  const mainText = `*${action}*\n${reason}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add review details
  const details = [];
  details.push(`🔍 Review: ${review.id}`);
  details.push(`💳 Charge: ${charge}`);
  details.push(`📊 Status: ${review.status || 'open'}`);

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe • ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatRadarEvent(payload: StripeWebhookPayload): SlackMessage {
  const warning = payload.data.object as any;
  const { type } = payload;

  let action = '';
  
  switch (type) {
    case 'radar.early_fraud_warning.created':
      action = '🚨 Fraud Warning Created';
      break;
    case 'radar.early_fraud_warning.updated':
      action = '🔄 Fraud Warning Updated';
      break;
    default:
      action = 'Radar Event';
  }

  const charge = warning.charge || 'Unknown charge';

  const mainText = `*${action}*\nCharge: ${charge}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Add warning details
  const details = [];
  details.push(`⚠️ Warning: ${warning.id}`);
  details.push(`💳 Charge: ${charge}`);
  details.push(`🏦 Card Issuer: ${warning.card_issuer || 'Unknown'}`);

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: details.join('\n'),
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Stripe • ${formatRelativeTime(payload.created * 1000)}`,
      },
    ],
  });

  return {
    username: 'Stripe',
    icon_url: 'https://stripe.com/img/v3/home/twitter.png',
    blocks,
  };
}

function formatCurrency(amount: number, currency: string): string {
  // Stripe amounts are in cents for most currencies
  const divisor = ['jpy', 'krw'].includes(currency.toLowerCase()) ? 1 : 100;
  const value = amount / divisor;
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(value);
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffInSeconds = Math.floor((now - timestamp) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;

  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

function verifyStripeSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) {
    console.log('No Stripe signature header found');
    return false;
  }

  try {
    // Stripe signature format: t=timestamp,v1=signature
    const elements = signature.split(',');
    let timestamp = '';
    let signatures: string[] = [];

    for (const element of elements) {
      const [key, value] = element.split('=');
      if (key === 't') {
        timestamp = value;
      } else if (key === 'v1') {
        signatures.push(value);
      }
    }

    if (!timestamp || signatures.length === 0) {
      console.log('Invalid Stripe signature format');
      return false;
    }

    // Check timestamp (prevent replay attacks)
    const timestampSeconds = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(now - timestampSeconds);
    
    if (timeDiff > 300) { // 5 minutes tolerance
      console.log('Stripe signature timestamp too old');
      return false;
    }

    // Verify signature
    const payload = `${timestamp}.${body}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    console.log('Expected signature:', expectedSignature);
    console.log('Received signatures:', signatures);

    // Check if any of the signatures match
    for (const sig of signatures) {
      if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature))) {
        console.log('Stripe signature verification successful');
        return true;
      }
    }

    console.log('Stripe signature verification failed');
    return false;
  } catch (error) {
    console.error('Stripe signature verification error:', error);
    return false;
  }
}

async function getWebhook(webhookId: string) {
  const result = await dbPool.query(
    `SELECT id, workspace_id, channel_id, signing_secret, is_active
     FROM webhooks
     WHERE id = $1 AND is_active = true AND source_type = 'stripe'`,
    [webhookId],
  );
  return result.rows[0] || null;
}

async function checkRateLimit(webhookId: string): Promise<boolean> {
  const result = await dbPool.query(
    `SELECT COUNT(*) as count
     FROM webhook_usage
     WHERE webhook_id = $1 AND created_at > now() - INTERVAL '10 seconds'`,
    [webhookId],
  );
  return parseInt(result.rows[0].count) < 15;
}

async function updateWebhookUsage(webhookId: string, sourceIp: string, userAgent?: string) {
  await Promise.all([
    dbPool.query(
      'INSERT INTO webhook_usage (webhook_id, source_ip, user_agent, authenticated_user) VALUES ($1, $2, $3, $4)',
      [webhookId, sourceIp, userAgent, 'stripe-webhook'],
    ),
    dbPool.query('UPDATE webhooks SET last_used_at = now() WHERE id = $1', [webhookId]),
  ]);
}

function errorResponse(
  statusCode: number,
  message: string,
  requestId: string,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: message, request_id: requestId }),
  };
}