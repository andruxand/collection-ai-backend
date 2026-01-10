import type { ConversationState, DebtorSnapshot, TenantPolicy } from '../types';

export type Offer = {
  id: string;
  label: string;
  type: 'ONE_PAY' | 'INSTALLMENTS';
  amountTotalCop: number;
  installments?: number;
  amountPerInstallmentCop?: number;
  discountPct?: number;
};

export function buildOffers(input: {
  tenantPolicy: TenantPolicy;
  debtor: DebtorSnapshot;
  conversation: ConversationState;
}): Offer[] {
  const { tenantPolicy, debtor, conversation } = input;
  const attempt = conversation.attemptCount ?? 1;
  const step = tenantPolicy.offerPolicy.ladder.find((x) => x.attempt === attempt);
  const maxDiscount = Math.min(
    step?.maxDiscountPct ?? 0,
    tenantPolicy.offerPolicy.hardCapDiscountPct
  );

  const total = debtor.totalDueCop;

  const onePayTotal = Math.max(0, Math.round(total * (1 - maxDiscount / 100)));
  const offer1: Offer = {
    id: `ONEPAY_${maxDiscount}`,
    label: maxDiscount > 0 ? `Pagar hoy con ${maxDiscount}% de descuento` : 'Pagar hoy el total',
    type: 'ONE_PAY',
    amountTotalCop: onePayTotal,
    discountPct: maxDiscount,
  };

  const installments = 3;
  const offer2: Offer = {
    id: 'INST_3',
    label: 'Pagar en 3 cuotas',
    type: 'INSTALLMENTS',
    amountTotalCop: total,
    installments,
    amountPerInstallmentCop: Math.ceil(total / installments),
  };

  return [offer1, offer2];
}
