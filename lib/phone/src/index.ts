/**
 * Phone-number utilities shared between Ringover (digits-only `351...`) and
 * Zoho Desk (free-form `+351 911 234 567`, `911234567`, `00351...`, etc.).
 *
 * The fingerprint is the last 9 digits of the normalised number — this is the
 * most reliable common substring across PT formats. Per HANDOVER §1.
 */

/** Digits-only normalisation; null-safe. */
export function digitsOnly(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

/** Last 9 digits of the normalised number; "" if too short or empty. */
export function phoneFingerprint(phone: string | null | undefined): string {
  const d = digitsOnly(phone);
  if (d.length < 9) return "";
  return d.slice(-9);
}

/** Whether two phone strings share the same fingerprint. */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = phoneFingerprint(a);
  if (!fa) return false;
  return fa === phoneFingerprint(b);
}
