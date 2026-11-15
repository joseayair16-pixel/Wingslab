// Runs before Next.js can discover/load .env files. Does not read credentials.
require('../config/wingslab.cjs').assertLocalAuthorization();
