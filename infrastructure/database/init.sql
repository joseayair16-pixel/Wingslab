#!/bin/bash

# Database initialization script for PostgreSQL

# Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Create enums (already defined in Prisma schema)
-- They will be created by Prisma migrations

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO sadel_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO sadel_user;
