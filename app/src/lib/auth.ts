export const ACCESS_COOKIE = "bagindex_access";

export function accessCodeRequired(): boolean {
  return Boolean(process.env.ACCESS_CODE);
}

export function isValidCode(code: string | undefined): boolean {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return true;
  return (code ?? "").trim() === expected.trim();
}
