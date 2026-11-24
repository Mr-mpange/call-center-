/** Keep only characters a phone keypad can send. */
export function cleanNumber(raw: string) {
  return raw.replace(/[^\d+*#]/g, "");
}

/** Convert a Tanzanian local mobile number such as 0683859574 to E.164. */
export function normalizeDialNumber(raw: string) {
  const number = cleanNumber(raw);
  if (/^00\d{8,14}$/.test(number)) return `+${number.slice(2)}`;
  return /^0[1-9]\d{8}$/.test(number) ? `+255${number.slice(1)}` : number;
}

/** Show the E.164 country code as soon as a complete local number is entered. */
export function normalizeDialInput(raw: string) {
  const number = cleanNumber(raw);
  return /^0[1-9]\d{8}$/.test(number) || /^00\d{8,14}$/.test(number)
    ? normalizeDialNumber(number)
    : number;
}

/** A number can be dialed when it has 3–15 digits (3 covers internal extensions). */
export function isDialable(raw: string) {
  const digits = cleanNumber(raw).replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 15;
}

export function formatNumber(raw: string) {
  const n = cleanNumber(raw);
  const m = /^\+255(\d{3})(\d{3})(\d{3})$/.exec(n);
  if (m) return `+255 ${m[1]} ${m[2]} ${m[3]}`;
  return n;
}

export function lookupName(raw: string): string | null {
  void raw;
  return null;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Standard DTMF frequency pairs (Hz). */
export const DTMF: Record<string, [number, number]> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477],
};

export const KEYPAD: [string, string][] = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
];
