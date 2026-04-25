ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS payment_rail varchar
  DEFAULT 'arc_usdc';

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS buyer_agent varchar;

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS seller_agent varchar;

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS request_id varchar;

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS gateway_transfer_id varchar;
