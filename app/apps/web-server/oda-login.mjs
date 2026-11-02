// Usage: <json {username,password}> | node oda-login.mjs   (credentials read from stdin, never printed)
import { login } from "./lib/oda.mjs";
let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", async () => {
  try { const { username, password } = JSON.parse(s); const st = await login(username, password); console.log(st.loggedIn ? "Oda: logged in" : "Oda: login failed"); }
  catch (e) { console.log("Oda login error:", String(e.message).slice(0, 160)); process.exitCode = 1; }
});
