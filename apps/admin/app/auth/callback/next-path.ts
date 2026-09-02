export function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/receipts";
}
