import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder')

// Mapeamento de PlanType para Price ID configurado no Stripe
export const PRICE_IDS: Record<string, string> = {
  STARTER: process.env.STRIPE_PRICE_STARTER ?? '',
  PRO: process.env.STRIPE_PRICE_PRO ?? '',
  AGENCY: process.env.STRIPE_PRICE_AGENCY ?? '',
}

// Limites de posts por mês por plano (usado pelo middleware de quota)
export const PLAN_POST_LIMITS: Record<string, number> = {
  TRIAL: 10,
  STARTER: 100,
  PRO: 500,
  AGENCY: 2000,
}
