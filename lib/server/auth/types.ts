export type AuthProviderId = "google" | "tamkang" | "email";
export type MembershipRole = "owner" | "admin" | "member";

export type AuthUser = {
  id: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
  passwordHash: string | null;
  createdAt: string;
  updatedAt: string;
  disabled: boolean;
};

export type AuthIdentity = {
  id: string;
  userId: string;
  provider: AuthProviderId;
  providerSubject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export type WorkspaceMembership = {
  id: string;
  workspaceId: "workspace";
  userId: string;
  role: MembershipRole;
  createdAt: string;
};

export type AuthToken = {
  id: string;
  purpose: "verify" | "reset" | "magic" | "oauth";
  email?: string;
  userId?: string;
  extra?: string;
  expires: number;
  used: boolean;
};

export type OAuthState = {
  id: string;
  provider: "google" | "tamkang";
  verifier: string;
  purpose: "login" | "link";
  userId?: string;
  expires: number;
  extra?: string;
};

export type PublicProviderStatus = {
  id: AuthProviderId;
  configured: boolean;
  message: string | null;
};

export type PublicSession = {
  required: boolean;
  user: {
    id: string;
    displayName: string;
    email: string | null;
    avatarUrl: string | null;
    identities: AuthProviderId[];
  } | null;
  membership: { role: MembershipRole } | null;
  providers: PublicProviderStatus[];
};
