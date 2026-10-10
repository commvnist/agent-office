export function violations(owners: Record<string, string[]>, files: string[]): { problem: "unowned" | "overlap"; file: string }[];
export function changedFiles(): string[];
