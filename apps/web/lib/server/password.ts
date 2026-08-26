// A small blocklist of the most-abused passwords. Not exhaustive — just the worst.
const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "qwertyuiop", "11111111", "00000000", "iloveyou", "admin123",
  "letmein123", "welcome123", "abc12345", "monkey123", "trustno1", "sunshine1",
  "football1", "baseball1", "dragon123", "superman1", "princess1", "passw0rd",
]);

/** Returns an error string if the password is too weak, otherwise null. */
export function passwordIssue(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters";
  if (pw.length > 128) return "Password is too long";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must include both letters and numbers";
  if (COMMON.has(pw.toLowerCase())) return "That password is too common — please choose a stronger one";
  return null;
}
