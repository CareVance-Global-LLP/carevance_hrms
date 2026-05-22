-- Insert test users for CareVance HRMS
-- Password for both users: 12345678 (hashed with bcrypt)
-- The password hash below is for '12345678'

-- First, check if organization exists, if not create a default one
DO $$
DECLARE
    org_id bigint;
    test1_exists boolean;
    test2_exists boolean;
BEGIN
    -- Get the first organization or create one
    SELECT id INTO org_id FROM organizations LIMIT 1;
    
    IF org_id IS NULL THEN
        INSERT INTO organizations (name, slug, created_at, updated_at)
        VALUES ('Test Organization', 'test-org', NOW(), NOW())
        RETURNING id INTO org_id;
    END IF;

    -- Check if users already exist
    SELECT EXISTS(SELECT 1 FROM users WHERE email = 'test1@test.com') INTO test1_exists;
    SELECT EXISTS(SELECT 1 FROM users WHERE email = 'test2@test.com') INTO test2_exists;

    -- Insert test1 (Employee) if not exists
    IF NOT test1_exists THEN
        INSERT INTO users (name, email, password_hash, role, organization_id, created_at, updated_at)
        VALUES (
            'test1',
            'test1@test.com',
            '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- bcrypt hash for 'password', you need to replace with actual hash for '12345678'
            'employee',
            org_id,
            NOW(),
            NOW()
        );
        RAISE NOTICE 'Created test user: test1@test.com (Employee)';
    ELSE
        RAISE NOTICE 'User test1@test.com already exists';
    END IF;

    -- Insert test2 (Manager) if not exists
    IF NOT test2_exists THEN
        INSERT INTO users (name, email, password_hash, role, organization_id, created_at, updated_at)
        VALUES (
            'test2',
            'test2@test.com',
            '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- bcrypt hash for 'password', you need to replace with actual hash for '12345678'
            'manager',
            org_id,
            NOW(),
            NOW()
        );
        RAISE NOTICE 'Created test user: test2@test.com (Manager)';
    ELSE
        RAISE NOTICE 'User test2@test.com already exists';
    END IF;

END $$;
