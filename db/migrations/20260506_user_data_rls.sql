CREATE OR REPLACE FUNCTION public.agentflow_auth_wallet()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(coalesce(
    auth.jwt() ->> 'wallet_address',
    auth.jwt() ->> 'walletAddress'
  ));
$$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_economy_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_own_rows ON users;
CREATE POLICY users_own_rows ON users
  USING (lower(wallet_address) = public.agentflow_auth_wallet())
  WITH CHECK (lower(wallet_address) = public.agentflow_auth_wallet());

DROP POLICY IF EXISTS user_profiles_own_rows ON user_profiles;
CREATE POLICY user_profiles_own_rows ON user_profiles
  USING (lower(wallet_address) = public.agentflow_auth_wallet())
  WITH CHECK (lower(wallet_address) = public.agentflow_auth_wallet());

DROP POLICY IF EXISTS wallets_own_rows ON wallets;
CREATE POLICY wallets_own_rows ON wallets
  USING (lower(coalesce(user_wallet, address)) = public.agentflow_auth_wallet())
  WITH CHECK (lower(coalesce(user_wallet, address)) = public.agentflow_auth_wallet());

DROP POLICY IF EXISTS transactions_own_rows ON transactions;
CREATE POLICY transactions_own_rows ON transactions
  USING (
    lower(from_wallet) = public.agentflow_auth_wallet()
    OR lower(to_wallet) = public.agentflow_auth_wallet()
  )
  WITH CHECK (
    lower(from_wallet) = public.agentflow_auth_wallet()
    OR lower(to_wallet) = public.agentflow_auth_wallet()
  );

DROP POLICY IF EXISTS payment_requests_own_rows ON payment_requests;
CREATE POLICY payment_requests_own_rows ON payment_requests
  USING (
    lower(from_wallet) = public.agentflow_auth_wallet()
    OR lower(to_wallet) = public.agentflow_auth_wallet()
    OR lower(coalesce(initiated_by, '')) = public.agentflow_auth_wallet()
  )
  WITH CHECK (
    lower(from_wallet) = public.agentflow_auth_wallet()
    OR lower(to_wallet) = public.agentflow_auth_wallet()
    OR lower(coalesce(initiated_by, '')) = public.agentflow_auth_wallet()
  );

DROP POLICY IF EXISTS scheduled_payments_own_rows ON scheduled_payments;
CREATE POLICY scheduled_payments_own_rows ON scheduled_payments
  USING (lower(wallet_address) = public.agentflow_auth_wallet())
  WITH CHECK (lower(wallet_address) = public.agentflow_auth_wallet());

DROP POLICY IF EXISTS agent_economy_ledger_own_rows ON agent_economy_ledger;
CREATE POLICY agent_economy_ledger_own_rows ON agent_economy_ledger
  USING (
    lower(buyer_wallet) = public.agentflow_auth_wallet()
    OR lower(seller_wallet) = public.agentflow_auth_wallet()
  )
  WITH CHECK (
    lower(buyer_wallet) = public.agentflow_auth_wallet()
    OR lower(seller_wallet) = public.agentflow_auth_wallet()
  );

DROP POLICY IF EXISTS contacts_own_rows ON contacts;
CREATE POLICY contacts_own_rows ON contacts
  USING (lower(wallet_address) = public.agentflow_auth_wallet())
  WITH CHECK (lower(wallet_address) = public.agentflow_auth_wallet());

DROP POLICY IF EXISTS businesses_own_rows ON businesses;
CREATE POLICY businesses_own_rows ON businesses
  USING (lower(wallet_address) = public.agentflow_auth_wallet())
  WITH CHECK (lower(wallet_address) = public.agentflow_auth_wallet());

DROP POLICY IF EXISTS invoices_own_rows ON invoices;
CREATE POLICY invoices_own_rows ON invoices
  USING (lower(business_wallet) = public.agentflow_auth_wallet())
  WITH CHECK (lower(business_wallet) = public.agentflow_auth_wallet());
