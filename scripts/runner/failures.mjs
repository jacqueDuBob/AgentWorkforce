export const FAILURE_CLASSES = Object.freeze(["contract", "configuration", "permission", "provider", "verification", "infrastructure", "timeout", "cancellation"]);
const RETRYABLE = new Set(["provider", "infrastructure", "timeout"]);

export function classifyFailure(cause) {
  const explicit = cause?.failureClass;
  const failureClass = FAILURE_CLASSES.includes(explicit) ? explicit
    : cause?.name === "VerificationFailedError" ? "verification"
    : cause?.name === "AbortError" ? "cancellation" : "infrastructure";
  return { failureClass, retryable: RETRYABLE.has(failureClass) && cause?.retryable !== false };
}
