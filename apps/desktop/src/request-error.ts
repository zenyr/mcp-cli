export const requestErrorMessage = (
  error: unknown,
  fallback = "Request failed. Check the address and settings, then try again.",
): string => {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
};
