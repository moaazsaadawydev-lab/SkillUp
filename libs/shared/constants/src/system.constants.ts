export const SERVICES = {
  API_GATEWAY: 'API_GATEWAY_SERVICE',
  USERS: 'USERS_SERVICE',
  CATALOG: 'CATALOG_SERVICE',
  BOOKING: 'BOOKING_SERVICE',
  PAYMENT: 'PAYMENT_SERVICE',
  NOTIFICATIONS: 'NOTIFICATIONS_SERVICE',
  MEDIA: 'MEDIA_SERVICE',
} as const;

export const QUEUES = {
  USERS: 'users_queue',
  CATALOG: 'catalog_queue',
  BOOKING: 'booking_queue',
  PAYMENT: 'payment_queue',
  NOTIFICATIONS: 'notifications_queue',
  MEDIA: 'media_queue',
} as const;

export const GRPC_PACKAGES = {
  USERS: 'users',
  CATALOG: 'catalog',
  BOOKING: 'booking',
  PAYMENT: 'payment',
  NOTIFICATIONS: 'notifications',
  MEDIA: 'media',
} as const;
