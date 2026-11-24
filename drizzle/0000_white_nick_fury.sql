CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_name` text NOT NULL,
	`phone` text NOT NULL,
	`city` text NOT NULL,
	`address` text NOT NULL,
	`note` text NOT NULL,
	`payment_method` text NOT NULL,
	`items_json` text NOT NULL,
	`total` real NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price` real DEFAULT 0 NOT NULL,
	`old_price` real DEFAULT 0 NOT NULL,
	`image_url` text DEFAULT '' NOT NULL,
	`badge` text DEFAULT '' NOT NULL,
	`featured` integer DEFAULT 0 NOT NULL,
	`stock` integer DEFAULT -1 NOT NULL,
	`created_at` text NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`specs_json` text DEFAULT '{}' NOT NULL,
	`product_url` text DEFAULT '' NOT NULL,
	`video_url` text DEFAULT '' NOT NULL,
	`external_id` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_products_external_id` ON `products` (`external_id`);--> statement-breakpoint
CREATE INDEX `idx_products_sku` ON `products` (`sku`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `social_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`post_type` text DEFAULT 'advert' NOT NULL,
	`source` text DEFAULT 'facebook' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`image_url` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`thumbnail_url` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
