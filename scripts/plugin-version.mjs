// Version of agent-office in `claude plugin list` output (format: the plugin id line, then an indented "Version: x.y.z").
export const installedVersion = (listText) => {
  // only this plugin's own block: its id line plus the indented lines below it (another plugin's "Version:" must not match)
  const m = /agent-office@agent-office([^\n]*)\n?((?:[ \t]+[^\n]*(?:\n|$))*)/i.exec(listText ?? "");
  return m ? /version:?\s*v?(\d[\w.+-]*)/i.exec(`${m[1]}\n${m[2]}`)?.[1] : undefined;
};
