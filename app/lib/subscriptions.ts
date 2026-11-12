// Deliberately disabled: no payment SDK, checkout links, prices or network calls.
// Enable the management UI only after plans, entitlements and server authorization
// have been agreed. Payment activation is a separate, future implementation.
export const subscriptionFeatures = Object.freeze({
  management: false,
  payments: false,
});
export type SubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';
export type Subscription = {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};
export type Plan = {
  id: string;
  name: string;
  entitlements: readonly string[];
};
export const plans: readonly Plan[] = [
  { id: 'free', name: 'Free', entitlements: ['document-tools'] },
];
export function requestPayment(): void {
  /* Intentionally inert until payments are implemented. */
}
