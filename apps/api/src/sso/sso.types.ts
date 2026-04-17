import { AppRole } from '@cms/database';

export type SsoProvider = 'SAML' | 'OIDC';

export interface SsoConfigDto {
  provider: SsoProvider;
  enabled: boolean;
  metadataUrl?: string | null;
  entityId?: string | null;
  acsUrl?: string | null;
  x509Cert?: string | null;          // plaintext on input; encrypted at rest
  oidcIssuer?: string | null;
  oidcClientId?: string | null;
  oidcClientSecret?: string | null;  // plaintext on input; encrypted at rest
  defaultRole?: AppRole;
  allowedEmailDomain?: string | null;
  autoProvision?: boolean;
}

export interface SsoCallbackProfile {
  email: string;
  nameId?: string;
  displayName?: string | null;
  groups?: string[];
  raw?: unknown;
}
