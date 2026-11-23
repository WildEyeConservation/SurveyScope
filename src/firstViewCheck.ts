// Keep the callback on the task so it survives workspace remounts.
export function firstViewCheck(check: () => Promise<boolean>) {
  let seen = false;
  return async () => {
    if (seen) return true;
    seen = true;
    return check();
  };
}
