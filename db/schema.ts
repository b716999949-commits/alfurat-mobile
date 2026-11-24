import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(), value: text('value').notNull(),
});
export const products = sqliteTable('products', {
  id: text('id').primaryKey(), name: text('name').notNull(), category: text('category').notNull(),
  description: text('description').notNull().default(''), price: real('price').notNull().default(0),
  oldPrice: real('old_price').notNull().default(0), imageUrl: text('image_url').notNull().default(''),
  badge: text('badge').notNull().default(''), featured: integer('featured').notNull().default(0),
  stock: integer('stock').notNull().default(-1), createdAt: text('created_at').notNull(),
  brand: text('brand').notNull().default(''), model: text('model').notNull().default(''),
  sku: text('sku').notNull().default(''), specsJson: text('specs_json').notNull().default('{}'),
  productUrl: text('product_url').notNull().default(''), videoUrl: text('video_url').notNull().default(''),
  externalId: text('external_id').notNull().default(''), source: text('source').notNull().default('manual'),
}, table => [index('idx_products_external_id').on(table.externalId), index('idx_products_sku').on(table.sku)]);
export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(), title: text('title').notNull(), url: text('url').notNull(),
  description: text('description').notNull().default(''), thumbnailUrl: text('thumbnail_url').notNull().default(''),
  createdAt: text('created_at').notNull(),
});
export const socialPosts = sqliteTable('social_posts', {
  id: text('id').primaryKey(), title: text('title').notNull(), description: text('description').notNull().default(''),
  postType: text('post_type').notNull().default('advert'), source: text('source').notNull().default('facebook'),
  url: text('url').notNull().default(''), imageUrl: text('image_url').notNull().default(''),
  createdAt: text('created_at').notNull(),
});
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(), customerName: text('customer_name').notNull(), phone: text('phone').notNull(),
  customerId: text('customer_id'),
  city: text('city').notNull(), address: text('address').notNull(), note: text('note').notNull(),
  paymentMethod: text('payment_method').notNull(), itemsJson: text('items_json').notNull(),
  total: real('total').notNull(), status: text('status').notNull(), createdAt: text('created_at').notNull(),
});
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(), email: text('email').notNull(), name: text('name').notNull().default(''),
  phone: text('phone').notNull().default(''), city: text('city').notNull().default(''),
  address: text('address').notNull().default(''), createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
