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

export const PROTO_PATHS = {
  USERS: 'libs/shared/protos/users.proto',
  CATALOG: 'libs/shared/protos/catalog.proto',
  BOOKING: 'libs/shared/protos/booking.proto',
  PAYMENT: 'libs/shared/protos/payment.proto',
  NOTIFICATIONS: 'libs/shared/protos/notifications.proto',
  MEDIA: 'libs/shared/protos/media.proto',
} as const;

export const OUTBOX_EVENTS = {
  SEND_VERIFICATION_EMAIL: 'SEND_VERIFICATION_EMAIL',
  PROCESS_PROFILE_PHOTO: 'PROCESS_PROFILE_PHOTO',
} as const;

export const RABBITMQ_ROUTING_KEYS = {
  VERIFICATION_EMAIL: 'notification.email.verify',
  PROCESS_PHOTO: 'media.photo.process',
} as const;

