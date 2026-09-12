import { apiRequest } from "./api.js";
import { AraraError } from "./errors.js";
import { contactsListSchema } from "./schemas.js";

const BRAZIL_COUNTRY_CODE = "55";
const BRAZIL_LANDLINE_LENGTH = 10;
const BRAZIL_MOBILE_LENGTH = 11;
const BRAZIL_MOBILE_PREFIX = "9";
const CONTACT_LOOKUP_SIZE = 5;
const PHONE_PATTERN = /^[+(\d][\d\s().-]{7,}$/;

export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export type Recipient = { phone: string; name?: string };

export const looksLikePhone = (value: string): boolean => PHONE_PATTERN.test(value.trim());

/**
 * Normalizes any human phone spelling into E.164. Brazilian numbers without the
 * country code get +55, and 10-digit Brazilian mobiles get the ninth digit.
 */
export const normalizePhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, "");
  const hasCountryCode = raw.trim().startsWith("+") || digits.length >= 12;
  if (hasCountryCode) return withBrazilianNinthDigit(digits);
  if (digits.length === BRAZIL_LANDLINE_LENGTH || digits.length === BRAZIL_MOBILE_LENGTH) {
    return `+${BRAZIL_COUNTRY_CODE}${digits}`;
  }
  return `+${digits}`;
};

const withBrazilianNinthDigit = (digits: string): string => {
  if (!digits.startsWith(BRAZIL_COUNTRY_CODE)) return `+${digits}`;
  const local = digits.slice(BRAZIL_COUNTRY_CODE.length);
  if (local.length !== BRAZIL_LANDLINE_LENGTH) return `+${digits}`;
  const areaCode = local.slice(0, 2);
  const rest = local.slice(2);
  return `+${BRAZIL_COUNTRY_CODE}${areaCode}${BRAZIL_MOBILE_PREFIX}${rest}`;
};

export const recipientLabel = (recipient: Recipient): string =>
  recipient.name === undefined ? recipient.phone : `${recipient.phone} (${recipient.name})`;

/**
 * Resolves a phone in any format or a saved contact name into one E.164 recipient.
 * Ambiguous names fail loudly with the candidates instead of guessing.
 */
export const resolveRecipient = async (to: string): Promise<Recipient> => {
  const trimmed = to.trim();
  if (looksLikePhone(trimmed)) {
    const phone = normalizePhone(trimmed);
    if (!E164_PATTERN.test(phone)) {
      throw new AraraError(
        "INVALID_PHONE",
        `'${trimmed}' is not a valid phone number.`,
        400,
        false,
      );
    }
    return { phone };
  }

  const params = new URLSearchParams({ q: trimmed, page: "0", size: String(CONTACT_LOOKUP_SIZE) });
  const result = await apiRequest(`/v1/contacts?${params.toString()}`, {
    schema: contactsListSchema,
  });
  const matches = result.contacts.filter((contact) => contact.phone.length > 0);
  if (matches.length === 0) {
    throw new AraraError(
      "CONTACT_NOT_FOUND",
      `No saved contact named '${trimmed}'. Pass the phone number or save the contact first.`,
      404,
      false,
    );
  }
  if (matches.length > 1) {
    const options = matches.map((contact) => `${contact.name} (${contact.phone})`).join(", ");
    throw new AraraError(
      "CONTACT_AMBIGUOUS",
      `'${trimmed}' matches more than one contact: ${options}. Use the phone number.`,
      409,
      false,
    );
  }
  const [match] = matches;
  if (match === undefined) {
    throw new AraraError("CONTACT_NOT_FOUND", `No saved contact named '${trimmed}'.`, 404, false);
  }
  return { phone: normalizePhone(match.phone), name: match.name };
};
