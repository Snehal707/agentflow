CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS access_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  claimed_by text,
  claimed_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_codes_claimed_by_active
  ON access_codes (claimed_by)
  WHERE revoked = false;

CREATE OR REPLACE FUNCTION public.generate_access_codes(p_count int)
RETURNS TABLE(code text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_target integer := GREATEST(COALESCE(p_count, 0), 0);
  v_code text;
  v_alphabet CONSTANT text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_length CONSTANT integer := 8;
  v_inserted integer := 0;
BEGIN
  WHILE v_inserted < v_target LOOP
    v_code := '';

    FOR i IN 1..v_length LOOP
      v_code := v_code || substr(
        v_alphabet,
        1 + floor(random() * length(v_alphabet))::integer,
        1
      );
    END LOOP;

    BEGIN
      INSERT INTO public.access_codes (code)
      VALUES (v_code);

      code := v_code;
      RETURN NEXT;
      v_inserted := v_inserted + 1;
    EXCEPTION
      WHEN unique_violation THEN
        CONTINUE;
    END;
  END LOOP;
END;
$$;
