import { adminDb } from '../db/client'

async function applyUserProfiles() {
  const { error } = await adminDb.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS user_profiles (
        wallet_address varchar PRIMARY KEY,
        display_name varchar,
        preferences jsonb DEFAULT '{}',
        memory_notes text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      );
    `
  })

  if (error) {
    console.error('Failed:', error)
    process.exit(1)
  }

  console.log('user_profiles table created successfully')
}

applyUserProfiles()
