-- Vorkath cloud profile, save, run records, AI field reports and AI usage metering.
-- Idempotent: safe to run more than once. No foreign keys, so the schema stays portable;
-- cleanup of a player's rows is done explicitly by the cloudDelete procedure.

CREATE TABLE IF NOT EXISTS `vk_profiles` (
	`user_id` int NOT NULL,
	`display_name` varchar(32) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vk_profiles_pk` PRIMARY KEY (`user_id`)
);

CREATE TABLE IF NOT EXISTS `vk_saves` (
	`user_id` int NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`run_id` varchar(40) NOT NULL,
	`stage` varchar(32) NOT NULL,
	`discoveries` int NOT NULL DEFAULT 0,
	`play_time` int NOT NULL DEFAULT 0,
	`vitality` float NOT NULL DEFAULT 0,
	`eco_stage` tinyint NOT NULL DEFAULT 0,
	`completed` tinyint(1) NOT NULL DEFAULT 0,
	`client_id` varchar(40) NOT NULL DEFAULT '',
	`progress` mediumtext NOT NULL,
	`settings` text NULL,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vk_saves_pk` PRIMARY KEY (`user_id`)
);

CREATE TABLE IF NOT EXISTS `vk_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`run_id` varchar(40) NOT NULL,
	`kind` varchar(24) NOT NULL,
	`play_time` int NOT NULL DEFAULT 0,
	`discoveries` int NOT NULL DEFAULT 0,
	`vitality` float NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `vk_records_pk` PRIMARY KEY (`id`),
	CONSTRAINT `vk_records_run_kind` UNIQUE (`user_id`, `run_id`, `kind`),
	KEY `vk_records_user_time` (`user_id`, `created_at`)
);

CREATE TABLE IF NOT EXISTS `vk_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`run_id` varchar(40) NOT NULL,
	`title` varchar(120) NOT NULL,
	`body` text NOT NULL,
	`stage` varchar(32) NOT NULL DEFAULT '',
	`discoveries` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `vk_reports_pk` PRIMARY KEY (`id`),
	KEY `vk_reports_user_time` (`user_id`, `created_at`)
);

CREATE TABLE IF NOT EXISTS `vk_ai_usage` (
	`user_id` int NOT NULL,
	`day` date NOT NULL,
	`calls` int NOT NULL DEFAULT 0,
	CONSTRAINT `vk_ai_usage_pk` PRIMARY KEY (`user_id`, `day`)
);
