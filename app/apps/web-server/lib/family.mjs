// Family/site details live OUTSIDE git in data/family.json (gitignored, 0600) so names,
// school and addresses never land in source or prompts. See family.example.json.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const expand = (p) => p.replace(/^~(?=\/|$)/, homedir());
const FILE = expand(process.env.HOME_FAMILY_FILE ?? join(process.env.HOME_DATA_DIR ?? "~/home-automation/data", "family.json"));
const DEFAULTS = {
  owner: "",
  kindergarten: { id: "barnehage", name: "Barnehagebarnet", fullName: "", institution: "Barnehagen", group: "" },
  school: { id: "skole", name: "Skolebarnet", fullName: "", school: "skolen", municipality: "", level: "" },
};
function load() {
  try {
    const j = JSON.parse(readFileSync(FILE, "utf8"));
    return { ...DEFAULTS, ...j, kindergarten: { ...DEFAULTS.kindergarten, ...j.kindergarten }, school: { ...DEFAULTS.school, ...j.school } };
  } catch { return DEFAULTS; }
}
export const FAMILY = load();
export const KG = FAMILY.kindergarten;
export const SCHOOL = FAMILY.school;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Regex-safe lowercase first name for assistant intent matching. */
export const nameRe = (child) => esc(String(child.name).toLowerCase());
/** Fill {{kindergarten.name}}-style placeholders in prompts/templates. */
export const fill = (t) => t.replace(/\{\{(\w+)\.(\w+)\}\}/g, (m, a, b) => String(FAMILY[a]?.[b] ?? m));
