import { assertAdministrativeOperationAllowed } from './isolation';

// Import this before any clients or legacy scripts. No network access.
assertAdministrativeOperationAllowed();
