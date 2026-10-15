-- Migration 002: Add consumption per pcs and consumption uom to wip_orders
ALTER TABLE wip_orders
ADD COLUMN IF NOT EXISTS consumption_per_pcs DECIMAL(10,4) DEFAULT NULL AFTER unit_kain,
ADD COLUMN IF NOT EXISTS consumption_uom VARCHAR(20) DEFAULT NULL AFTER consumption_per_pcs;
