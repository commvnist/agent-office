// Version of agent-office in `claude plugin list` output (format: the plugin id line, then an indented "Version: x.y.z").
export const installedVersion = (listText) => /agent-office@agent-office[\s\S]*?version:?\s*v?(\d[\w.+-]*)/i.exec(listText ?? "")?.[1];
