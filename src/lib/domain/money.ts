// All money is stored and calculated in whole cents (AUD).

export function formatAud(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

/** Percentage of an amount, rounded to the nearest whole dollar (in cents). */
export function percentOfRoundedDollar(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100 / 100) * 100;
}
