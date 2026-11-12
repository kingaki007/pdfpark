import {
  subscriptionFeatures,
  requestPayment,
  type Subscription,
} from '@/lib/subscriptions';
import { useLanguage } from '@/lib/i18n';
export function SubscriptionManagement({
  subscription,
}: {
  subscription?: Subscription;
}) {
  const { t } = useLanguage();
  if (!subscriptionFeatures.management) return null;
  return (
    <section>
      <h2>{t('subscriptions.title')}</h2>
      <p>{subscription ? subscription.status : t('subscriptions.disabled')}</p>
      <button
        disabled={!subscriptionFeatures.payments}
        onClick={requestPayment}
      >
        {t('payment.label')}
      </button>
    </section>
  );
}
